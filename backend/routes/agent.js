const router = require('express').Router();
const supabase = require('../db');
const { getAIAnalysis } = require('./ai.js');
const { v4: uuidv4 } = require('uuid');
const Binance = require('binance-api-node').default;

// ─── State per user ──────────────────────────────────────────────
const agentStates = new Map(); // email -> { running, interval }

async function loadState(email) {
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
      paperBalance: 1000,
      priceHistory: [],
      activeTradeId: null,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      totalPnL: 0,
    };
  }
  return data.agent_state;
}

async function saveState(email, state) {
  await supabase.from('users').update({ agent_state: state }).eq('email', email);
}

// ─── Get current price ──────────────────────────────────────────────
async function getPrice(symbol) {
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol.replace('/', '')}`;
  const res = await fetch(url);
  const data = await res.json();
  return parseFloat(data.price);
}

// ─── Agent loop for a single user ──────────────────────────────────
async function agentLoop(email) {
  const state = await loadState(email);
  if (!state.running) return;

  try {
    const user = await supabase
      .from('users')
      .select('bot_settings, paper_balance, binance_api_key, binance_secret_key')
      .eq('email', email)
      .single();
    const settings = user.data || {};
    const isPaper = settings.bot_settings?.paperMode !== false;
    const symbol = settings.bot_settings?.market || 'BTCUSDT';

    const price = await getPrice(symbol);
    if (!price) throw new Error('Price fetch failed');

    // Update price history
    state.priceHistory.push(price);
    if (state.priceHistory.length > 100) state.priceHistory.shift();

    // ─── Check open trade ──────────────────────────────────────────
    if (state.activeTradeId) {
      const { data: trade } = await supabase
        .from('trades')
        .select('*')
        .eq('id', state.activeTradeId)
        .single();

      if (trade && trade.status === 'open') {
        const entry = trade.entry_price;
        const sl = trade.stop_loss;
        const tp = trade.take_profit;
        const elapsed = (new Date() - new Date(trade.opened_at)) / 1000;
        let closed = false;
        if (trade.type === 'BUY') {
          if (price <= sl || price >= tp || elapsed > 120) closed = true;
        } else {
          if (price >= sl || price <= tp || elapsed > 120) closed = true;
        }
        if (closed) {
          const pnl = (trade.type === 'BUY') ? (price - entry) * trade.quantity : (entry - price) * trade.quantity;
          await supabase.from('trades').update({
            exit_price: price,
            pnl: pnl,
            status: 'closed',
            closed_at: new Date().toISOString(),
          }).eq('id', state.activeTradeId);

          if (isPaper) {
            state.paperBalance += pnl;
          } else {
            // Real balance update would come from Binance later
          }
          state.totalPnL += pnl;
          if (pnl > 0) state.consecutiveWins++; else state.consecutiveLosses++;
          if (pnl < 0) state.dailyLoss += Math.abs(pnl);
          state.activeTradeId = null;
          await saveState(email, state);
        }
        // If still open, exit early
        return;
      } else {
        // Trade not found or already closed
        state.activeTradeId = null;
        await saveState(email, state);
      }
    }

    // ─── No open trade – get AI signal ────────────────────────────
    const ai = await getAIAnalysis(email, symbol, price, state.priceHistory);
    if (ai.signal === 'HOLD' || ai.confidence < 60) {
      // No trade
      await saveState(email, state);
      return;
    }

    // ─── Determine balance ──────────────────────────────────────────
    let balance;
    if (isPaper) {
      balance = state.paperBalance;
    } else {
      if (!settings.binance_api_key) {
        await saveState(email, state);
        return;
      }
      const client = Binance({
        apiKey: settings.binance_api_key,
        secretKey: settings.binance_secret_key,
      });
      const account = await client.accountInfo();
      const usdt = account.balances.find(b => b.asset === 'USDT');
      balance = usdt ? parseFloat(usdt.free) : 0;
    }

    if (balance < 1) {
      await saveState(email, state);
      return;
    }

    // ─── Position sizing – max $0.50 ──────────────────────────────
    let tradeAmount = Math.min(balance * 0.01, 0.50);
    const quantity = tradeAmount / price;

    const slPercent = 2, tpPercent = 5;
    let stopLoss, takeProfit;
    if (ai.signal === 'BUY') {
      stopLoss = price * (1 - slPercent/100);
      takeProfit = price * (1 + tpPercent/100);
    } else {
      stopLoss = price * (1 + slPercent/100);
      takeProfit = price * (1 - tpPercent/100);
    }

    // ─── Execute trade ──────────────────────────────────────────────
    const tradeId = uuidv4();
    await supabase.from('trades').insert([{
      id: tradeId,
      user_email: email,
      symbol: symbol,
      type: ai.signal,
      entry_price: price,
      quantity: quantity,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      status: 'open',
      opened_at: new Date().toISOString(),
      signal_confidence: ai.confidence,
      signal_reason: ai.reason,
      is_paper: isPaper,
    }]);

    state.activeTradeId = tradeId;
    state.tradesToday++;
    await saveState(email, state);

    console.log(`📈 AGENT: ${ai.signal} ${symbol} at ${price}, amount $${tradeAmount.toFixed(2)}`);

  } catch (error) {
    console.error('Agent loop error:', error.message);
  } finally {
    // Schedule next loop if still running
    const refreshed = await loadState(email);
    if (refreshed.running) {
      setTimeout(() => agentLoop(email), 5000);
    }
  }
}

// ─── Start / Stop endpoints ──────────────────────────────────────
router.post('/start', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const state = await loadState(email);
  if (state.running) return res.json({ status: 'already running' });

  state.running = true;
  state.tradesToday = 0;
  state.dailyLoss = 0;
  state.totalPnL = 0;
  state.consecutiveWins = 0;
  state.consecutiveLosses = 0;
  state.activeTradeId = null;

  // Seed price history
  const user = await supabase.from('users').select('bot_settings').eq('email', email).single();
  const symbol = user.data?.bot_settings?.market || 'BTCUSDT';
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol.replace('/', '')}&interval=1m&limit=50`;
  const response = await fetch(url);
  const data = await response.json();
  state.priceHistory = data.map(c => parseFloat(c[4]));

  await saveState(email, state);

  // Start the loop
  setTimeout(() => agentLoop(email), 1000);

  res.json({ status: 'started' });
});

router.post('/stop', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const state = await loadState(email);
  state.running = false;
  await saveState(email, state);
  res.json({ status: 'stopped' });
});

router.get('/status', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const state = await loadState(email);
  res.json(state);
});

module.exports = router;
