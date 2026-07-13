const router = require('express').Router();
const supabase = require('../db');
const Binance = require('binance-api-node').default;
const { analyze } = require('./ai');
const { v4: uuidv4 } = require('uuid');

// ─── STATE ──────────────────────────────────────────────────────────
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
  winRate: 0.5,
  avgWin: 0,
  avgLoss: 0,
  lastTradeResult: null,
};

// ─── HELPERS ──────────────────────────────────────────────────────

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

async function updateTrade(email, tradeId, updates) {
  await supabase.from('trades').update(updates).eq('id', tradeId).eq('user_email', email);
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

// ─── UPGRADE: ATR calculation ──────────────────────────────────────
function calculateATR(prices, period = 14) {
  if (prices.length < period + 1) return 0;
  const tr = [];
  for (let i = 1; i < prices.length; i++) {
    const high = prices[i];
    const low = prices[i] * 0.999; // approximate low (since we only have close)
    const prevClose = prices[i-1];
    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);
    tr.push(Math.max(tr1, tr2, tr3));
  }
  const atr = tr.slice(-period).reduce((a,b) => a+b, 0) / period;
  return atr;
}

// ─── UPGRADE: Market regime detection ──────────────────────────────
function detectRegime(prices) {
  if (prices.length < 20) return { regime: 'ranging', strength: 0 };
  const recent = prices.slice(-20);
  const diffs = [];
  for (let i = 1; i < recent.length; i++) {
    diffs.push(recent[i] - recent[i-1]);
  }
  const avgMove = diffs.reduce((a,b) => a + Math.abs(b), 0) / diffs.length;
  const netMove = recent[recent.length-1] - recent[0];
  const trendStrength = Math.abs(netMove) / avgMove;
  let regime = 'ranging';
  if (trendStrength > 2.5) regime = 'trending';
  else if (trendStrength > 1.5) regime = 'weak_trend';
  else regime = 'ranging';
  // Volatility: avgMove / current price
  const volatility = avgMove / recent[recent.length-1];
  return { regime, strength: trendStrength, volatility };
}

// ─── UPGRADE: Kelly-derived position sizing ────────────────────────
function kellySize(winRate, avgWin, avgLoss, maxRisk) {
  if (avgLoss === 0) return maxRisk;
  const b = avgWin / avgLoss;
  const p = winRate;
  const f = (p * b - (1 - p)) / b;
  return Math.min(Math.max(f, 0), maxRisk);
}

// ─── UPGRADE: Correlation check ────────────────────────────────────
function isCorrelated(symbol1, symbol2) {
  const base1 = symbol1.replace(/USDT$/, '');
  const base2 = symbol2.replace(/USDT$/, '');
  if (base1 === base2) return true;
  // BTC and ETH are correlated
  if ((base1 === 'BTC' && base2 === 'ETH') || (base1 === 'ETH' && base2 === 'BTC')) return true;
  return false;
}

// ─── UPGRADE: Time-of-day filter ──────────────────────────────────
function isLowLiquidityHour() {
  const h = new Date().getUTCHours();
  // Asian session low liquidity: 0-2 UTC, 22-24 UTC
  return (h >= 0 && h < 2) || (h >= 22 && h < 24);
}

// ─── UPGRADE: Cool-down after trade ──────────────────────────────
function shouldCooldown(lastResult) {
  if (!lastResult) return false;
  if (lastResult === 'loss') return true; // skip next trade after loss
  return false;
}

// ─── UPGRADE: Dynamic confidence threshold ────────────────────────
function dynamicThreshold(regime, confidence) {
  if (regime === 'trending') {
    return confidence >= 60;
  } else if (regime === 'weak_trend') {
    return confidence >= 70;
  } else { // ranging
    return confidence >= 80;
  }
}

// ─── UPGRADE: Risk-of-ruin check ──────────────────────────────────
function riskOfRuin(winRate, riskPerTrade) {
  const lossRate = 1 - winRate;
  if (winRate === 0 || lossRate === 0) return 1;
  const r = lossRate / winRate;
  return Math.pow(r, 0.5 / riskPerTrade);
}

// ─── CLOSE TRADE ──────────────────────────────────────────────────
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

  // Update performance stats
  if (pnl > 0) {
    agentState.winRate = (agentState.winRate * 0.9 + 0.1);
    agentState.avgWin = (agentState.avgWin * 0.9 + pnl * 0.1);
    agentState.lastTradeResult = 'win';
  } else {
    agentState.winRate = (agentState.winRate * 0.9);
    agentState.avgLoss = (agentState.avgLoss * 0.9 + Math.abs(pnl) * 0.1);
    agentState.lastTradeResult = 'loss';
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

// ─── PAPER TRADE EXECUTION ──────────────────────────────────────
async function executePaperTrade(email, symbol, side, price, quantity, settings, signal, atr) {
  const slPercent = settings.stopLossPercent || 2;
  const tpPercent = settings.takeProfitPercent || 5;
  // UPGRADE: ATR-based stops
  let stopLoss, takeProfit;
  if (atr > 0) {
    const atrSl = atr * 2.5;
    const atrTp = atr * 5;
    if (side === 'buy') {
      stopLoss = price - atrSl;
      takeProfit = price + atrTp;
    } else {
      stopLoss = price + atrSl;
      takeProfit = price - atrTp;
    }
  } else {
    if (side === 'buy') {
      stopLoss = price * (1 - slPercent / 100);
      takeProfit = price * (1 + tpPercent / 100);
    } else {
      stopLoss = price * (1 + slPercent / 100);
      takeProfit = price * (1 - tpPercent / 100);
    }
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

// ─── CORE AGENT LOOP ──────────────────────────────────────────────
async function agentLoop(email) {
  if (!agentState.running) return;

  try {
    const settings = await getSettings(email);
    const symbol = settings.market || 'BTCUSDT';
    const isPaper = settings.paperMode || false;

    // Get price – fallback for paper
    let price;
    let client;
    try {
      client = await getBinanceClient(email);
      const ticker = await client.prices({ symbol });
      price = parseFloat(ticker[symbol]);
    } catch (err) {
      if (isPaper) {
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

    // ─── CHECK ACTIVE TRADE ────────────────────────────────────
    const activeTrade = await getActiveTrade(email);
    if (activeTrade) {
      const entry = activeTrade.entry_price;
      const sl = activeTrade.stop_loss;
      const tp = activeTrade.take_profit;
      const openedAt = new Date(activeTrade.opened_at);
      const elapsedSeconds = (new Date() - openedAt) / 1000;
      const duration = activeTrade.duration || 120;
      let closed = false;

      // Trailing stop based on ATR
      const atr = calculateATR(agentState.priceHistory);
      let newSL = sl;
      if (activeTrade.type === 'BUY') {
        const profit = price - entry;
        if (profit > atr * 1.5) newSL = Math.max(sl, entry + atr * 0.5);
        if (profit > atr * 3) newSL = Math.max(newSL, entry + atr * 1.0);
        if (price <= sl) { await closeTrade(email, activeTrade.id, price, 'STOP_LOSS', isPaper); closed = true; }
        else if (price >= tp) { await closeTrade(email, activeTrade.id, price, 'TAKE_PROFIT', isPaper); closed = true; }
      } else {
        const profit = entry - price;
        if (profit > atr * 1.5) newSL = Math.min(sl, entry - atr * 0.5);
        if (profit > atr * 3) newSL = Math.min(newSL, entry - atr * 1.0);
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
          const user = await supabase.from('users').select('paper_balance').eq('email', email).single();
          if (user.data) agentState.paperBalance = user.data.paper_balance;
        }
      }
      return;
    }

    // ─── NO OPEN TRADE ──────────────────────────────────────────

    // UPGRADE: Market regime detection
    const regime = detectRegime(agentState.priceHistory);
    const volatility = regime.volatility || 0.02;

    // UPGRADE: Time-of-day filter
    if (isLowLiquidityHour()) {
      console.log(`[${new Date().toISOString()}] Low liquidity hour – skipping trade`);
      return;
    }

    // UPGRADE: Cool-down after loss
    if (shouldCooldown(agentState.lastTradeResult)) {
      console.log(`[${new Date().toISOString()}] Cool-down after loss – skipping this tick`);
      return;
    }

    // Get AI signal
    const indicators = { rsi: 50, ema: price * 0.99, macd: 0.01 };
    const signal = await analyze({ market: symbol, price, indicators });
    agentState.lastSignal = signal;

    // UPGRADE: Dynamic confidence threshold
    if (!dynamicThreshold(regime.regime, signal.confidence)) {
      console.log(`[${new Date().toISOString()}] Signal ${signal.signal} (${signal.confidence}%) rejected by regime filter`);
      return;
    }

    if (agentState.tradesToday >= settings.maxTradesPerDay) return;
    if (agentState.dailyLoss >= settings.maxDailyLoss) {
      agentState.running = false;
      return;
    }

    // ─── POSITION SIZING ──────────────────────────────────────

    let balance;
    if (isPaper) {
      balance = agentState.paperBalance;
      if (balance < 10) { console.log('Paper balance too low'); return; }
    } else {
      const account = await client.accountInfo();
      const usdtBalance = account.balances.find(b => b.asset === 'USDT');
      balance = parseFloat(usdtBalance?.free || 0);
      if (balance < 10) return;
    }

    // UPGRADE: Kelly sizing
    const kellyRisk = kellySize(
      agentState.winRate,
      agentState.avgWin || 1,
      agentState.avgLoss || 1,
      0.04 // max 4% risk
    );
    let riskPerTrade = Math.min(Math.max(kellyRisk, 0.01), 0.04);

    // Adjust for volatility
    if (volatility > 0.03) riskPerTrade *= 0.5;
    if (volatility > 0.05) riskPerTrade *= 0.3;

    // UPGRADE: Risk-of-ruin check
    const ror = riskOfRuin(agentState.winRate || 0.5, riskPerTrade);
    if (ror > 0.15) {
      riskPerTrade *= 0.5;
      console.log(`Risk-of-ruin too high (${(ror*100).toFixed(1)}%) – reduced risk`);
    }

    const amount = balance * riskPerTrade;
    const quantity = amount / price;
    const side = signal.signal.toLowerCase();

    // ─── EXECUTE ──────────────────────────────────────────────

    const atr = calculateATR(agentState.priceHistory);
    if (isPaper) {
      await executePaperTrade(email, symbol, side, price, quantity, settings, signal, atr);
    } else {
      // Real trade (similar logic, but with real order)
      const slPercent = settings.stopLossPercent || 2;
      const tpPercent = settings.takeProfitPercent || 5;
      let stopLoss, takeProfit;
      if (atr > 0) {
        const atrSl = atr * 2.5;
        const atrTp = atr * 5;
        if (side === 'buy') {
          stopLoss = price - atrSl;
          takeProfit = price + atrTp;
        } else {
          stopLoss = price + atrSl;
          takeProfit = price - atrTp;
        }
      } else {
        if (side === 'buy') {
          stopLoss = price * (1 - slPercent / 100);
          takeProfit = price * (1 + tpPercent / 100);
        } else {
          stopLoss = price * (1 + slPercent / 100);
          takeProfit = price * (1 - tpPercent / 100);
        }
      }
      // Place real order on Binance
      const order = await client.order({
        symbol,
        side: side,
        type: 'MARKET',
        quantity: quantity,
      });
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

// ─── ENDPOINTS ──────────────────────────────────────────────────

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
  agentState.lastTradeResult = null;
  agentState.winRate = 0.5;
  agentState.avgWin = 1;
  agentState.avgLoss = 1;

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
    winRate: agentState.winRate,
    lastTradeResult: agentState.lastTradeResult,
    regime: detectRegime(agentState.priceHistory).regime,
  });
});

router.post('/reset-paper', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  await supabase.from('users').update({ paper_balance: 1000 }).eq('email', email);
  agentState.paperBalance = 1000;
  res.json({ success: true, paperBalance: 1000 });
});

module.exports = router;
