const router = require('express').Router();
const axios = require('axios');

// Fallback function that returns signal, confidence, reason
function fallbackSignal(indicators) {
  const { rsi, macd } = indicators;
  let score = 0;
  if (rsi < 30) score += 2;
  else if (rsi > 70) score -= 2;
  if (macd > 0) score += 1;
  else if (macd < 0) score -= 1;
  const signal = score >= 3 ? 'BUY' : score <= -3 ? 'SELL' : 'HOLD';
  const confidence = Math.min(Math.abs(score) / 4 * 100, 100);
  return { signal, confidence, reason: `Technical: RSI=${rsi.toFixed(1)}, MACD=${macd.toFixed(3)}` };
}

// Exported for direct use by agent
async function getAnalysis(market, price, indicators, email) {
  try {
    const response = await axios.post('http://localhost:5002/analyze', {
      symbol: market.replace('/', ''),
      email,
      price,
      indicators,
    }, { timeout: 2500 });
    return response.data; // expects { signal, confidence, reason }
  } catch (error) {
    console.warn('Python agent unavailable, using fallback');
    return fallbackSignal(indicators);
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
