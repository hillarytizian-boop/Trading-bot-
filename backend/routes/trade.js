const router = require('express').Router();
const supabase = require('../db');
const OpenAI = require('openai');
const { v4: uuidv4 } = require('uuid');
const BinanceWebSocket = require('../utils/ws');

const nvidiaClient = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

const MODELS = ['deepseek-ai/deepseek-v4-pro', 'z-ai/glm-5.2'];

// ─── 1. Multi-timeframe check ────────────────────────────────────
async function checkTimeframes(symbol, price) {
  const timeframes = ['1m', '5m', '15m'];
  const signals = [];
  for (const tf of timeframes) {
    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=20`;
      const res = await fetch(url);
      const data = await res.json();
      const closes = data.map(c => parseFloat(c[4]));
      const rsi = closes.length > 14 ? (() => {
        let gains = 0, losses = 0;
        for (let i = 1; i < closes.length; i++) {
          const diff = closes[i] - closes[i-1];
          if (diff >= 0) gains += diff;
          else losses += -diff;
        }
        const avgGain = gains / (closes.length - 1);
        const avgLoss = losses / (closes.length - 1);
        if (avgLoss === 0) return 100;
        return 100 - (100 / (1 + avgGain / avgLoss));
      })() : 50;
      signals.push(rsi < 45 ? 'BUY' : rsi > 55 ? 'SELL' : 'HOLD');
    } catch (e) {
      signals.push('HOLD');
    }
  }
  const buyCount = signals.filter(s => s === 'BUY').length;
  const sellCount = signals.filter(s => s === 'SELL').length;
  return buyCount >= 2 ? 'BUY' : sellCount >= 2 ? 'SELL' : 'HOLD';
}

// ─── 2. Trend filter (EMA50/200) ─────────────────────────────────
async function checkTrend(symbol, price) {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=200`;
    const res = await fetch(url);
    const data = await res.json();
    const closes = data.map(c => parseFloat(c[4]));
    const ema50 = closes.slice(-50).reduce((a,b) => a+b, 0) / 50;
    const ema200 = closes.slice(-200).reduce((a,b) => a+b, 0) / 200;
    if (price > ema50 && ema50 > ema200) return 'bullish';
    if (price < ema50 && ema50 < ema200) return 'bearish';
    return 'neutral';
  } catch (e) {
    return 'neutral';
  }
}

// ─── 3. Volume confirmation ──────────────────────────────────────
async function checkVolume(symbol) {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=20`;
    const res = await fetch(url);
    const data = await res.json();
    const volumes = data.map(c => parseFloat(c[5]));
    const avgVolume = volumes.slice(0, -1).reduce((a,b) => a+b, 0) / (volumes.length - 1);
    const currentVolume = volumes[volumes.length-1];
    return currentVolume > avgVolume * 0.7;
  } catch (e) {
    return true;
  }
}

// ─── 4. Support/resistance detection ─────────────────────────────
async function detectSR(symbol, price) {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=48`;
    const res = await fetch(url);
    const data = await res.json();
    const highs = data.map(c => parseFloat(c[2]));
    const lows = data.map(c => parseFloat(c[3]));
    const recentHigh = Math.max(...highs.slice(-12));
    const recentLow = Math.min(...lows.slice(-12));
    return { resistance: recentHigh, support: recentLow };
  } catch (e) {
    return { resistance: price * 1.05, support: price * 0.95 };
  }
}

// ─── 5. Market regime detection ──────────────────────────────────
function detectRegime(closes) {
  if (closes.length < 20) return 'ranging';
  const recent = closes.slice(-20);
  const diffs = [];
  for (let i = 1; i < recent.length; i++) {
    diffs.push(Math.abs(recent[i] - recent[i-1]));
  }
  const avgMove = diffs.reduce((a,b) => a+b, 0) / diffs.length;
  const netMove = recent[recent.length-1] - recent[0];
  const strength = Math.abs(netMove) / avgMove;
  if (strength > 2.5) return 'trending';
  if (strength > 1.5) return 'weak_trend';
  return 'ranging';
}

// ─── 6. ATR for dynamic SL/TP ────────────────────────────────────
async function getATR(symbol) {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=14`;
    const res = await fetch(url);
    const data = await res.json();
    const highs = data.map(c => parseFloat(c[2]));
    const lows = data.map(c => parseFloat(c[3]));
    const closes = data.map(c => parseFloat(c[4]));
    const tr = [];
    for (let i = 1; i < closes.length; i++) {
      tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])));
    }
    return tr.reduce((a,b) => a+b, 0) / tr.length;
  } catch (e) {
    return 0.01 * 1000; // fallback
  }
}

// ─── 7. Position sizing (fixed % risk) ──────────────────────────
function positionSize(balance, riskPct = 0.01, price, slDistance) {
  const riskAmount = balance * riskPct;
  const quantity = riskAmount / (slDistance || price * 0.02);
  return Math.min(quantity, balance * 0.01 / price);
}

// ─── 8. Confidence threshold ─────────────────────────────────────
const CONFIDENCE_THRESHOLD = 80; // 80% minimum

// ─── 9. Economic news filter (mock) ─────────────────────────────
async function newsBlackout() {
  // In production, fetch economic calendar and check for high-impact events
  return false;
}

// ─── 10. Trade journal ────────────────────────────────────────────
async function logTrade(email, trade) {
  const entry = {
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
    signal_confidence: trade.confidence,
    signal_reason: trade.reason,
    is_paper: trade.isPaper || false,
    indicators: trade.indicators || {},
    market_regime: trade.regime || '',
    volatility: trade.volatility || 0,
  };
  await supabase.from('trades').insert([entry]);
  return entry.id;
}

// ─── 11. Backtesting is already in routes/backtest.js ──────────

// ─── 12. Paper trading mode is already in frontend ──────────────

// ─── 13. Order execution (limit vs market) ──────────────────────
// We'll use market orders for now, can be extended.

// ─── 14. Portfolio-level risk controls ──────────────────────────
async function checkPortfolioLimits(email) {
  const { data } = await supabase
    .from('trades')
    .select('*')
    .eq('user_email', email)
    .eq('status', 'open');
  const openTrades = data || [];
  if (openTrades.length >= 5) return { allowed: false, reason: 'Max positions reached' };
  // Daily loss limit
  const today = new Date().toISOString().slice(0,10);
  const { data: todayTrades } = await supabase
    .from('trades')
    .select('pnl')
    .eq('user_email', email)
    .gte('opened_at', today);
  const dailyLoss = todayTrades ? todayTrades.filter(t => t.pnl < 0).reduce((s,t) => s + t.pnl, 0) : 0;
  if (Math.abs(dailyLoss) > 10) return { allowed: false, reason: 'Daily loss limit reached' };
  return { allowed: true };
}

// ─── 15. AI ensemble (multiple models) ──────────────────────────
async function ensembleSignal(symbol, price, indicators) {
  const rsi = indicators?.rsi ?? 50;
  const macd = indicators?.macd ?? 0;
  const ema = indicators?.ema ?? price;

  const results = await Promise.allSettled(MODELS.map(m => queryNvidiaModel(m, prompt)));
  const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).map(r => r.value.data);
  if (successful.length === 0) return null;
  const signalCount = { BUY: 0, SELL: 0, HOLD: 0 };
  successful.forEach(d => { if (signalCount[d.signal] !== undefined) signalCount[d.signal]++; });
  const finalSignal = Object.keys(signalCount).reduce((a, b) => signalCount[a] > signalCount[b] ? a : b);
  const avgConfidence = Math.round(successful.reduce((s, d) => s + d.confidence, 0) / successful.length);
  return { signal: finalSignal, confidence: avgConfidence, reasons: successful.map(d => d.reason).join(' ') };
}

// ─── NVIDIA query helper ─────────────────────────────────────────
async function queryNvidiaModel(model, prompt) {
  try {
    const completion = await nvidiaClient.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      top_p: 0.95,
      max_tokens: 256,
      stream: false,
    });
    const content = completion.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.signal && parsed.confidence !== undefined) {
        return { model, success: true, data: parsed };
      }
    }
    const signalMatch = content.match(/\b(BUY|SELL|HOLD)\b/i);
    const confidenceMatch = content.match(/(\d{1,3})%/);
    return {
      model,
      success: true,
      data: {
        signal: signalMatch ? signalMatch[0].toUpperCase() : 'HOLD',
        confidence: confidenceMatch ? parseInt(confidenceMatch[1]) : 50,
        reason: content.slice(0, 200),
      },
    };
  } catch (error) {
    return { model, success: false, error: error.message };
  }
}

// ─── MAIN AUTO-TRADE ENDPOINT ───────────────────────────────────
router.post('/auto', async (req, res) => {
  const { email, symbol, price, indicators, closes } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const market = symbol || 'BTCUSDT';
    const currentPrice = price || 0;

    // ─── 1. Multi-timeframe ──────────────────────────────────
    const tfSignal = await checkTimeframes(market, currentPrice);
    if (tfSignal === 'HOLD') {
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'Timeframes disagree' });
    }

    // ─── 2. Trend filter ─────────────────────────────────────
    const trend = await checkTrend(market, currentPrice);
    if ((tfSignal === 'BUY' && trend !== 'bullish') || (tfSignal === 'SELL' && trend !== 'bearish')) {
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'Trend mismatch' });
    }

    // ─── 3. Volume confirmation ──────────────────────────────
    const volumeOk = await checkVolume(market);
    if (!volumeOk) {
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'Low volume' });
    }

    // ─── 4. Support/resistance ──────────────────────────────
    const sr = await detectSR(market, currentPrice);
    if (tfSignal === 'BUY' && currentPrice > sr.resistance * 0.99) {
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'Near resistance' });
    }
    if (tfSignal === 'SELL' && currentPrice < sr.support * 1.01) {
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'Near support' });
    }

    // ─── 5. Market regime ──────────────────────────────────
    const regime = detectRegime(closes || []);
    // ─── 6. ATR ──────────────────────────────────────────────
    const atr = await getATR(market);

    // ─── 9. News filter ──────────────────────────────────────
    if (await newsBlackout()) {
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'News blackout' });
    }

    // ─── 14. Portfolio risk controls ──────────────────────────
    const limits = await checkPortfolioLimits(email);
    if (!limits.allowed) {
      return res.json({ signal: 'HOLD', confidence: 0, reason: limits.reason });
    }

    // ─── 15. AI ensemble ──────────────────────────────────────
    const ensemble = await ensembleSignal(market, currentPrice, indicators);
    if (!ensemble || ensemble.confidence < CONFIDENCE_THRESHOLD) {
      return res.json({ signal: 'HOLD', confidence: ensemble?.confidence || 0, reason: 'Low AI confidence' });
    }

    // ─── Check open trade ──────────────────────────────────
    const existing = await supabase.from('trades').select('*').eq('user_email', email).eq('status', 'open').single();
    if (existing.data) {
      const trade = existing.data;
      const entry = trade.entry_price;
      const sl = trade.stop_loss;
      const tp = trade.take_profit;
      let pnl = 0, closed = false;
      if (trade.type === 'BUY') {
        if (currentPrice <= sl) { pnl = (currentPrice - entry) * trade.quantity; closed = true; }
        else if (currentPrice >= tp) { pnl = (currentPrice - entry) * trade.quantity; closed = true; }
        else if (currentPrice > entry * 1.02) {
          // Trailing stop: move to breakeven after 2% gain
          await supabase.from('trades').update({ stop_loss: entry }).eq('id', trade.id);
        }
      } else {
        if (currentPrice >= sl) { pnl = (entry - currentPrice) * trade.quantity; closed = true; }
        else if (currentPrice <= tp) { pnl = (entry - currentPrice) * trade.quantity; closed = true; }
        else if (currentPrice < entry * 0.98) {
          await supabase.from('trades').update({ stop_loss: entry }).eq('id', trade.id);
        }
      }
      if (closed) {
        await supabase.from('trades').update({
          exit_price: currentPrice,
          pnl: pnl,
          status: 'closed',
          closed_at: new Date().toISOString(),
          close_reason: pnl > 0 ? 'TAKE_PROFIT' : 'STOP_LOSS',
        }).eq('id', trade.id);
        return res.json({ signal: 'EXIT', confidence: 100, reason: `Closed with ${pnl > 0 ? 'profit' : 'loss'}` });
      }
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'Trade active' });
    }

    // ─── 7. Position sizing ──────────────────────────────────
    const user = await supabase.from('users').select('paper_balance').eq('email', email).single();
    const balance = user.data?.paper_balance || 1000;
    const riskPct = ensemble.confidence > 85 ? 0.015 : 0.01;
    const slDistance = atr * 2 || currentPrice * 0.02;
    const quantity = positionSize(balance, riskPct, currentPrice, slDistance);
    if (quantity <= 0) {
      return res.json({ signal: 'HOLD', confidence: 0, reason: 'Position size too small' });
    }

    const slPercent = 2;
    const tpPercent = 5;
    let stopLoss, takeProfit;
    if (ensemble.signal === 'BUY') {
      stopLoss = currentPrice * (1 - slPercent / 100);
      takeProfit = currentPrice * (1 + tpPercent / 100);
    } else {
      stopLoss = currentPrice * (1 + slPercent / 100);
      takeProfit = currentPrice * (1 - tpPercent / 100);
    }

    // ─── 10. Trade journal ──────────────────────────────────
    const tradeId = uuidv4();
    const trade = {
      id: tradeId,
      symbol: market,
      type: ensemble.signal,
      entryPrice: currentPrice,
      quantity: quantity,
      stopLoss,
      takeProfit,
      status: 'open',
      openedAt: new Date().toISOString(),
      confidence: ensemble.confidence,
      reason: ensemble.reasons,
      isPaper: true,
      regime: regime,
      volatility: atr / currentPrice,
      indicators: indicators || {},
    };
    await logTrade(email, trade);

    res.json({
      signal: ensemble.signal,
      confidence: ensemble.confidence,
      reason: `NVIDIA AI: ${ensemble.reasons}`,
      trade: { id: tradeId, type: ensemble.signal, entryPrice: currentPrice, quantity, stopLoss, takeProfit },
    });
  } catch (error) {
    console.error('[AutoTrade] Error:', error.message);
    res.status(500).json({ signal: 'HOLD', confidence: 0, reason: 'Error: ' + error.message });
  }
});

module.exports = router;
