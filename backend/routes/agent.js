const router = require('express').Router();
const supabase = require('../db');
const { v4: uuidv4 } = require('uuid');
const technical = require('technicalindicators');
const Binance = require('binance-api-node').default;

// ─── CONFIG ──────────────────────────────────────────────────────────
const CONFIG = {
  maxTradeAmount: 0.50,        // max $0.50 per trade
  minTradeAmount: 0.10,
  stopLossPercent: 2,
  takeProfitPercent: 6,        // 1:3 risk/reward
  maxDailyLoss: 0.05,
  kellyFraction: 0.25,
  atrMultiplierSL: 2,
  rewardToRisk: 3,
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
      tradeHistory: [],
      signalStats: { BUY: { wins: 0, losses: 0 }, SELL: { wins: 0, losses: 0 } },
      marketRegime: 'unknown',
      volatility: 0,
      lastSignal: null,
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

// ─── MARKET REGIME DETECTION ──────────────────────────────────────
function detectRegime(closes) {
  if (closes.length < 20) return 'unknown';
  const recent = closes.slice(-20);
  const diffs = [];
  for (let i = 1; i < recent.length; i++) {
    diffs.push(recent[i] - recent[i-1]);
  }
  const avgMove = diffs.reduce((a,b) => a + Math.abs(b), 0) / diffs.length;
  const netMove = recent[recent.length-1] - recent[0];
  const strength = Math.abs(netMove) / (avgMove || 1);
  if (strength > 2.5) return 'trending';
  if (strength > 1.5) return 'weak_trend';
  return 'ranging';
}

// ─── RISK OF RUIN ───────────────────────────────────────────────────
function riskOfRuin(winRate, riskPerTrade) {
  if (winRate <= 0 || winRate >= 1) return 0;
  const lossRate = 1 - winRate;
  const r = lossRate / winRate;
  if (r >= 1) return 1;
  return Math.pow(r, 0.5 / riskPerTrade);
}

// ─── KELLY SIZING ──────────────────────────────────────────────────
function kellyFraction(winRate, avgWin, avgLoss) {
  if (avgLoss === 0) return 0;
  const b = avgWin / avgLoss;
  const p = winRate;
  const q = 1 - p;
  const k = (p * b - q) / b;
  return Math.max(0, Math.min(k, 0.1));
}

// ─── AI DECISION ENGINE ────────────────────────────────────────────
function aiDecision(price, closes, state) {
  if (closes.length < 20) {
    return { signal: 'HOLD', confidence: 0, reason: 'Insufficient data', tradeAmount: 0 };
  }

  // ─── 1. Calculate all indicators ────────────────────────────────
  const rsi = technical.RSI.calculate({ values: closes, period: 14 });
  const macd = technical.MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
  });
  const bb = technical.BollingerBands.calculate({
    values: closes,
    period: 20,
    stdDev: 2,
  });
  const ema20 = technical.EMA.calculate({ values: closes, period: 20 });
  const ema50 = technical.EMA.calculate({ values: closes, period: 50 });
  const atr = technical.ATR.calculate({
    high: closes.map(c => c * 1.001),
    low: closes.map(c => c * 0.999),
    close: closes,
    period: 14,
  });

  const lastRsi = rsi[rsi.length-1] || 50;
  const lastMacd = macd[macd.length-1] || { MACD: 0, signal: 0 };
  const lastBb = bb[bb.length-1] || { upper: price * 1.02, lower: price * 0.98 };
  const lastEma20 = ema20[ema20.length-1] || price;
  const lastEma50 = ema50[ema50.length-1] || price;
  const lastAtr = atr[atr.length-1] || (price * 0.02);

  // ─── 2. Market regime ────────────────────────────────────────────
  const regime = detectRegime(closes);
  state.marketRegime = regime;
  state.volatility = lastAtr / price;

  // ─── 3. Score the trade ──────────────────────────────────────────
  let score = 0;
  let reasons = [];

  // RSI
  if (lastRsi < 30) { score += 3; reasons.push('RSI oversold'); }
  else if (lastRsi > 70) { score -= 3; reasons.push('RSI overbought'); }
  else if (lastRsi < 45) { score += 1; reasons.push('RSI low'); }
  else if (lastRsi > 55) { score -= 1; reasons.push('RSI high'); }

  // MACD
  if (lastMacd.MACD > lastMacd.signal) { score += 2; reasons.push('MACD bullish'); }
  else if (lastMacd.MACD < lastMacd.signal) { score -= 2; reasons.push('MACD bearish'); }

  // Bollinger
  if (price < lastBb.lower) { score += 2; reasons.push('Below lower BB'); }
  else if (price > lastBb.upper) { score -= 2; reasons.push('Above upper BB'); }

  // EMA cross
  if (lastEma20 > lastEma50) { score += 1; reasons.push('EMA20 > EMA50'); }
  else if (lastEma20 < lastEma50) { score -= 1; reasons.push('EMA20 < EMA50'); }

  // Regime bonus
  if (regime === 'trending' && Math.abs(score) > 2) {
    score *= 1.2;
  } else if (regime === 'ranging') {
    score *= 0.8;
  }

  // ─── 4. Determine signal ──────────────────────────────────────────
  let signal = 'HOLD';
  let confidence = 30;
  if (score >= 5) { signal = 'BUY'; confidence = 70 + Math.min(score - 5, 5) * 5; }
  else if (score <= -5) { signal = 'SELL'; confidence = 70 + Math.min(Math.abs(score) - 5, 5) * 5; }
  else if (score >= 3) { signal = 'BUY'; confidence = 50 + (score - 3) * 8; }
  else if (score <= -3) { signal = 'SELL'; confidence = 50 + (Math.abs(score) - 3) * 8; }
  else { signal = 'HOLD'; confidence = 30 + Math.abs(score) * 5; }

  confidence = Math.min(confidence, 100);
  confidence = Math.max(confidence, 20);

  // ─── 5. Adaptive confidence ──────────────────────────────────────
  if (regime === 'trending') confidence += 10;
  else if (regime === 'ranging') confidence -= 10;

  // ─── 6. Dynamic position sizing ──────────────────────────────────
  // Kelly sizing based on win rate
  const totalTrades = Object.values(state.signalStats).reduce((s, t) => s + t.wins + t.losses, 0);
  const wins = Object.values(state.signalStats).reduce((s, t) => s + t.wins, 0);
  const losses = Object.values(state.signalStats).reduce((s, t) => s + t.losses, 0);
  const winRate = totalTrades > 0 ? wins / totalTrades : 0.5;
  // Average win/loss from history
  const avgWin = 0.05; // placeholder – could be calculated from trades
  const avgLoss = 0.02;
  const kelly = kellyFraction(winRate, avgWin, avgLoss) * CONFIG.kellyFraction;
  const baseRisk = Math.max(0.005, Math.min(kelly, 0.03));

  // Risk-of-ruin check
  const ror = riskOfRuin(winRate, baseRisk);
  let riskPerTrade = baseRisk;
  if (ror > 0.1) riskPerTrade *= 0.5;

  // ─── 7. Dynamic trade amount ──────────────────────────────────────
  const balance = state.paperBalance;
  let tradeAmount = balance * riskPerTrade;
  tradeAmount = Math.min(tradeAmount, CONFIG.maxTradeAmount);
  tradeAmount = Math.max(tradeAmount, CONFIG.minTradeAmount);

  // ─── 8. Volatility adjustment ────────────────────────────────────
  const volPct = lastAtr / price;
  if (volPct > 0.03) tradeAmount *= 0.7;
  else if (volPct < 0.01) tradeAmount *= 1.3;

  tradeAmount = Math.min(tradeAmount, CONFIG.maxTradeAmount);
  tradeAmount = Math.max(tradeAmount, CONFIG.minTradeAmount);

  // ─── 9. Decision ──────────────────────────────────────────────────
  const reason = reasons.join(', ') || 'No clear signal';

  // Only trade if confidence >= 50 and score != 0
  if (signal === 'HOLD' || confidence < 50) {
    return { signal: 'HOLD', confidence, reason, tradeAmount: 0 };
  }

  return {
    signal,
    confidence,
    reason,
    tradeAmount,
    score,
    regime,
    volatility: volPct,
    riskPerTrade,
  };
}

// ─── MAIN AGENT LOOP ──────────────────────────────────────────────
let processingLock = false;

async function agentLoop(email) {
  if (processingLock) return;
  processingLock = true;

  try {
    const state = await loadAgentState(email);
    if (!state.running) { processingLock = false; return; }

    const settingsRes = await supabase
      .from('users')
      .select('bot_settings, paper_balance, binance_api_key, binance_secret_key')
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

          // Update stats
          const sigType = t.type;
          if (pnl > 0) state.signalStats[sigType].wins += 1;
          else state.signalStats[sigType].losses += 1;

          if (isPaper) state.paperBalance += pnl;
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

    // ─── AI makes the decision ─────────────────────────────────────
    const decision = aiDecision(price, state.priceHistory, state);
    state.lastSignal = decision;

    if (decision.signal === 'HOLD' || decision.tradeAmount === 0) {
      state.lastTradeAttempt = `HOLD (${decision.confidence}%)`;
      await saveAgentState(email, state);
      processingLock = false;
      return;
    }

    // ─── Balance check ──────────────────────────────────────────────
    let balance;
    if (isPaper) {
      balance = state.paperBalance;
    } else {
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
      state.lastTradeAttempt = 'Balance < $1';
      await saveAgentState(email, state);
      processingLock = false;
      return;
    }

    // ─── Execute trade ──────────────────────────────────────────────
    const tradeAmount = Math.min(decision.tradeAmount, balance * 0.5);
    const quantity = tradeAmount / price;

    const slPercent = CONFIG.stopLossPercent;
    const tpPercent = CONFIG.takeProfitPercent;
    let stopLoss, takeProfit;
    if (decision.signal === 'BUY') {
      stopLoss = price * (1 - slPercent / 100);
      takeProfit = price * (1 + tpPercent / 100);
    } else {
      stopLoss = price * (1 + slPercent / 100);
      takeProfit = price * (1 - tpPercent / 100);
    }

    const tradeId = uuidv4();
    await supabase.from('trades').insert([{
      id: tradeId,
      user_email: email,
      symbol: symbol,
      type: decision.signal,
      entry_price: price,
      quantity: quantity,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      duration: 120,
      signal_confidence: decision.confidence,
      signal_reason: decision.reason,
      status: 'open',
      opened_at: new Date().toISOString(),
      is_paper: isPaper,
      trade_score: decision.score,
      market_regime: decision.regime,
      volatility: decision.volatility,
    }]);

    state.activeTradeId = tradeId;
    state.tradeOpenTime = new Date();
    state.tradesToday++;
    state.lastTradeAttempt = `✅ ${decision.signal} at ${price} ($${tradeAmount.toFixed(2)})`;
    await saveAgentState(email, state);

    console.log(`📄 ${isPaper ? 'PAPER' : 'REAL'} TRADE: ${decision.signal} ${symbol} at ${price} ($${tradeAmount.toFixed(2)}, score: ${decision.score})`);

  } catch (error) {
    console.error('[Agent] Loop error:', error);
  } finally {
    processingLock = false;
    const state = await loadAgentState(email);
    if (state.running) {
      setTimeout(() => agentLoop(email), 5000);
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
