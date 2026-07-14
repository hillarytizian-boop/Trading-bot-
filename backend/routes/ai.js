const router = require('express').Router();
const axios = require('axios');

function fallbackSignal(indicators) {
  const { rsi, macd, ema } = indicators;
  let signal = 'HOLD';
  let confidence = 25;
  // Oversold / Overbought
  if (rsi < 30) { signal = 'BUY'; confidence = 70; }
  else if (rsi > 70) { signal = 'SELL'; confidence = 70; }
  else if (rsi < 40) { signal = 'BUY'; confidence = 50; }
  else if (rsi > 60) { signal = 'SELL'; confidence = 50; }
  // MACD confirmation
  if (macd && macd > 0 && signal === 'BUY') confidence += 10;
  else if (macd && macd < 0 && signal === 'SELL') confidence += 10;
  // EMA trend (dummy)
  if (ema && signal === 'BUY' && ema > 0) confidence += 5;
  confidence = Math.min(confidence, 100);
  if (confidence < 30) { signal = 'HOLD'; confidence = 25; }
  return { signal, confidence, reason: `Fallback: RSI=${rsi.toFixed(1)}, MACD=${macd?.toFixed(3) || 'N/A'}` };
}

async function getAnalysis(market, price, indicators, email) {
  try {
    const response = await axios.post('http://localhost:5002/analyze', {
      symbol: market.replace('/', ''),
      email,
      price,
      indicators,
    }, { timeout: 2500 });
    return response.data;
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
