const router = require('express').Router();
const axios = require('axios');

// Simple fallback using provided indicators
function fallbackSignal(indicators) {
  const { rsi, ema, macd } = indicators;
  let score = 0;
  if (rsi < 30) score += 2;
  else if (rsi > 70) score -= 2;
  if (macd > 0) score += 1;
  else score -= 1;
  // simple ema trend (ema compared to current price – we don't have price here, but we can use a proxy)
  // We'll just use rsi and macd
  const action = score >= 3 ? 'BUY' : score <= -3 ? 'SELL' : 'HOLD';
  const confidence = Math.min(Math.abs(score) / 4 * 100, 100);
  return { action, confidence, reason: `Fallback: RSI=${rsi}, MACD=${macd}` };
}

router.post('/analyze', async (req, res) => {
  const { market, price, indicators, email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    // Try Python agent service (timeout 2.5s)
    const response = await axios.post('http://localhost:5002/analyze', {
      symbol: market.replace('/', ''),
      email,
      price,
      indicators,
    }, { timeout: 2500 });
    // The Python service should return { signal, confidence, reason, breakdown }
    return res.json(response.data);
  } catch (error) {
    console.warn('Python agent service unavailable, using fallback');
    const fallback = fallbackSignal(indicators);
    return res.json({
      signal: fallback.action,
      confidence: fallback.confidence,
      reason: fallback.reason,
      breakdown: { fallback }
    });
  }
});

module.exports = router;
