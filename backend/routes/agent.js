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
  priceHistory: [], // for volatility calculation
};

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

  if (pnl < 0) agentState.dailyLoss += Math.abs(pnl);
  agentState.totalPnL += pnl;
  agentState.activeTradeId = null;
  agentState.tradeOpenTime = null;
}

// ─── Volatility calculation ──────────────────────────────────────
function calculateVolatility(prices) {
  if (prices.length < 10) return 0.02; // default 2%
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i-1]) / prices[i-1]);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

// ─── Multi‑timeframe confirmation ────────────────────────────────
async function getMultiTimeframeSignals(client, symbol, price, indicators) {
  // Simulate 1min, 5min, 15min using different RSI values
  // In production, fetch actual historical data
  const signals = [];
  const timeframes = [
    { name: '1m', rsiOffset: 0, emaOffset: 0.99 },
    { name: '5m', rsiOffset: 3, emaOffset: 0.98 },
    { name: '15m', rsiOffset: -2, emaOffset: 0.97 },
  ];

  for (const tf of timeframes) {
    const tfIndicators = {
      rsi: Math.min(100, Math.max(0, indicators.rsi + tf.rsiOffset)),
      ema: price * tf.emaOffset,
      macd: indicators.macd + (tf.rsiOffset * 0.01),
    };
    const signal = await analyze({ market: symbol, price, indicators: tfIndicators });
    signals.push({ timeframe: tf.name, signal: signal.signal, confidence: signal.confidence });
  }
  return signals;
}

// ─── Core agent loop ──────────────────────────────────────────────
async function agentLoop(email) {
  if (!agentState.running) return;

  try {
    const client = await getBinanceClient(email);
    const settings = await getSettings(email);
    const symbol = settings.market || 'BTCUSDT';

    // 1. Fetch price and store history
    const ticker = await client.prices({ symbol });
    const price = parseFloat(ticker[symbol]);
    agentState.priceHistory.push(price);
    if (agentState.priceHistory.length > 30) agentState.priceHistory.shift();

    // 2. Calculate volatility
    const volatility = calculateVolatility(agentState.priceHistory);

    // 3. Run AI analysis
    const indicators = { rsi: 50, ema: price * 0.99, macd: 0.01 };
    const signal = await analyze({ market: symbol, price, indicators });
    agentState.lastSignal = signal;
    agentState.lastAnalysis = new Date().toISOString();

    // Store signal history
    agentState.signalHistory.push({ ...signal, price, time: new Date().toISOString() });
    if (agentState.signalHistory.length > 10) agentState.signalHistory.shift();

    console.log(`[${new Date().toISOString()}] Analysis: ${signal.signal} | Conf: ${signal.confidence}% | Vol: ${(volatility * 100).toFixed(2)}% | Dur: ${signal.duration}s`);

    // 4. Check for open trade (SL/TP/Time exit + trailing stop)
    const activeTrade = await getActiveTrade(email);
    if (activeTrade) {
      const entry = activeTrade.entry_price;
      const sl = activeTrade.stop_loss;
      const tp = activeTrade.take_profit;
      const openedAt = new Date(activeTrade.opened_at);
      const now = new Date();
      const elapsedSeconds = (now - openedAt) / 1000;
      const duration = activeTrade.duration || 120;

      let closed = false;

      // ─── Trailing stop‑loss ──────────────────────────────
      let newSL = sl;
      if (activeTrade.type === 'BUY') {
        if (price > entry * 1.02) {
          newSL = Math.max(sl, entry * 1.01); // move to 1% profit
        }
        if (price > entry * 1.05) {
          newSL = Math.max(newSL, entry * 1.03); // move to 3% profit
        }
        if (price <= sl) { await closeTrade(email, activeTrade.id, price, 'STOP_LOSS'); closed = true; }
        else if (price >= tp) { await closeTrade(email, activeTrade.id, price, 'TAKE_PROFIT'); closed = true; }
      } else {
        if (price < entry * 0.98) {
          newSL = Math.min(sl, entry * 0.99);
        }
        if (price < entry * 0.95) {
          newSL = Math.min(newSL, entry * 0.97);
        }
        if (price >= sl) { await closeTrade(email, activeTrade.id, price, 'STOP_LOSS'); closed = true; }
        else if (price <= tp) { await closeTrade(email, activeTrade.id, price, 'TAKE_PROFIT'); closed = true; }
      }

      // Update stop‑loss if it moved
      if (newSL !== sl && !closed) {
        await updateTrade(email, activeTrade.id, { stop_loss: newSL });
        console.log(`[${new Date().toISOString()}] Trailing SL updated to ${newSL}`);
      }

      // Time‑based exit
      if (!closed && elapsedSeconds >= duration) {
        await closeTrade(email, activeTrade.id, price, 'TIME_EXIT');
        closed = true;
      }

      if (closed) {
        agentState.activeTradeId = null;
        agentState.tradeOpenTime = null;
        console.log(`[${new Date().toISOString()}] Trade closed.`);
      }
      return;
    }

    // 5. No open trade – decide whether to enter

    // ─── Multi‑timeframe confirmation ──────────────────────
    const tfSignals = await getMultiTimeframeSignals(client, symbol, price, indicators);
    const tfAgreement = tfSignals.filter(s => s.signal === signal.signal).length;
    if (tfAgreement < 2) {
      console.log(`[${new Date().toISOString()}] Timeframes disagree (${tfAgreement}/3) – waiting.`);
      return;
    }

    // ─── Volatility adjustment ──────────────────────────────
    let riskPerTrade = 0.02; // default 2%
    if (signal.confidence >= 90) riskPerTrade = 0.04;
    else if (signal.confidence >= 80) riskPerTrade = 0.03;

    // Reduce risk in high volatility
    if (volatility > 0.03) riskPerTrade *= 0.5;
    if (volatility > 0.05) riskPerTrade *= 0.3;

    // ─── Daily profit target ────────────────────────────────
    const dailyProfitTarget = 0.05; // 5%
    if (agentState.totalPnL >= agentState.startingBalance * dailyProfitTarget) {
      console.log(`[${new Date().toISOString()}] ✅ Daily profit target reached (${(dailyProfitTarget * 100).toFixed(0)}%). Stopping.`);
      agentState.running = false;
      return;
    }

    // ─── Entry conditions ────────────────────────────────────
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

    // 6. Enter trade
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

    console.log(`[${new Date().toISOString()}] ✅ TRADE: ${signal.signal} ${symbol} at ${price}`);
    console.log(`   SL: ${stopLoss} | TP: ${takeProfit} | Duration: ${duration}s | Risk: ${(riskPerTrade * 100).toFixed(1)}%`);
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
    volatility: agentState.priceHistory.length > 10
      ? calculateVolatility(agentState.priceHistory)
      : null,
  });
});

module.exports = router;
