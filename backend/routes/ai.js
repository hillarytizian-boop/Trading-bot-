const router = require('express').Router();
const axios = require('axios');
const technical = require('technicalindicators');

// ─── Real AI fallback with multiple indicators ──────────────────
function realAIAnalysis(price, closes) {
  if (!closes || closes.length < 30) {
    return { signal: 'HOLD', confidence: 20, reason: 'Insufficient data' };
  }

  // Calculate all indicators
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

  // ─── Score the trade ────────────────────────────────────────────
  let score = 0;
  let reasons = [];

  // RSI
  if (lastRsi < 30) { score += 3; reasons.push(`RSI oversold (${lastRsi.toFixed(1)})`); }
  else if (lastRsi > 70) { score -= 3; reasons.push(`RSI overbought (${lastRsi.toFixed(1)})`); }
  else if (lastRsi < 45) { score += 1; reasons.push(`RSI low (${lastRsi.toFixed(1)})`); }
  else if (lastRsi > 55) { score -= 1; reasons.push(`RSI high (${lastRsi.toFixed(1)})`); }
  else { reasons.push(`RSI neutral (${lastRsi.toFixed(1)})`); }

  // MACD
  if (lastMacd.MACD > lastMacd.signal) { score += 2; reasons.push('MACD bullish'); }
  else if (lastMacd.MACD < lastMacd.signal) { score -= 2; reasons.push('MACD bearish'); }
  else { reasons.push('MACD neutral'); }

  // Bollinger
  if (price < lastBb.lower) { score += 2; reasons.push('Price below lower BB'); }
  else if (price > lastBb.upper) { score -= 2; reasons.push('Price above upper BB'); }
  else { reasons.push('Price within BB'); }

  // EMA cross
  if (lastEma20 > lastEma50) { score += 1; reasons.push('EMA20 > EMA50'); }
  else if (lastEma20 < lastEma50) { score -= 1; reasons.push('EMA20 < EMA50'); }
  else { reasons.push('EMA20 = EMA50'); }

  // ─── Determine signal ────────────────────────────────────────────
  let signal = 'HOLD';
  let confidence = 30;
  let reason = reasons.join('; ');

  if (score >= 5) {
    signal = 'BUY';
    confidence = Math.min(70 + (score - 5) * 5, 100);
    reason = `Strong BUY signal: ${reason}`;
  } else if (score <= -5) {
    signal = 'SELL';
    confidence = Math.min(70 + (Math.abs(score) - 5) * 5, 100);
    reason = `Strong SELL signal: ${reason}`;
  } else if (score >= 3) {
    signal = 'BUY';
    confidence = 50 + (score - 3) * 8;
    reason = `Moderate BUY signal: ${reason}`;
  } else if (score <= -3) {
    signal = 'SELL';
    confidence = 50 + (Math.abs(score) - 3) * 8;
    reason = `Moderate SELL signal: ${reason}`;
  } else {
    signal = 'HOLD';
    confidence = 30 + Math.abs(score) * 5;
    reason = `HOLD: ${reason}`;
  }

  confidence = Math.min(confidence, 100);
  confidence = Math.max(confidence, 20);

  return { signal, confidence, reason };
}

// ─── Main endpoint ────────────────────────────────────────────────
router.post('/analyze', async (req, res) => {
  const { market, price, indicators, email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    // Try Python agent first
    const response = await axios.post('http://localhost:5002/analyze', {
      symbol: market.replace('/', ''),
      email,
      price,
      indicators,
    }, { timeout: 2500 });
    return res.json(response.data);
  } catch (error) {
    console.log('Python agent unavailable, using real AI fallback');

    // Use closes from indicators, or fetch them
    let closes = indicators?.closes || [];
    if (closes.length < 30) {
      try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${market.replace('/', '')}&interval=1m&limit=50`;
        const response = await fetch(url);
        const data = await response.json();
        closes = data.map(c => parseFloat(c[4]));
      } catch (e) {
        console.error('Failed to fetch candles:', e);
      }
    }

    const result = realAIAnalysis(price, closes);
    return res.json(result);
  }
});

module.exports = router;
