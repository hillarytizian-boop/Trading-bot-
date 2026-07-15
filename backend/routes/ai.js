const router = require('express').Router();
const axios = require('axios');

function fallbackSignal(indicators) {
  const { rsi, macd } = indicators;
  let signal = 'HOLD';
  let confidence = 30;
  let reason = '';
  if (rsi < 30) {
    signal = 'BUY';
    confidence = 70 + (30 - rsi) * 1.5;
    reason = `RSI oversold (${rsi.toFixed(1)})`;
  } else if (rsi > 70) {
    signal = 'SELL';
    confidence = 70 + (rsi - 70) * 1.5;
    reason = `RSI overbought (${rsi.toFixed(1)})`;
  } else if (rsi < 45) {
    signal = 'BUY';
    confidence = 50 + (45 - rsi) * 2;
    reason = `RSI moderate low (${rsi.toFixed(1)})`;
  } else if (rsi > 55) {
    signal = 'SELL';
    confidence = 50 + (rsi - 55) * 2;
    reason = `RSI moderate high (${rsi.toFixed(1)})`;
  }
  if (macd && macd > 0 && signal === 'BUY') { confidence += 10; reason += ', MACD positive'; }
  else if (macd && macd < 0 && signal === 'SELL') { confidence += 10; reason += ', MACD negative'; }
  confidence = Math.min(confidence, 100);
  if (confidence < 30) { signal = 'HOLD'; confidence = 25; reason = 'No clear signal'; }
  return { signal, confidence, reason };
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
