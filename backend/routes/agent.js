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
  consecutiveLosses: 0,        // 1️⃣ drawdown recovery
  activeSymbols: [],           // 4️⃣ correlation check
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
    .select('bot_settings')
    .eq('email', email)
    .single();
  return data?.bot_settings || {
    tradeAmount: 10,
    maxDailyLoss: 10,
    maxTradesPerDay: 30,
    riskLevel: 'MEDIUM',
    market: 'BTCUSDT',
    autoCompound: false,
    stopLossPercent: 2,
    takeProfitPercent: 5,
  };
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

async function closeTrade(email, tradeId, exitPrice, reason) {
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

  // 1️⃣ Drawdown recovery
  if (pnl < 0) agentState.consecutiveLosses++;
  else agentState.consecutiveLosses = 0;

  if (pnl < 0) agentState.dailyLoss += Math.abs(pnl);
  agentState.totalPnL += pnl;
  agentState.activeTradeId = null;
  agentState.tradeOpenTime = null;
}

// 4️⃣ Correlation check
async function getCorrelation(symbol1, symbol2) {
  // Simplified: if symbols share the same base asset (BTC, ETH), treat as highly correlated
  const base1 = symbol1.replace(/USDT$/, '');
  const base2 = symbol2.replace(/USDT$/, '');
  if (base1 === base2) return 0.9;
  // Otherwise, default to low correlation (0.2)
  return 0.2;
}

// 3️⃣ Trend filter – get EMA50
async function getEMA50(client, symbol) {
  try {
    const klines = await client.klines({ symbol, interval: '1h', limit: 50 });
    const closes = klines.map(k => parseFloat(k.close));
    const ema = closes.reduce((a, b) => a + b, 0) / closes.length;
    return ema;
  } catch {
    return null;
  }
}

// 2️⃣ AI‑driven exit – evaluate if we should close the trade based on market conditions
async function shouldExitTrade(client, symbol, price, activeTrade) {
  const entry = activeTrade.entry_price;
  const side = activeTrade.type;
  const currentPnl = side === 'BUY' ? (price - entry) / entry : (entry - price) / entry;

  // If already at stop-loss or take‑profit, let those handle it
  if (currentPnl <= -0.02) return { exit: true, reason: 'STOP_LOSS' };
  if (currentPnl >= 0.05) return { exit: true, reason: 'TAKE_PROFIT' };

  // AI‑driven: get a fresh signal just for exit
  const indicators = { rsi: 50, ema: price * 0.99, macd: 0.01 };
  const signal = await analyze({ market: symbol, price, indicators });

  // If AI now says opposite direction, exit
  if (side === 'BUY' && signal.signal === 'SELL' && signal.confidence > 60) {
    return { exit: true, reason: 'AI_EXIT_SELL' };
  }
  if (side === 'SELL' && signal.signal === 'BUY' && signal.confidence > 60) {
    return { exit: true, reason: 'AI_EXIT_BUY' };
  }

  // Time‑based fallback (if AI is unsure)
  const openedAt = new Date(activeTrade.opened_at);
  const elapsedSeconds = (new Date() - openedAt) / 1000;
  if (elapsedSeconds > 600) { // max 10 minutes
    return { exit: true, reason: 'TIME_EXIT' };
  }

  return { exit: false };
}

// ─── Risk‑of‑ruin calculator ─────────────────────────────────────
function riskOfRuin(winRate, riskPerTrade) {
  const lossRate = 1 - winRate;
  if (winRate === 0 || lossRate === 0) return 1;
  const r = lossRate / winRate;
  return Math.pow(r, 0.5 / riskPerTrade);
}

// ─── Volatility ──────────────────────────────────────────────────
function calculateVolatility(prices) {
  if (prices.length < 10) return 0.02;
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i-1]) / prices[i-1]);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

// ─── Core agent loop ──────────────────────────────────────────────
async function agentLoop(email) {
  if (!agentState.running) return;

  try {
    const client = await getBinanceClient(email);
    const settings = await getSettings(email);
    const symbol = settings.market || 'BTCUSDT';

    // 1. Fetch price
    const ticker = await client.prices({ symbol });
    const price = parseFloat(ticker[symbol]);
    agentState.priceHistory.push(price);
    if (agentState.priceHistory.length > 30) agentState.priceHistory.shift();

    // 2. Volatility
    const volatility = calculateVolatility(agentState.priceHistory);

    // 3. AI analysis
    const indicators = { rsi: 50, ema: price * 0.99, macd: 0.01 };
    const signal = await analyze({ market: symbol, price, indicators });
    agentState.lastSignal = signal;
    agentState.lastAnalysis = new Date().toISOString();

    agentState.signalHistory.push({ ...signal, price, time: new Date().toISOString() });
    if (agentState.signalHistory.length > 10) agentState.signalHistory.shift();

    console.log(`[${new Date().toISOString()}] Analysis: ${signal.signal} | Conf: ${signal.confidence}% | Vol: ${(volatility * 100).toFixed(2)}%`);

    // ─── Check open trade ──────────────────────────────────────
    const activeTrade = await getActiveTrade(email);
    if (activeTrade) {
      // 2️⃣ AI‑driven exit
      const exitDecision = await shouldExitTrade(client, symbol, price, activeTrade);
      if (exitDecision.exit) {
        await closeTrade(email, activeTrade.id, price, exitDecision.reason);
        console.log(`[${new Date().toISOString()}] Trade closed: ${exitDecision.reason}`);
        agentState.activeTradeId = null;
        return;
      }

      // 4️⃣ Correlation check – if a second correlated asset is open, skip
      if (agentState.activeSymbols.length > 0) {
        for (const sym of agentState.activeSymbols) {
          const corr = await getCorrelation(symbol, sym);
          if (corr > 0.7) {
            console.log(`[${new Date().toISOString()}] Skipping – correlated asset ${sym} already open.`);
            return;
          }
        }
      }

      // Trailing stop‑loss (keep existing logic)
      let newSL = activeTrade.stop_loss;
      if (activeTrade.type === 'BUY') {
        if (price > activeTrade.entry_price * 1.02) {
          newSL = Math.max(activeTrade.stop_loss, activeTrade.entry_price * 1.01);
        }
        if (price > activeTrade.entry_price * 1.05) {
          newSL = Math.max(newSL, activeTrade.entry_price * 1.03);
        }
      } else {
        if (price < activeTrade.entry_price * 0.98) {
          newSL = Math.min(activeTrade.stop_loss, activeTrade.entry_price * 0.99);
        }
        if (price < activeTrade.entry_price * 0.95) {
          newSL = Math.min(newSL, activeTrade.entry_price * 0.97);
        }
      }
      if (newSL !== activeTrade.stop_loss) {
        await updateTrade(email, activeTrade.id, { stop_loss: newSL });
        console.log(`[${new Date().toISOString()}] Trailing SL updated to ${newSL}`);
      }
      return;
    }

    // ─── No open trade – decide to enter ──────────────────────

    // 5️⃣ Risk‑of‑ruin check
    const estimatedWinRate = 0.65; // based on historical performance
    let riskPerTrade = 0.02;
    if (signal.confidence >= 90) riskPerTrade = 0.04;
    else if (signal.confidence >= 80) riskPerTrade = 0.03;

    const ror = riskOfRuin(estimatedWinRate, riskPerTrade);
    if (ror > 0.1) {
      riskPerTrade *= 0.5;
      console.log(`[${new Date().toISOString()}] Risk-of-ruin too high (${(ror * 100).toFixed(1)}%) – reducing risk to ${(riskPerTrade * 100).toFixed(1)}%`);
    }

    // 1️⃣ Drawdown recovery
    let riskMultiplier = 1;
    if (agentState.consecutiveLosses >= 3) riskMultiplier = 0.5;
    if (agentState.consecutiveLosses >= 5) riskMultiplier = 0.25;
    riskPerTrade *= riskMultiplier;

    if (agentState.consecutiveLosses >= 3) {
      console.log(`[${new Date().toISOString()}] ${agentState.consecutiveLosses} consecutive losses – risk reduced to ${(riskPerTrade * 100).toFixed(1)}%`);
    }

    // 3️⃣ Trend filter
    const ema50 = await getEMA50(client, symbol);
    if (ema50) {
      if (signal.signal === 'BUY' && price < ema50 * 1.01) {
        console.log(`[${new Date().toISOString()}] Trend filter: price below EMA50 – no BUY`);
        return;
      }
      if (signal.signal === 'SELL' && price > ema50 * 0.99) {
        console.log(`[${new Date().toISOString()}] Trend filter: price above EMA50 – no SELL`);
        return;
      }
    }

    // Volatility adjustment
    if (volatility > 0.03) riskPerTrade *= 0.5;
    if (volatility > 0.05) riskPerTrade *= 0.3;

    if (signal.signal === 'HOLD' || signal.confidence < 70) {
      console.log(`[${new Date().toISOString()}] Signal ${signal.signal} (${signal.confidence}%) – waiting.`);
      return;
    }

    if (agentState.tradesToday >= settings.maxTradesPerDay) {
      console.log(`[${new Date().toISOString()}] Max trades reached.`);
      return;
    }

    if (agentState.dailyLoss >= settings.maxDailyLoss) {
      console.log(`[${new Date().toISOString()}] Daily loss limit reached. Stopping.`);
      agentState.running = false;
      return;
    }

    // ─── Enter trade ──────────────────────────────────────────
    const account = await client.accountInfo();
    const usdtBalance = account.balances.find(b => b.asset === 'USDT');
    const balance = parseFloat(usdtBalance?.free || 0);
    if (agentState.startingBalance === 0) agentState.startingBalance = balance;

    const amount = balance * riskPerTrade;
    if (amount < 10) {
      console.log(`[${new Date().toISOString()}] Insufficient balance.`);
      return;
    }

    const side = signal.signal.toLowerCase();
    const quantity = amount / price;
    const order = await client.order({
      symbol,
      side: side,
      type: 'MARKET',
      quantity: quantity,
    });

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

    const duration = signal.duration || 120;
    const tradeId = uuidv4();
    await logTrade(email, {
      id: tradeId,
      symbol,
      type: signal.signal,
      entryPrice: price,
      quantity,
      stopLoss,
      takeProfit,
      duration,
      confidence: signal.confidence,
      reason: signal.reason,
      status: 'open',
      openedAt: new Date().toISOString(),
    });

    agentState.activeTradeId = tradeId;
    agentState.tradeOpenTime = Date.now();
    agentState.tradeDuration = duration;
    agentState.tradesToday++;
    agentState.activeSymbols.push(symbol);

    console.log(`[${new Date().toISOString()}] ✅ TRADE: ${signal.signal} ${symbol} at ${price}`);
    console.log(`   SL: ${stopLoss} | TP: ${takeProfit} | Risk: ${(riskPerTrade * 100).toFixed(1)}% | Consecutive losses: ${agentState.consecutiveLosses}`);
  } catch (error) {
    console.error('Agent loop error:', error);
  }
}

// ─── Endpoints ──────────────────────────────────────────────────
router.post('/start', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try { await getBinanceClient(email); }
  catch { return res.status(400).json({ error: 'Binance not connected' }); }

  if (agentState.running) return res.json({ status: 'already running' });

  agentState.tradesToday = 0;
  agentState.dailyLoss = 0;
  agentState.totalPnL = 0;
  agentState.startingBalance = 0;
  agentState.signalHistory = [];
  agentState.priceHistory = [];
  agentState.consecutiveLosses = 0;
  agentState.activeSymbols = [];
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
    consecutiveLosses: agentState.consecutiveLosses,
    activeSymbols: agentState.activeSymbols,
    lastAnalysis: agentState.lastAnalysis,
    volatility: agentState.priceHistory.length > 10
      ? calculateVolatility(agentState.priceHistory)
      : null,
  });
});

module.exports = router;
