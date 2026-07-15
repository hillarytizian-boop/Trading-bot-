const router = require('express').Router();
const supabase = require('../db');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

// ─── CONFIG ──────────────────────────────────────────────────────────
const CONFIG = {
  confidenceThreshold: 60,
  maxTradeAmount: 0.50,
  minTradeAmount: 0.10,
};

// ─── PERSISTENT STATE ──────────────────────────────────────────────
async function loadAgentState(email) {
  const { data, error } = await supabase
    .from('users')
    .select('agent_state')
    .eq('email', email)
    .single();
  if (error || !data?.agent_state) {
    return {
      running: false,
      tradesToday: 0,
      dailyLoss: 0,
      totalPnL: 0,
      activeTradeId: null,
      tradeOpenTime: null,
      paperBalance: 1000,
      priceHistory: [],
      lastTradeAttempt: null,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      startingBalance: 1000,
    };
  }
  return data.agent_state;
}

async function saveAgentState(email, state) {
  await supabase.from('users').update({ agent_state: state }).eq('email', email);
}

async function getCandles(symbol, interval = '1m', limit = 50) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.map(c => parseFloat(c[4]));
}

let processingLock = false;

async function agentLoop(email) {
  if (processingLock) return;
  processingLock = true;

  try {
    const state = await loadAgentState(email);
    if (!state.running) { processingLock = false; return; }

    const settingsRes = await supabase
      .from('users')
      .select('bot_settings, paper_balance')
      .eq('email', email)
      .single();
    const settings = settingsRes.data || {};
    const isPaper = settings.bot_settings?.paperMode !== false;
    const symbol = settings.bot_settings?.market || 'BTCUSDT';

    // Get price and update history
    const priceRes = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    const priceData = await priceRes.json();
    const price = parseFloat(priceData.price);
    if (!price) { processingLock = false; return; }

    state.priceHistory.push(price);
    if (state.priceHistory.length > 100) state.priceHistory.shift();
    if (state.priceHistory.length < 20) {
      const closes = await getCandles(symbol);
      state.priceHistory = closes;
    }

    // ─── Check open trade ──────────────────────────────────────────
    if (state.activeTradeId) {
      const trade = await supabase
        .from('trades')
        .select('*')
        .eq('id', state.activeTradeId)
        .single();
      if (trade.data) {
        const t = trade.data;
        const entryPrice = t.entry_price;
        const side = t.type;

        // ─── Ask AI for exit decision ──────────────────────────────
        try {
          const exitRes = await axios.post('http://localhost:10000/api/ai/exit', {
            email,
            price,
            closes: state.priceHistory,
            entryPrice,
            side,
          });
          const exitData = exitRes.data;
          if (exitData.shouldExit) {
            // Close the trade
            const pnl = (side === 'BUY') ? (price - entryPrice) * t.quantity : (entryPrice - price) * t.quantity;
            await supabase.from('trades').update({
              exit_price: price,
              pnl: pnl,
              status: 'closed',
              closed_at: new Date().toISOString(),
              close_reason: 'AI_EXIT',
            }).eq('id', state.activeTradeId);

            if (isPaper) {
              state.paperBalance += pnl;
            }
            state.activeTradeId = null;
            state.tradeOpenTime = null;
            if (pnl > 0) state.consecutiveWins++; else state.consecutiveLosses++;
            state.totalPnL += pnl;
            if (pnl < 0) state.dailyLoss += Math.abs(pnl);
            await saveAgentState(email, state);

            // Learn from the trade
            try {
              await axios.post('http://localhost:10000/api/ai/learn', {
                email,
                trade: { pnl, indicators: t.indicators || {} },
              });
            } catch (learnErr) { console.error('AI learn error:', learnErr); }

            processingLock = false;
            return;
          }
        } catch (err) {
          console.error('AI exit call failed:', err);
          // Fallback: use fixed SL/TP
          // Not needed because we'll rely on AI, but we could add a fallback.
        }

        processingLock = false;
        return;
      } else {
        state.activeTradeId = null;
        await saveAgentState(email, state);
        processingLock = false;
        return;
      }
    }

    // ─── No open trade – get entry signal ──────────────────────────
    const closes = state.priceHistory;
    if (closes.length < 20) { processingLock = false; return; }

    const aiRes = await axios.post('http://localhost:10000/api/ai/analyze', {
      email,
      market: symbol,
      price,
      indicators: { rsi: 50, macd: 0, ema: price * 0.99 },
      closes,
    });
    const signal = aiRes.data;

    if (signal.signal === 'HOLD' || signal.confidence < CONFIG.confidenceThreshold) {
      state.lastTradeAttempt = `HOLD (${signal.confidence}%)`;
      await saveAgentState(email, state);
      processingLock = false;
      return;
    }

    // ─── Position sizing ──────────────────────────────────────────
    const balance = isPaper ? state.paperBalance : 1000;
    if (balance < 1) {
      state.lastTradeAttempt = 'Balance < $1';
      await saveAgentState(email, state);
      processingLock = false;
      return;
    }

    // Use AI for sizing (but we'll keep a simple Kelly)
    let tradeAmount = Math.min(balance * 0.01, CONFIG.maxTradeAmount);
    tradeAmount = Math.max(tradeAmount, CONFIG.minTradeAmount);
    const quantity = tradeAmount / price;

    // ─── Execute trade ──────────────────────────────────────────────
    const tradeId = uuidv4();
    await supabase.from('trades').insert([{
      id: tradeId,
      user_email: email,
      symbol: symbol,
      type: signal.signal,
      entry_price: price,
      quantity: quantity,
      stop_loss: 0,
      take_profit: 0,
      duration: 0,
      signal_confidence: signal.confidence,
      signal_reason: signal.reason,
      status: 'open',
      opened_at: new Date().toISOString(),
      is_paper: isPaper,
      indicators: signal.breakdown || {},
    }]);

    state.activeTradeId = tradeId;
    state.tradeOpenTime = new Date();
    state.tradesToday++;
    state.lastTradeAttempt = `✅ ${signal.signal} at ${price} ($${tradeAmount.toFixed(2)})`;
    await saveAgentState(email, state);

    console.log(`📄 ${isPaper ? 'PAPER' : 'REAL'} TRADE: ${signal.signal} ${symbol} at ${price} ($${tradeAmount.toFixed(2)})`);

  } catch (error) {
    console.error('[Agent] Loop error:', error);
  } finally {
    processingLock = false;
    const state = await loadAgentState(email);
    if (state.running) {
      setTimeout(() => agentLoop(email), 1000);
    }
  }
}

// ─── ENDPOINTS ──────────────────────────────────────────────────────

router.post('/start', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const state = await loadAgentState(email);
    if (state.running) return res.json({ status: 'already running' });

    state.running = true;
    state.tradesToday = 0;
    state.dailyLoss = 0;
    state.totalPnL = 0;
    state.priceHistory = [];
    state.lastTradeAttempt = null;

    const settings = (await supabase.from('users').select('bot_settings').eq('email', email).single()).data || {};
    const symbol = settings.bot_settings?.market || 'BTCUSDT';
    const closes = await getCandles(symbol);
    state.priceHistory = closes;

    await saveAgentState(email, state);
    processingLock = false;
    setTimeout(() => agentLoop(email), 1000);

    res.json({ status: 'started' });
  } catch (err) {
    console.error('[Agent] Start error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/stop', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const state = await loadAgentState(email);
  state.running = false;
  await saveAgentState(email, state);
  res.json({ status: 'stopped' });
});

router.get('/status', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const state = await loadAgentState(email);
  res.json(state);
});

module.exports = router;
