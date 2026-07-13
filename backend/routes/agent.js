const router = require('express').Router();
const supabase = require('../db');
const { analyze } = require('./ai');
const { v4: uuidv4 } = require('uuid');

let agentState = {
  running: false,
  intervalId: null,
  tradesToday: 0,
  dailyLoss: 0,
  totalPnL: 0,
  activeTradeId: null,
  tradeOpenTime: null,
  paperBalance: 1000,
  priceHistory: [], // stores last 50 close prices
};

async function getSettings(email) {
  const { data, error } = await supabase
    .from('users')
    .select('bot_settings, paper_balance')
    .eq('email', email)
    .single();
  if (data?.paper_balance !== undefined) agentState.paperBalance = data.paper_balance;
  return data?.bot_settings || {
    maxDailyLoss: 10,
    maxTradesPerDay: 30,
    market: 'BTCUSDT',
    stopLossPercent: 2,
    takeProfitPercent: 5,
    paperMode: false,
  };
}

async function updatePaperBalance(email, newBalance) {
  await supabase.from('users').update({ paper_balance: newBalance }).eq('email', email);
  agentState.paperBalance = newBalance;
}

async function logTrade(email, trade) {
  await supabase.from('trades').insert([{
    id: trade.id || uuidv4(),
    user_email: email,
    symbol: trade.symbol,
    type: trade.type,
    entry_price: trade.entryPrice,
    exit_price: trade.exitPrice || null,
    quantity: trade.quantity,
    pnl: trade.pnl || 0,
    opened_at: trade.openedAt || new Date().toISOString(),
    closed_at: trade.closedAt || null,
    status: trade.status || 'open',
    stop_loss: trade.stopLoss,
    take_profit: trade.takeProfit,
    duration: trade.duration,
    signal_confidence: trade.confidence,
    signal_reason: trade.reason,
    is_paper: trade.isPaper || false,
  }]);
}

async function getActiveTrade(email) {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('user_email', email)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(1);
  if (error) return null;
  return data?.[0] || null;
}

async function closeTrade(email, tradeId, exitPrice, reason, isPaper) {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('id', tradeId)
    .single();
  if (error || !data) return;

  const pnl = (data.type === 'BUY')
    ? (exitPrice - data.entry_price) * data.quantity
    : (data.entry_price - exitPrice) * data.quantity;

  await supabase
    .from('trades')
    .update({
      exit_price: exitPrice,
      pnl: pnl,
      status: 'closed',
      closed_at: new Date().toISOString(),
      close_reason: reason,
    })
    .eq('id', tradeId);

  if (isPaper) {
    const newBalance = agentState.paperBalance + pnl;
    await updatePaperBalance(email, newBalance);
  }

  if (pnl < 0) agentState.dailyLoss += Math.abs(pnl);
  agentState.totalPnL += pnl;
  agentState.activeTradeId = null;
  agentState.tradeOpenTime = null;
}

// ─── Compute RSI from price array ──────────────────────────────
function computeRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i-1];
    if (diff >= 0) gains += diff;
    else losses += -diff;
  }
  const avgGain = gains / (prices.length - 1);
  const avgLoss = losses / (prices.length - 1);
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ─── Compute MACD (simplified) ──────────────────────────────────
function computeMACD(prices, fast = 12, slow = 26) {
  if (prices.length < slow) return 0;
  const emaFast = prices.slice(-fast).reduce((a,b) => a+b, 0) / Math.min(fast, prices.length);
  const emaSlow = prices.slice(-slow).reduce((a,b) => a+b, 0) / Math.min(slow, prices.length);
  return emaFast - emaSlow;
}

async function agentLoop(email) {
  if (!agentState.running) return;

  try {
    const settings = await getSettings(email);
    const symbol = settings.market || 'BTCUSDT';
    const isPaper = settings.paperMode || false;

    // Fetch current price from Binance
    const priceRes = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    const priceData = await priceRes.json();
    const price = parseFloat(priceData.price);
    if (!price) return;

    // Update price history (keep last 50)
    agentState.priceHistory.push(price);
    if (agentState.priceHistory.length > 50) agentState.priceHistory.shift();

    // Check open trade
    const activeTrade = await getActiveTrade(email);
    if (activeTrade) {
      const entry = activeTrade.entry_price;
      const sl = activeTrade.stop_loss;
      const tp = activeTrade.take_profit;
      const openedAt = new Date(activeTrade.opened_at);
      const elapsedSeconds = (new Date() - openedAt) / 1000;
      const duration = activeTrade.duration || 120;
      let closed = false;

      if (activeTrade.type === 'BUY') {
        if (price <= sl) { await closeTrade(email, activeTrade.id, price, 'STOP_LOSS', isPaper); closed = true; }
        else if (price >= tp) { await closeTrade(email, activeTrade.id, price, 'TAKE_PROFIT', isPaper); closed = true; }
      } else {
        if (price >= sl) { await closeTrade(email, activeTrade.id, price, 'STOP_LOSS', isPaper); closed = true; }
        else if (price <= tp) { await closeTrade(email, activeTrade.id, price, 'TAKE_PROFIT', isPaper); closed = true; }
      }
      if (!closed && elapsedSeconds >= duration) {
        await closeTrade(email, activeTrade.id, price, 'TIME_EXIT', isPaper);
        closed = true;
      }
      if (closed) {
        agentState.activeTradeId = null;
        agentState.tradeOpenTime = null;
      }
      return;
    }

    // No open trade – get AI signal with real indicators
    const prices = agentState.priceHistory;
    let rsi = 50, macd = 0;
    if (prices.length >= 20) {
      rsi = computeRSI(prices);
      macd = computeMACD(prices);
    }

    // Call AI endpoint with real indicators
    const aiRes = await fetch('http://localhost:10000/api/ai/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        market: symbol,
        price,
        indicators: { rsi, ema: prices[prices.length-1] || price, macd },
        email,
      }),
    });
    const signal = await aiRes.json();

    if (signal.signal === 'HOLD' || signal.confidence < 60) return;
    if (agentState.tradesToday >= settings.maxTradesPerDay) return;
    if (agentState.dailyLoss >= settings.maxDailyLoss) {
      agentState.running = false;
      return;
    }

    // Position sizing
    const balance = isPaper ? agentState.paperBalance : 1000;
    if (balance < 10) return;
    const riskPerTrade = 0.02;
    const amount = balance * riskPerTrade;
    const quantity = amount / price;

    const slPercent = settings.stopLossPercent || 2;
    const tpPercent = settings.takeProfitPercent || 5;
    let stopLoss, takeProfit;
    if (signal.signal === 'BUY') {
      stopLoss = price * (1 - slPercent / 100);
      takeProfit = price * (1 + tpPercent / 100);
    } else {
      stopLoss = price * (1 + slPercent / 100);
      takeProfit = price * (1 - tpPercent / 100);
    }

    const tradeId = uuidv4();
    await logTrade(email, {
      id: tradeId,
      symbol,
      type: signal.signal,
      entryPrice: price,
      quantity,
      stopLoss,
      takeProfit,
      duration: 120,
      confidence: signal.confidence,
      reason: signal.reason,
      status: 'open',
      openedAt: new Date().toISOString(),
      isPaper: true,
    });

    agentState.activeTradeId = tradeId;
    agentState.tradeOpenTime = Date.now();
    agentState.tradesToday++;

    console.log(`📄 PAPER TRADE: ${signal.signal} ${symbol} at ${price} (balance: $${agentState.paperBalance.toFixed(2)})`);
  } catch (error) {
    console.error('Agent loop error:', error);
  }
}

router.post('/start', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  if (agentState.running) return res.json({ status: 'already running' });

  agentState.tradesToday = 0;
  agentState.dailyLoss = 0;
  agentState.totalPnL = 0;
  agentState.priceHistory = [];

  const user = await supabase.from('users').select('paper_balance').eq('email', email).single();
  if (user.data) agentState.paperBalance = user.data.paper_balance || 1000;

  agentState.intervalId = setInterval(() => agentLoop(email), 60000);
  agentState.running = true;
  res.json({ status: 'started' });
});

router.post('/stop', async (req, res) => {
  if (agentState.intervalId) clearInterval(agentState.intervalId);
  agentState.running = false;
  res.json({ status: 'stopped' });
});

router.get('/status', async (req, res) => {
  res.json({
    running: agentState.running,
    tradesToday: agentState.tradesToday,
    dailyLoss: agentState.dailyLoss,
    totalPnL: agentState.totalPnL,
    activeTradeId: agentState.activeTradeId,
    paperBalance: agentState.paperBalance,
  });
});

module.exports = router;
