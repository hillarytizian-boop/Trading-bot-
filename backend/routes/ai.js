const router = require('express').Router();
const { instance } = require('../binanceData');

// ─── Simple EMA calculation ──────────────────────────────────────
function calculateEMA(values, period) {
  if (values.length < period) return values[values.length-1] || 0;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

// ─── Simple RSI ──────────────────────────────────────────────────
function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i-1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / (closes.length - 1);
  const avgLoss = losses / (closes.length - 1);
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ─── Simple MACD ──────────────────────────────────────────────────
function calculateMACD(closes) {
  if (closes.length < 26) return 0;
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  return ema12 - ema26;
}

// ─── Main analysis ──────────────────────────────────────────────
async function getAIAnalysis(email, symbol, price, closes) {
  try {
    const data = await instance.getAnalysisData(symbol);
    if (!data || !data.closes || data.closes.length < 20) {
      return { signal: 'HOLD', confidence: 0, reason: 'Insufficient data' };
    }

    const prices = data.closes;
    const currentPrice = price || data.price || prices[prices.length-1] || 0;

    // Calculate indicators
    const rsi = calculateRSI(prices);
    const macd = calculateMACD(prices);
    const ema20 = calculateEMA(prices, 20);
    const ema50 = calculateEMA(prices, 50);
    const ema200 = calculateEMA(prices, 200);

    // ─── Rule‑based signal ──────────────────────────────────────────
    let score = 0;
    const reasons = [];

    if (rsi < 30) { score += 2; reasons.push('RSI oversold'); }
    else if (rsi > 70) { score -= 2; reasons.push('RSI overbought'); }
    else if (rsi < 45) { score += 1; reasons.push('RSI low'); }
    else if (rsi > 55) { score -= 1; reasons.push('RSI high'); }

    if (macd > 0) { score += 1; reasons.push('MACD positive'); }
    else if (macd < 0) { score -= 1; reasons.push('MACD negative'); }

    if (currentPrice > ema20 && ema20 > ema50 && ema50 > ema200) { score += 2; reasons.push('Strong uptrend'); }
    else if (currentPrice < ema20 && ema20 < ema50 && ema50 < ema200) { score -= 2; reasons.push('Strong downtrend'); }
    else if (currentPrice > ema20 && ema20 > ema50) { score += 1; reasons.push('Uptrend'); }
    else if (currentPrice < ema20 && ema20 < ema50) { score -= 1; reasons.push('Downtrend'); }

    let signal = 'HOLD';
    let confidence = 30;
    if (score >= 3) { signal = 'BUY'; confidence = 60 + score * 5; }
    else if (score <= -3) { signal = 'SELL'; confidence = 60 + Math.abs(score) * 5; }
    else if (score >= 2) { signal = 'BUY'; confidence = 50 + score * 5; }
    else if (score <= -2) { signal = 'SELL'; confidence = 50 + Math.abs(score) * 5; }
    else { signal = 'HOLD'; confidence = 30 + Math.abs(score) * 5; }
    confidence = Math.min(100, Math.max(0, confidence));

    // ─── Confidence threshold ──────────────────────────────────────
    if (confidence < 75) {
      signal = 'HOLD';
      reasons.push('(confidence below 75%)');
    }

    const reason = reasons.length ? reasons.join(', ') : 'No clear signal';

    return {
      signal,
      confidence,
      trend: score > 0 ? 'Bullish' : score < 0 ? 'Bearish' : 'Sideways',
      market_regime: 'Ranging',
      entry_price: currentPrice,
      stop_loss: 0,
      take_profit: 0,
      risk_reward: '1:1',
      expected_move_percent: 0,
      trade_duration: 'Intraday',
      reason,
      pros: ['Rule-based signal'],
      cons: ['No AI confirmation'],
      indicator_scores: { RSI: rsi, MACD: macd, EMA: 0, ADX: 0, Volume: 0, Trend: score, SupportResistance: 0 },
      data: { price: currentPrice, rsi, macd, ema20, ema50, ema200 },
    };
  } catch (error) {
    console.error('[AI] Error:', error.message);
    return { signal: 'HOLD', confidence: 0, reason: 'Error: ' + error.message };
  }
}

// ─── Endpoints ──────────────────────────────────────────────────────
router.post('/analyze', async (req, res) => {
  const rawSymbol = req.body.symbol || req.body.market || 'BTCUSDT';
  const symbol = rawSymbol.replace(/\//g, '');
  const email = req.user?.email || req.body.email || 'demo@example.com';
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const result = await getAIAnalysis(email, symbol, null, null);
    res.json(result);
  } catch (error) {
    console.error('[AI] Endpoint error:', error.message);
    res.status(500).json({ signal: 'HOLD', confidence: 0, reason: 'Error: ' + error.message });
  }
});

router.get('/market-data', async (req, res) => {
  let { symbol = 'BTCUSDT' } = req.query;
  symbol = symbol.replace(/\//g, '');
  try {
    const data = await instance.getAnalysisData(symbol);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = { router, getAIAnalysis };
