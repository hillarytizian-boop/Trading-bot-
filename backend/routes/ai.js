const router = require('express').Router();
const axios = require('axios');
const technical = require('technicalindicators');

// ─── Enhanced fallback with multiple indicators ────────────────
function enhancedSignal(price, closes) {
  if (closes.length < 30) {
    return { signal: 'HOLD', confidence: 20, reason: 'Insufficient data' };
  }

  // Calculate indicators
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

  const lastRsi = rsi[rsi.length-1];
  const lastMacd = macd[macd.length-1];
  const lastBb = bb[bb.length-1];
  const lastEma20 = ema20[ema20.length-1];
  const lastEma50 = ema50[ema50.length-1];

  let score = 0;
  let reasons = [];

  // 1. RSI (oversold/overbought)
  if (lastRsi < 30) { score += 3; reasons.push('RSI oversold'); }
  else if (lastRsi > 70) { score -= 3; reasons.push('RSI overbought'); }
  else if (lastRsi < 45) { score += 1; reasons.push('RSI low'); }
  else if (lastRsi > 55) { score -= 1; reasons.push('RSI high'); }

  // 2. MACD (momentum)
  if (lastMacd && lastMacd.MACD > lastMacd.signal) { score += 2; reasons.push('MACD bullish'); }
  else if (lastMacd && lastMacd.MACD < lastMacd.signal) { score -= 2; reasons.push('MACD bearish'); }

  // 3. Bollinger (mean reversion)
  if (price < lastBb.lower) { score += 2; reasons.push('Price below lower BB'); }
  else if (price > lastBb.upper) { score -= 2; reasons.push('Price above upper BB'); }

  // 4. EMA cross (trend)
  if (lastEma20 > lastEma50) { score += 1; reasons.push('EMA20 > EMA50'); }
  else if (lastEma20 < lastEma50) { score -= 1; reasons.push('EMA20 < EMA50'); }

  // Determine signal
  let signal = 'HOLD';
  let confidence = 30;
  if (score >= 5) { signal = 'BUY'; confidence = 70 + Math.min(score - 5, 5) * 5; }
  else if (score <= -5) { signal = 'SELL'; confidence = 70 + Math.min(Math.abs(score) - 5, 5) * 5; }
  else if (score >= 3) { signal = 'BUY'; confidence = 50 + (score - 3) * 8; }
  else if (score <= -3) { signal = 'SELL'; confidence = 50 + (Math.abs(score) - 3) * 8; }
  else { signal = 'HOLD'; confidence = 30 + Math.abs(score) * 5; }

  confidence = Math.min(confidence, 100);
  const reason = reasons.join(', ') || 'No clear signal';

  return { signal, confidence, reason };
}

async function getAnalysis(market, price, indicators, email) {
  // Try Python agent first
  try {
    const response = await axios.post('http://localhost:5002/analyze', {
      symbol: market.replace('/', ''),
      email,
      price,
      indicators,
    }, { timeout: 2500 });
    return response.data;
  } catch (error) {
    console.warn('Python agent unavailable, using enhanced fallback');
    // We need price history – we'll fetch it if not provided
    // For now, we assume indicators contains 'closes' or we fetch.
    // We'll use the closes from the request if available.
    const closes = indicators?.closes || [];
    if (closes.length < 30) {
      // Fetch from Binance as fallback
      try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${market.replace('/', '')}&interval=1m&limit=50`;
        const res = await fetch(url);
        const data = await res.json();
        const closesFetched = data.map(c => parseFloat(c[4]));
        return enhancedSignal(price, closesFetched);
      } catch {
        return { signal: 'HOLD', confidence: 20, reason: 'Data unavailable' };
      }
    }
    return enhancedSignal(price, closes);
  }
}

router.post('/analyze', async (req, res) => {
  const { market, price, indicators, email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    const result = await getAnalysis(market, price, indicators, email);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = { router, getAnalysis };
