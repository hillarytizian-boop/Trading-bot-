/**
 * ──────────────────────────────────────────────────────────────────────────────
 *  TRADING AGENT – WebSocket, Multi‑Asset, Adaptive Confidence
 * ──────────────────────────────────────────────────────────────────────────────
 */

const router = require('express').Router();
const supabase = require('../db');
const { getAnalysis } = require('./ai');
const { v4: uuidv4 } = require('uuid');
const technical = require('technicalindicators');
const WebSocket = require('ws');

// ─── CONFIGURATION ──────────────────────────────────────────────────────────────
const CONFIG = {
  timeframes: ['1m', '5m', '15m'],
  minAgreement: 2,
  trendEmaPeriods: [50, 100, 200],
  rsiPeriod: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  bollingerPeriod: 20,
  bollingerStdDev: 2,
  baseConfidenceThreshold: 70,
  minConfidenceThreshold: 50,
  maxConfidenceThreshold: 85,
  riskPerTrade: 0.01,
  maxDailyLoss: 0.05,
  atrMultiplierSL: 2,
  rewardToRisk: 3,
  qualityThreshold: 85,
  minTradeAmount: 0.10,
  symbols: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'],
  logLevel: 'info',
};

// ─── PERSISTENT STATE HELPERS ──────────────────────────────────────────────────

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
      priceHistory: {},
      lastSignal: null,
      lastTradeAttempt: null,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      startingBalance: 1000,
      tradeHistory: [],
      selectedSymbol: 'BTCUSDT',
      wsConnected: false,
    };
  }
  return data.agent_state;
}

async function saveAgentState(email, state) {
  await supabase
    .from('users')
    .update({ agent_state: state })
    .eq('email', email);
}

// ─── HELPER FUNCTIONS ──────────────────────────────────────────────────────────

async function getCandles(symbol, interval, limit = 100) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.map(c => ({
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
    volume: parseFloat(c[5]),
    time: new Date(c[0]),
  }));
}

function computeIndicators(closes) {
  if (closes.length < 30) return null;
  const rsi = technical.RSI.calculate({ values: closes, period: CONFIG.rsiPeriod });
  const ema50 = technical.EMA.calculate({ values: closes, period: 50 });
  const ema100 = technical.EMA.calculate({ values: closes, period: 100 });
  const ema200 = technical.EMA.calculate({ values: closes, period: 200 });
  const macd = technical.MACD.calculate({
    values: closes,
    fastPeriod: CONFIG.macdFast,
    slowPeriod: CONFIG.macdSlow,
    signalPeriod: CONFIG.macdSignal,
  });
  const bb = technical.BollingerBands.calculate({
    values: closes,
    period: CONFIG.bollingerPeriod,
    stdDev: CONFIG.bollingerStdDev,
  });
  return {
    rsi: rsi[rsi.length-1],
    ema50: ema50[ema50.length-1],
    ema100: ema100[ema100.length-1],
    ema200: ema200[ema200.length-1],
    macd: macd[macd.length-1],
    bb: bb[bb.length-1],
    atr: 0.02 * closes[closes.length-1], // placeholder
  };
}

function detectRegime(closes) {
  if (closes.length < 20) return 'unknown';
  const recent = closes.slice(-20);
  const diffs = [];
  for (let i = 1; i < recent.length; i++) {
    diffs.push(recent[i] - recent[i-1]);
  }
  const avgMove = diffs.reduce((a,b) => a + Math.abs(b), 0) / diffs.length;
  const netMove = recent[recent.length-1] - recent[0];
  const strength = Math.abs(netMove) / avgMove;
  if (strength > 2.5) return 'trending';
  if (strength > 1.5) return 'weak_trend';
  return 'ranging';
}

function adaptiveThreshold(regime, base) {
  if (regime === 'trending') return Math.max(CONFIG.minConfidenceThreshold, base - 20);
  if (regime === 'weak_trend') return base;
  return Math.min(CONFIG.maxConfidenceThreshold, base + 10);
}

// ─── WEBSOCKET CONNECTION ──────────────────────────────────────────────────────

let ws = null;
let wsReconnectTimer = null;

function connectWebSocket(email, symbol) {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  const streamName = symbol.toLowerCase().replace('usdt', 'usdt@trade');
  const wsUrl = `wss://stream.binance.com:9443/ws/${streamName}`;
  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log(`[WS] Connected to ${wsUrl}`);
    const state = loadAgentState(email);
    state.wsConnected = true;
    saveAgentState(email, state);
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.p) {
        const price = parseFloat(msg.p);
        const state = await loadAgentState(email);
        if (!state.running) return;
        // Update price history and run analysis
        const symbol = state.selectedSymbol || 'BTCUSDT';
        state.priceHistory[symbol] = state.priceHistory[symbol] || [];
        state.priceHistory[symbol].push(price);
        if (state.priceHistory[symbol].length > 100) state.priceHistory[symbol].shift();
        // Trigger analysis (non‑blocking)
        // We'll call a function that runs the agent loop with the new price
        // We'll use a separate function to avoid overlapping loops
        handlePriceUpdate(email, symbol, price);
      }
    } catch (e) {
      console.error('[WS] Error processing message:', e);
    }
  });

  ws.on('close', () => {
    console.log('[WS] Connection closed, reconnecting in 5s...');
    const state = loadAgentState(email);
    state.wsConnected = false;
    saveAgentState(email, state);
    wsReconnectTimer = setTimeout(() => connectWebSocket(email, symbol), 5000);
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err);
  });
}

// ─── AGENT LOOP (triggered by WebSocket) ─────────────────────────────────────

let processingLock = false;

async function handlePriceUpdate(email, symbol, price) {
  if (processingLock) return;
  processingLock = true;

  try {
    const state = await loadAgentState(email);
    if (!state.running) {
      processingLock = false;
      return;
    }

    // Get current settings
    const settings = (await supabase
      .from('users')
      .select('bot_settings, paper_balance')
      .eq('email', email)
      .single()).data || {};
    state.paperBalance = settings.paper_balance || state.paperBalance;

    // Use the symbol from state (fallback)
    const currentSymbol = state.selectedSymbol || 'BTCUSDT';

    // Ensure we have price history
    if (!state.priceHistory[currentSymbol]) state.priceHistory[currentSymbol] = [];
    state.priceHistory[currentSymbol].push(price);
    if (state.priceHistory[currentSymbol].length > 100) state.priceHistory[currentSymbol].shift();

    const closes = state.priceHistory[currentSymbol];
    if (closes.length < 30) {
      processingLock = false;
      return;
    }

    // Check existing trade
    if (state.activeTradeId) {
      // Monitor trade – we'll do this in a separate function to keep it clean
      // For now, we'll skip monitoring here and let the loop handle it.
      processingLock = false;
      return;
    }

    // Compute indicators
    const ind = computeIndicators(closes);
    if (!ind) {
      processingLock = false;
      return;
    }

    const regime = detectRegime(closes);
    const threshold = adaptiveThreshold(regime, CONFIG.baseConfidenceThreshold);

    // Multi‑timeframe agreement (simplified: use RSI and MACD)
    let preliminarySignal = 'HOLD';
    const rsi = ind.rsi;
    const macd = ind.macd;
    const priceAboveEMA = price > ind.ema50 && ind.ema50 > ind.ema100 && ind.ema100 > ind.ema200;
    const priceBelowEMA = price < ind.ema50 && ind.ema50 < ind.ema100 && ind.ema100 < ind.ema200;

    if (priceAboveEMA && rsi < 50) preliminarySignal = 'BUY';
    else if (priceBelowEMA && rsi > 50) preliminarySignal = 'SELL';

    // AI confirmation
    let aiSignal = { signal: 'HOLD', confidence: 0, reason: '' };
    if (preliminarySignal !== 'HOLD') {
      const aiResult = await getAnalysis(
        currentSymbol,
        price,
        {
          rsi: ind.rsi,
          ema: ind.ema50,
          macd: ind.macd ? ind.macd.MACD : 0,
          trend: priceAboveEMA ? 'bullish' : 'bearish',
          regime,
        },
        email
      );
      aiSignal = aiResult;
    }

    const finalDecision = (preliminarySignal !== 'HOLD' && aiSignal.signal === preliminarySignal && aiSignal.confidence >= threshold)
      ? preliminarySignal
      : 'HOLD';

    // Trade quality score
    let tradeScore = 0;
    if (finalDecision !== 'HOLD') {
      if (priceAboveEMA && finalDecision === 'BUY') tradeScore += 20;
      else if (priceBelowEMA && finalDecision === 'SELL') tradeScore += 20;
      if (ind.rsi < 30 && finalDecision === 'BUY') tradeScore += 15;
      else if (ind.rsi > 70 && finalDecision === 'SELL') tradeScore += 15;
      if (ind.macd && ind.macd.MACD > ind.macd.signal && finalDecision === 'BUY') tradeScore += 10;
      else if (ind.macd && ind.macd.MACD < ind.macd.signal && finalDecision === 'SELL') tradeScore += 10;
      if (ind.bb && finalDecision === 'BUY' && price < ind.bb.lower) tradeScore += 10;
      else if (ind.bb && finalDecision === 'SELL' && price > ind.bb.upper) tradeScore += 10;
      tradeScore = Math.min(tradeScore, 100);
    }

    if (finalDecision === 'HOLD' || tradeScore < CONFIG.qualityThreshold) {
      state.lastTradeAttempt = `HOLD or score ${tradeScore} < ${CONFIG.qualityThreshold}`;
      await saveAgentState(email, state);
      processingLock = false;
      return;
    }

    // Check daily loss
    if (state.dailyLoss >= CONFIG.maxDailyLoss * 1000) {
      state.running = false;
      await saveAgentState(email, state);
      processingLock = false;
      return;
    }

    // Position sizing
    const balance = state.paperBalance;
    const riskAmount = Math.max(CONFIG.minTradeAmount, balance * CONFIG.riskPerTrade);
    const atr = ind.atr || 0.02 * price;
    const slDistance = atr * CONFIG.atrMultiplierSL;
    let stopLoss, takeProfit;
    if (finalDecision === 'BUY') {
      stopLoss = price - slDistance;
      takeProfit = price + slDistance * CONFIG.rewardToRisk;
    } else {
      stopLoss = price + slDistance;
      takeProfit = price - slDistance * CONFIG.rewardToRisk;
    }
    const quantity = riskAmount / price;

    // Execute trade
    const tradeId = uuidv4();
    await supabase
      .from('trades')
      .insert([{
        id: tradeId,
        user_email: email,
        symbol: currentSymbol,
        type: finalDecision,
        entry_price: price,
        quantity: quantity,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        duration: 120,
        signal_confidence: aiSignal.confidence,
        signal_reason: aiSignal.reason || `Score ${tradeScore}`,
        status: 'open',
        opened_at: new Date().toISOString(),
        is_paper: true,
        trade_score: tradeScore,
        market_regime: regime,
        volatility: atr / price,
        indicators: ind,
      }]);

    state.activeTradeId = tradeId;
    state.tradeOpenTime = new Date();
    state.tradesToday++;
    state.lastTradeAttempt = `✅ ${finalDecision} at ${price} (score ${tradeScore})`;
    await saveAgentState(email, state);

    console.log(`📄 PAPER TRADE: ${finalDecision} ${currentSymbol} at ${price} (amount: $${riskAmount.toFixed(2)}, score: ${tradeScore})`);

  } catch (error) {
    console.error('[Agent] Loop error:', error);
  } finally {
    processingLock = false;
  }
}

// ─── START / STOP / STATUS ────────────────────────────────────────────────────

router.post('/start', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const state = await loadAgentState(email);
  if (state.running) return res.json({ status: 'already running' });

  // Reset daily counters
  state.tradesToday = 0;
  state.dailyLoss = 0;
  state.totalPnL = 0;
  state.consecutiveWins = 0;
  state.consecutiveLosses = 0;
  state.running = true;
  state.lastTradeAttempt = null;

  // Seed price history for default symbol
  const settings = (await supabase
    .from('users')
    .select('bot_settings')
    .eq('email', email)
    .single()).data || {};
  const symbol = settings.bot_settings?.market || 'BTCUSDT';
  state.selectedSymbol = symbol;
  state.priceHistory[symbol] = [];
  const candles = await getCandles(symbol, '1m', 50);
  state.priceHistory[symbol] = candles.map(c => c.close);

  await saveAgentState(email, state);

  // Connect WebSocket
  connectWebSocket(email, symbol);

  res.json({ status: 'started' });
});

router.post('/stop', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const state = await loadAgentState(email);
  state.running = false;
  await saveAgentState(email, state);

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
    ws = null;
  }

  res.json({ status: 'stopped' });
});

router.get('/status', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const state = await loadAgentState(email);
  res.json(state);
});

// ─── UPDATE SYMBOL (multi‑asset support) ────────────────────────────────────

router.post('/symbol', async (req, res) => {
  const { email, symbol } = req.body;
  if (!email || !symbol) return res.status(400).json({ error: 'Email and symbol required' });

  const state = await loadAgentState(email);
  state.selectedSymbol = symbol;
  // Initialize price history for new symbol if needed
  if (!state.priceHistory[symbol]) {
    const candles = await getCandles(symbol, '1m', 50);
    state.priceHistory[symbol] = candles.map(c => c.close);
  }
  await saveAgentState(email, state);

  // Reconnect WebSocket to new symbol
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
    ws = null;
  }
  connectWebSocket(email, symbol);

  res.json({ status: 'symbol updated', symbol });
});

module.exports = router;
