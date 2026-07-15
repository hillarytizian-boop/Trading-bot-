const router = require('express').Router();
router.post('/analyze', (req, res) => {
  const { market, price, indicators, email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  // Simple fallback – will be overridden by agent if needed
  const rsi = indicators?.rsi || 50;
  let signal = 'HOLD', confidence = 30, reason = 'No clear signal';
  if (rsi < 30) { signal = 'BUY'; confidence = 70; reason = 'RSI oversold'; }
  else if (rsi > 70) { signal = 'SELL'; confidence = 70; reason = 'RSI overbought'; }
  res.json({ signal, confidence, reason });
});
module.exports = router;
