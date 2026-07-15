const router = require('express').Router();
const axios = require('axios');

// ─── AI that works with or without full closes ──────────────────
function generateSignal(rsi, macd, ema, price, closes) {
  // If we have closes, we can compute full indicators, but we already have rsi/macd
  let score = 0;
  let reasons = [];

  // RSI
  if (rsi < 30) { score += 3; reasons.push(`RSI oversold (${rsi.toFixed(1)})`); }
  else if (rsi > 70) { score -= 3; reasons.push(`RSI overbought (${rsi.toFixed(1)})`); }
  else if (rsi < 45) { score += 1; reasons.push(`RSI low (${rsi.toFixed(1)})`); }
  else if (rsi > 55) { score -= 1; reasons.push(`RSI high (${rsi.toFixed(1)})`); }
  else { reasons.push(`RSI neutral (${rsi.toFixed(1)})`); }

  // MACD (if available)
  if (macd !== undefined && macd !== null) {
    if (macd > 0) { score += 2; reasons.push('MACD bullish'); }
    else if (macd < 0) { score -= 2; reasons.push('MACD bearish'); }
    else { reasons.push('MACD neutral'); }
  }

  // EMA (if available)
  if (ema !== undefined && ema !== null && price) {
    if (price > ema) { score += 1; reasons.push('Price above EMA'); }
    else if (price < ema) { score -= 1; reasons.push('Price below EMA'); }
    else { reasons.push('Price near EMA'); }
  }

  // Determine signal
  let signal = 'HOLD';
  let confidence = 30;
  let reason = reasons.join('; ') || 'No clear signal';

  if (score >= 5) {
    signal = 'BUY';
    confidence = Math.min(70 + (score - 5) * 5, 100);
    reason = `Strong BUY: ${reason}`;
  } else if (score <= -5) {
    signal = 'SELL';
    confidence = Math.min(70 + (Math.abs(score) - 5) * 5, 100);
    reason = `Strong SELL: ${reason}`;
  } else if (score >= 3) {
    signal = 'BUY';
    confidence = 50 + (score - 3) * 8;
    reason = `Moderate BUY: ${reason}`;
  } else if (score <= -3) {
    signal = 'SELL';
    confidence = 50 + (Math.abs(score) - 3) * 8;
    reason = `Moderate SELL: ${reason}`;
  } else {
    signal = 'HOLD';
    confidence = 30 + Math.abs(score) * 5;
    reason = `HOLD: ${reason}`;
  }

  confidence = Math.min(confidence, 100);
  confidence = Math.max(confidence, 20);

  return { signal, confidence, reason };
}

router.post('/analyze', async (req, res) => {
  const { market, price, indicators, email, closes } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    // Try Python agent first
    const response = await axios.post('http://localhost:5002/analyze', {
      symbol: market.replace('/', ''),
      email,
      price,
      indicators: { ...indicators, closes },
    }, { timeout: 2500 });
    return res.json(response.data);
  } catch (error) {
    console.log('Python agent unavailable, using built-in AI');

    // Use provided indicators or fallback
    const rsi = indicators?.rsi ?? 50;
    const macd = indicators?.macd ?? 0;
    const ema = indicators?.ema ?? price * 0.99;

    // If we have closes, we could compute more, but we already have rsi/macd
    const result = generateSignal(rsi, macd, ema, price, closes || []);
    return res.json(result);
  }
});

module.exports = router;
