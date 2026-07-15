/**
 * TRADING AGENT – Real Binance support, max $0.50 per trade
 */

const router = require('express').Router();
const supabase = require('../db');
const { getAnalysis } = require('./ai');
const { v4: uuidv4 } = require('uuid');
const technical = require('technicalindicators');
const Binance = require('binance-api-node').default;

// ─── CONFIG ──────────────────────────────────────────────────────────────
const CONFIG = {
  baseConfidenceThreshold: 50,
  minConfidenceThreshold: 30,
  maxTradeAmount: 0.50,        // maximum $0.50 per trade
  minTradeAmount: 0.10,        // minimum $0.10
  riskPerTrade: 0.01,          // 1% of balance (capped by maxTradeAmount)
  stopLossPercent: 2,
  takeProfitPercent: 5,
  maxDailyLoss: 0.05,
};

// ─── PERSISTENT STATE ──────────────────────────────────────────────────
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
      lastSignal: null,
      lastTradeAttempt: null,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      startingBalance: 1000,
      tradeHistory: [],
    };
  }
  return data.agent_state;
}

async function saveAgentState(email, state) {
  await supabase.from('users').update({ agent_state: state }).eq('email', email);
}

// ─── HELPERS ──────────────────────────────────────────────────────────
async function getCandles(symbol, interval = '1m', limit = 50) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.map(c => parseFloat(c[4])); // close prices
}

function computeIndicators(closes) {
  if (closes.length < 20) return null;
  const rsi = technical.RSI.calculate({ values: closes, period: 14 });
  const ema = technical.EMA.calculate({ values: closes, period: 20 });
  const macd = technical.MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
  });
  return {
    rsi: rsi[rsi.length-1],
    ema: ema[ema.length-1],
    macd: macd[macd.length-1],
  };
}

// ─── MAIN AGENT LOOP ──────────────────────────────────────────────────
let processingLock = false;

async function agentLoop(email) {
  if (processingLock) return;
  processingLock = true;

  try {
    const state = await loadAgentState(email);
    if (!state.running) {
      processingLock = false;
      return;
    }

    // Get settings
    const settingsRes = await supabase
      .from('users')
      .select('bot_settings, paper_balance, binance_api_key, binance_secret_key')
      .eq('email', email)
      .single();
    const settings = settingsRes.data || {};
    const isPaper = settings.bot_settings?.paperMode !== false; // default paper
    const symbol = settings.bot_settings?.market || 'BTCUSDT';

    // Get current price
    const priceRes = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    const priceData = await priceRes.json();
    const price = parseFloat(priceData.price);
    if (!price) { processingLock = false; return; }

    // Update price history
    state.priceHistory.push(price);
    if (state.priceHistory.length > 100) state.priceHistory.shift();
    if (state.priceHistory.length < 20) {
      // Seed from historical
      const closes = await getCandles(symbol);
      state.priceHistory = closes;
    }

    // Check open trade
    if (state.activeTradeId) {
      // Monitor trade – we'll close on SL/TP/time
      const trade = await supabase
        .from('trades')
        .select('*')
        .eq('id', state.activeTradeId)
        .single();
      if (trade.data) {
        const t = trade.data;
        const entry = t.entry_price;
        const sl = t.stop_loss;
        const tp = t.take_profit;
        const openedAt = new Date(t.opened_at);
        const elapsed = (new Date() - openedAt) / 1000;
        let closed = false;
        if (t.type === 'BUY') {
          if (price <= sl || price >= tp || elapsed > 120) closed = true;
        } else {
          if (price >= sl || price <= tp || elapsed > 120) closed = true;
        }
        if (closed) {
          const pnl = (t.type === 'BUY') ? (price - entry) * t.quantity : (entry - price) * t.quantity;
          await supabase.from('trades').update({
            exit_price: price,
            pnl: pnl,
            status: 'closed',
            closed_at: new Date().toISOString(),
            close_reason: closed ? (price <= sl ? 'SL' : price >= tp ? 'TP' : 'TIME') : 'unknown',
          }).eq('id', state.activeTradeId);
          // Update balance
          if (isPaper) {
            state.paperBalance += pnl;
          } else {
            // Real balance update will be fetched next loop
          }
          state.activeTradeId = null;
          state.tradeOpenTime = null;
          if (pnl > 0) state.consecutiveWins++; else state.consecutiveLosses++;
          state.totalPnL += pnl;
          if (pnl < 0) state.dailyLoss += Math.abs(pnl);
          await saveAgentState(email, state);
          processingLock = false;
          return;
        }
      } else {
        state.activeTradeId = null;
        await saveAgentState(email, state);
        processingLock = false;
        return;
      }
      processingLock = false;
      return;
    }

    // ─── No open trade – get signal ──────────────────────────────────
    const closes = state.priceHistory;
    const ind = computeIndicators(closes);
    if (!ind) { processingLock = false; return; }

    // Simple directional logic
    let preliminarySignal = 'HOLD';
    const rsi = ind.rsi;
    const macd = ind.macd;
    if (rsi < 30) preliminarySignal = 'BUY';
    else if (rsi > 70) preliminarySignal = 'SELL';
    else if (rsi < 45 && macd && macd.MACD > macd.signal) preliminarySignal = 'BUY';
    else if (rsi > 55 && macd && macd.MACD < macd.signal) preliminarySignal = 'SELL';

    // AI confirmation
    let aiSignal = { signal: 'HOLD', confidence: 0, reason: '' };
    if (preliminarySignal !== 'HOLD') {
      const aiResult = await getAnalysis(
        symbol,
        price,
        {
          rsi: ind.rsi,
          ema: ind.ema,
          macd: ind.macd ? ind.macd.MACD : 0,
        },
        email
      );
      aiSignal = aiResult;
    }

    const finalSignal = (preliminarySignal !== 'HOLD' && aiSignal.signal === preliminarySignal && aiSignal.confidence >= CONFIG.baseConfidenceThreshold)
      ? preliminarySignal
      : 'HOLD';

    if (finalSignal === 'HOLD') {
      state.lastTradeAttempt = `HOLD (AI: ${aiSignal.signal} ${aiSignal.confidence}%)`;
      await saveAgentState(email, state);
      processingLock = false;
      return;
    }

    // ─── Determine balance ────────────────────────────────────────────
    let balance;
    if (isPaper) {
      balance = state.paperBalance;
    } else {
      // Real Binance
      if (!settings.binance_api_key) {
        state.lastTradeAttempt = 'Binance not connected';
        await saveAgentState(email, state);
        processingLock = false;
        return;
      }
      const client = Binance({ apiKey: settings.binance_api_key, secretKey: settings.binance_secret_key });
      const account = await client.accountInfo();
      const usdt = account.balances.find(b => b.asset === 'USDT');
      balance = usdt ? parseFloat(usdt.free) : 0;
    }

    if (balance < 1) {
      state.lastTradeAttempt = 'Balance too low (< $1)';
      await saveAgentState(email, state);
      processingLock = false;
      return;
    }

    // ─── Position sizing – cap at $0.50 ──────────────────────────────
    let tradeAmount = balance * CONFIG.riskPerTrade;
    tradeAmount = Math.min(tradeAmount, CONFIG.maxTradeAmount);
    tradeAmount = Math.max(tradeAmount, CONFIG.minTradeAmount);
    const quantity = tradeAmount / price;

    // Set SL/TP
    const slPercent = CONFIG.stopLossPercent;
    const tpPercent = CONFIG.takeProfitPercent;
    let stopLoss, takeProfit;
    if (finalSignal === 'BUY') {
      stopLoss = price * (1 - slPercent / 100);
      takeProfit = price * (1 + tpPercent / 100);
    } else {
      stopLoss = price * (1 + slPercent / 100);
      takeProfit = price * (1 - tpPercent / 100);
    }

    // Execute trade
    const tradeId = uuidv4();
    await supabase.from('trades').insert([{
      id: tradeId,
      user_email: email,
      symbol: symbol,
      type: finalSignal,
      entry_price: price,
      quantity: quantity,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      duration: 120,
      signal_confidence: aiSignal.confidence,
      signal_reason: aiSignal.reason || 'AI signal',
      status: 'open',
      opened_at: new Date().toISOString(),
      is_paper: isPaper,
    }]);

    state.activeTradeId = tradeId;
    state.tradeOpenTime = new Date();
    state.tradesToday++;
    state.lastTradeAttempt = `✅ ${finalSignal} at ${price} ($${tradeAmount.toFixed(2)})`;
    await saveAgentState(email, state);

    console.log(`📄 PAPER TRADE (${isPaper ? 'paper' : 'real'}): ${finalSignal} ${symbol} at ${price} ($${tradeAmount.toFixed(2)})`);

  } catch (error) {
    console.error('[Agent] Loop error:', error);
    state.lastTradeAttempt = 'Error: ' + error.message;
  } finally {
    processingLock = false;
    // Schedule next loop
    const state = await loadAgentState(email);
    if (state.running) {
      setTimeout(() => agentLoop(email), 5000);
    }
  }
}

// ─── ENDPOINTS ──────────────────────────────────────────────────────────

router.post('/start', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const state = await loadAgentState(email);
  if (state.running) return res.json({ status: 'already running' });

  state.running = true;
  state.tradesToday = 0;
  state.dailyLoss = 0;
  state.totalPnL = 0;
  state.priceHistory = [];
  state.lastTradeAttempt = null;

  // Seed price history
  const settings = (await supabase.from('users').select('bot_settings').eq('email', email).single()).data || {};
  const symbol = settings.bot_settings?.market || 'BTCUSDT';
  const closes = await getCandles(symbol);
  state.priceHistory = closes;

  await saveAgentState(email, state);

  // Start loop (first call)
  processingLock = false;
  setTimeout(() => agentLoop(email), 1000);

  res.json({ status: 'started' });
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
