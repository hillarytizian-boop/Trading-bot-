const express = require('express');
const auth = require('../middleware/auth');
const AIService = require('../services/AIService');
const router = express.Router();

router.post('/analyze', auth, async (req, res) => {
  try {
    const { market, price, indicators } = req.body;
    if (!price) return res.status(400).json({ error: 'price required' });
    const result = await AIService.analyzeMarket({
      symbol: market || 'BTCUSDT',
      price,
      rsi: indicators?.rsi || 50,
      ema20: indicators?.ema20 || price,
      ema50: indicators?.ema50 || price,
      macd: indicators?.macd || 0,
      volume: indicators?.volume || 'N/A',
      trend: indicators?.trend || 'neutral'
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
