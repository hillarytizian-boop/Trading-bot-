const router = require('express').Router();
const supabase = require('../db');
const Binance = require('binance-api-node').default;
const { analyze } = require('./ai');
const { v4: uuidv4 } = require('uuid');

let agentState = {
  running: false,
  intervalId: null,
  lastSignal: null,
  signalHistory: [],
  tradesToday: 0,
  dailyLoss: 0,
  totalPnL: 0,
  startingBalance: 0,
  activeTradeId: null,
  tradeOpenTime: null,
  tradeDuration: 120,
  lastAnalysis: null,
  priceHistory: [],
  consecutiveLosses: 0,
  activeSymbols: [],
  paperBalance: 1000,
};

// ─── Helpers ──────────────────────────────────────────────────────
async function getBinanceClient(email) {
  const { data, error } = await supabase
    .from('users')
    .select('binance_api_key, binance_secret_key')
    .eq('email', email)
    .single();
  if (error || !data?.binance_api_key) throw new Error('Binance not connected');
  return Binance({ apiKey: data.binance_api_key, secretKey: data.binance_secret_key });
}

async function getSettings(email) {
  const { data, error } = await supabase
    .from('users')
    .select('bot_settings, paper_balance')
    .eq('email', email)
    .single();
  if (data?.paper_balance !== undefined) agentState.paperBalance = data.paper_balance;
  return data?.bot_settings || {
    tradeAmount: 10,
    maxDailyLoss: 10,
    maxTradesPerDay: 30,
    riskLevel: 'MEDIUM',
    market: 'BTCUSDT',
    autoCompound: false,
    stopLossPercent: 2,
    takeProfitPercent: 5,
    paperMode: false,
  };
}

async function updatePaperBalance(email, newBalance) {
  await supabase
    .from('users')
    .update({ paper_balance: newBalance })
    .eq('email', email);
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

async function updateTrade(email, tradeId, updates) {
  await supabase
    .from('trades')
    .update(updates)
    .eq('id', tradeId)
    .eq('user_email', email);
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

  if (pnl < 0) {
    agentState.consecutiveLosses++;
    agentState.dailyLoss += Math.abs(pnl);
  } else {
    agentState.consecutiveLosses = 0;
  }
  agentState.totalPnL += pnl;
  agentState.activeTradeId = null;
  agentState.tradeOpenTime = null;
}

// ─── Paper trading: simulate entry ──────────────────────────────
async function executePaperTrade(email, symbol, side, price, quantity, settings, signal) {
  const slPercent = settings.stopLossPercent || 2;
  const tpPercent = settings.takeProfitPercent || 5;
  let stopLoss, takeProfit;
  if (side === 'buy') {
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
    duration: signal.duration || 120,
    confidence: signal.confidence,
    reason: signal.reason,
    status: 'open',
    openedAt: new Date().toISOString(),
    isPaper: true,
  });

  agentState.activeTradeId = tradeId;
  agentState.tradeOpenTime = Date.now();
  agentState.tradeDuration = signal.duration || 120;
  agentState.tradesToday++;

  console.log(`📄 PAPER TRADE: ${signal.signal} ${symbol} at ${price} (balance: $${agentState.paperBalance.toFixed(2)})`);
}

// ─── Core agent loop ──────────────────────────────────────────────
async function agentLoop(email) {
  if (!agentState.running) return;

  try {
    const settings = await getSettings(email);
    const symbol = settings.market || 'BTCUSDT';
    const isPaper = settings.paperMode || false;

    // Get price – either from Binance (real) or public feed for paper
    let price;
    let client;
    try {
      client = await getBinanceClient(email);
      const ticker = await client.prices({ symbol });
      price = parseFloat(ticker[symbol]);
    } catch (err) {
      if (isPaper) {
        // Fallback to public Binance endpoint
        const fallback = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
        const data = await fallback.json();
        price = parseFloat(data.price);
      } else {
        throw err;
      }
    }

    if (!price) return;

    agentState.priceHistory.push(price);
    if (agentState.priceHistory.length > 30) agentState.priceHistory.shift();

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

      // Trailing stop
      let newSL = sl;
      if (activeTrade.type === 'BUY') {
        if (price > entry * 1.02) newSL = Math.max(sl, entry * 1.01);
        if (price > entry * 1.05) newSL = Math.max(newSL, entry * 1.03);
        if (price <= sl) { await closeTrade(email, activeTrade.id, price, 'STOP_LOSS', isPaper); closed = true; }
        else if (price >= tp) { await closeTrade(email, activeTrade.id, price, 'TAKE_PROFIT', isPaper); closed = true; }
      } else {
        if (price < entry * 0.98) newSL = Math.min(sl, entry * 0.99);
        if (price < entry * 0.95) newSL = Math.min(newSL, entry * 0.97);
        if (price >= sl) { await closeTrade(email, activeTrade.id, price, 'STOP_LOSS', isPaper); closed = true; }
        else if (price <= tp) { await closeTrade(email, activeTrade.id, price, 'TAKE_PROFIT', isPaper); closed = true; }
      }

      if (newSL !== sl && !closed) {
        await updateTrade(email, activeTrade.id, { stop_loss: newSL });
      }

      if (!closed && elapsedSeconds >= duration) {
        await closeTrade(email, activeTrade.id, price, 'TIME_EXIT', isPaper);
        closed = true;
      }

      if (closed) {
        agentState.activeTradeId = null;
        agentState.tradeOpenTime = null;
        if (isPaper) {
          // Refresh paper balance from DB
          const user = await supabase
            .from('users')
            .select('paper_balance')
            .eq('email', email)
            .single();
          if (user.data) agentState.paperBalance = user.data.paper_balance;
        }
      }
      return;
    }

    // No open trade – get signal
    const indicators = { rsi: 50, ema: price * 0.99, macd: 0.01 };
    const signal = await analyze({ market: symbol, price, indicators });
    agentState.lastSignal = signal;

    if (signal.signal === 'HOLD' || signal.confidence < 70) return;
    if (agentState.tradesToday >= settings.maxTradesPerDay) return;
    if (agentState.dailyLoss >= settings.maxDailyLoss) {
      agentState.running = false;
      return;
    }

    // Determine balance to use
    let balance;
    if (isPaper) {
      balance = agentState.paperBalance;
      if (balance < 10) {
        console.log('Paper balance too low');
        return;
      }
    } else {
      const account = await client.accountInfo();
      const usdtBalance = account.balances.find(b => b.asset === 'USDT');
      balance = parseFloat(usdtBalance?.free || 0);
      if (balance < 10) return;
    }

    let riskPerTrade = 0.02;
    if (signal.confidence >= 90) riskPerTrade = 0.04;
    else if (signal.confidence >= 80) riskPerTrade = 0.03;

    // Volatility adjustment
    const volatility = agentState.priceHistory.length > 10
      ? (() => {
          const prices = agentState.priceHistory;
          const returns = [];
          for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i] - prices[i-1]) / prices[i-1]);
          }
          const mean = returns.reduce((a,b) => a+b, 0) / returns.length;
          const variance = returns.reduce((a,b) => a + (b - mean) ** 2, 0) / returns.length;
          return Math.sqrt(variance);
        })()
      : 0.02;
    if (volatility > 0.03) riskPerTrade *= 0.5;
    if (volatility > 0.05) riskPerTrade *= 0.3;

    const amount = balance * riskPerTrade;
    const quantity = amount / price;
    const side = signal.signal.toLowerCase();

    if (isPaper) {
      await executePaperTrade(email, symbol, side, price, quantity, settings, signal);
    } else {
      const order = await client.order({
        symbol,
        side: side,
        type: 'MARKET',
        quantity: quantity,
      });
      // Log real trade
      const slPercent = settings.stopLossPercent || 2;
      const tpPercent = settings.takeProfitPercent || 5;
      let stopLoss, takeProfit;
      if (side === 'buy') {
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
        duration: signal.duration || 120,
        confidence: signal.confidence,
        reason: signal.reason,
        status: 'open',
        openedAt: new Date().toISOString(),
        isPaper: false,
      });
      agentState.activeTradeId = tradeId;
      agentState.tradeOpenTime = Date.now();
      agentState.tradeDuration = signal.duration || 120;
      agentState.tradesToday++;
      console.log(`REAL TRADE: ${signal.signal} ${symbol} at ${price}`);
    }
  } catch (error) {
    console.error('Agent loop error:', error);
  }
}

// ─── Endpoints ──────────────────────────────────────────────────
router.post('/start', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  if (agentState.running) return res.json({ status: 'already running' });

  // Reset daily counters
  agentState.tradesToday = 0;
  agentState.dailyLoss = 0;
  agentState.totalPnL = 0;
  agentState.consecutiveLosses = 0;
  agentState.priceHistory = [];

  // Fetch paper balance if exists
  const user = await supabase
    .from('users')
    .select('paper_balance')
    .eq('email', email)
    .single();
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
    lastSignal: agentState.lastSignal,
    signalHistory: agentState.signalHistory,
    tradesToday: agentState.tradesToday,
    dailyLoss: agentState.dailyLoss,
    totalPnL: agentState.totalPnL,
    startingBalance: agentState.startingBalance,
    activeTradeId: agentState.activeTradeId,
    tradeDuration: agentState.tradeDuration,
    lastAnalysis: agentState.lastAnalysis,
    consecutiveLosses: agentState.consecutiveLosses,
    paperBalance: agentState.paperBalance,
  });
});

module.exports = router;
