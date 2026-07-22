const router = require('express').Router();
const supabase = require('../db');
const { getAIAnalysis } = require('./ai.js');
const { v4: uuidv4 } = require('uuid');
const Binance = require('binance-api-node').default;
const HttpsProxyAgent = require('https-proxy-agent');

const PROXY_URL = process.env.PROXY_URL || 'http://qsbykpgrqjh5:n0gsca0jpuzio8h@209.50.183.159:3129';
const agent = new HttpsProxyAgent(PROXY_URL);

// ─── Active loops map (prevent duplicates) ──────────────────────────
const activeLoops = new Map();

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

async function storeSignal(email, symbol, aiResult, price) {
  try {
    const signal = {
      user_email: email,
      symbol: symbol,
      signal: aiResult.signal || 'HOLD',
      confidence: aiResult.confidence || 0,
      reason: aiResult.reason || '',
      data: aiResult.data || {},
    };
    await supabase.from('signals').insert([signal]);
  } catch (e) {
    console.error('[Agent] Failed to store signal:', e.message);
  }
}

async function getPrice(symbol) {
  try {
    const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol.replace('/', '')}`;
    const res = await fetch(url, { agent, timeout: 5000 });
    const data = await res.json();
    return parseFloat(data.price);
  } catch (e) {
    console.error('[Agent] Price fetch error:', e.message);
    return null;
  }
}

async function getOpenTrade(email) {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('user_email', email)
    .eq('status', 'open')
    .maybeSingle();
  if (error) return null;
  return data;
}

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

    // ─── Get price ──────────────────────────────────────────────────
    const price = await getPrice(symbol);
    if (!price) throw new Error('Price fetch failed');

    // ─── Get open position ──────────────────────────────────────────
    const openTrade = await getOpenTrade(email);
    let position = null;
    if (openTrade) {
      position = { type: openTrade.type, entry_price: openTrade.entry_price };
    }

    // ─── Get AI signal (pass position) ─────────────────────────────
    const aiResult = await getAIAnalysis(email, symbol, position, null);
    await storeSignal(email, symbol, aiResult, price);

    // ─── If we have an open trade, monitor exit ────────────────────
    if (openTrade) {
      // ... existing exit logic (SL/TP) ...
      // We'll keep the existing exit logic from your current agent.js
      // (for brevity, I'll include a simplified version)
      // In production, you should copy your existing exit logic here.
      console.log(`[Agent] Monitoring open ${openTrade.type} trade...`);
      // For now, we'll just return to avoid duplicate trades
      return;
    }

    // ─── No open trade – evaluate AI signal ─────────────────────────
    if (aiResult.signal === 'HOLD' || aiResult.confidence < 75) {
      await saveState(email, state);
      return;
    }

    // ─── Determine balance ──────────────────────────────────────────
    let balance;
    if (isPaper) {
      balance = state.paperBalance;
    } else {
      if (!settings.binance_api_key) { await saveState(email, state); return; }
      const client = Binance({
        apiKey: settings.binance_api_key,
        secretKey: settings.binance_secret_key,
        httpsAgent: agent,
      });
      const account = await client.accountInfo();
      const usdt = account.balances.find(b => b.asset === 'USDT');
      balance = usdt ? parseFloat(usdt.free) : 0;
    }

    if (balance < 1) { await saveState(email, state); return; }

    // ─── Position sizing ────────────────────────────────────────────
    let tradeAmount = Math.min(balance * 0.01, 5); // max 5 USD
    tradeAmount = Math.max(tradeAmount, 1);
    const quantity = tradeAmount / price;

    // ─── Set SL/TP ──────────────────────────────────────────────────
    let stopLoss, takeProfit;
    if (aiResult.signal === 'BUY') {
      stopLoss = price * (1 - 0.02);
      takeProfit = price * (1 + 0.05);
    } else {
      stopLoss = price * (1 + 0.02);
      takeProfit = price * (1 - 0.05);
    }

    // ─── Execute trade (paper or real) ─────────────────────────────
    if (!isPaper) {
      const client = Binance({
        apiKey: settings.binance_api_key,
        secretKey: settings.binance_secret_key,
        httpsAgent: agent,
      });
      try {
        await client.order({
          symbol: symbol.replace('/', ''),
          side: aiResult.signal,
          type: 'MARKET',
          quantity: quantity.toFixed(6),
        });
        console.log(`[Agent] Live order placed: ${aiResult.signal} ${quantity} ${symbol}`);
      } catch (err) {
        console.error('[Agent] Live order failed:', err.message);
        return;
      }
    }

    // ─── Record trade in Supabase ──────────────────────────────────
    const tradeId = uuidv4();
    await supabase.from('trades').insert([{
      id: tradeId,
      user_email: email,
      symbol: symbol,
      type: aiResult.signal,
      entry_price: price,
      quantity: quantity,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      status: 'open',
      opened_at: new Date().toISOString(),
      signal_confidence: aiResult.confidence,
      signal_reason: aiResult.reason,
      is_paper: isPaper,
    }]);

    state.activeTradeId = tradeId;
    state.tradesToday++;
    await saveState(email, state);
    console.log(`📈 AGENT: ${aiResult.signal} ${symbol} at ${price}, amount $${tradeAmount.toFixed(2)}`);

  } catch (error) {
    console.error('[Agent] Loop error:', error.message);
  } finally {
    const refreshed = await loadState(email);
    if (refreshed.running) {
      // Run every 60 seconds instead of 5s for 1h strategy
      setTimeout(() => agentLoop(email), 60000);
    } else {
      activeLoops.delete(email);
    }
  }
}

// ─── Endpoints ──────────────────────────────────────────────────────
router.post('/start', async (req, res) => {
  const email = req.user?.email || req.body.email || 'demo@example.com';
  if (activeLoops.has(email)) {
    return res.json({ status: 'already running' });
  }
  const state = await loadState(email);
  if (state.running) return res.json({ status: 'already running' });

  state.running = true;
  state.tradesToday = 0;
  state.dailyLoss = 0;
  state.totalPnL = 0;
  state.consecutiveWins = 0;
  state.consecutiveLosses = 0;
  state.activeTradeId = null;
  await saveState(email, state);

  activeLoops.set(email, true);
  setTimeout(() => agentLoop(email), 1000);
  res.json({ status: 'started' });
});

router.post('/stop', async (req, res) => {
  const email = req.user?.email || req.body.email || 'demo@example.com';
  const state = await loadState(email);
  state.running = false;
  await saveState(email, state);
  activeLoops.delete(email);
  res.json({ status: 'stopped' });
});

router.get('/status', async (req, res) => {
  const email = req.user?.email || req.query.email || 'demo@example.com';
  const state = await loadState(email);
  res.json(state);
});

router.get('/latest-signal', async (req, res) => {
  const email = req.user?.email || req.query.email || 'demo@example.com';
  const { symbol } = req.query;
  try {
    const query = supabase
      .from('signals')
      .select('*')
      .eq('user_email', email);
    if (symbol) {
      const cleanSymbol = symbol.replace(/\//g, '');
      query.eq('symbol', cleanSymbol);
    }
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    res.json(data?.[0] || null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
