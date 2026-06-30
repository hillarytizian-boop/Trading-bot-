const router = require('express').Router();
router.post('/analyze', (req, res) => {
  res.json({ signal: 'BUY', confidence: 92, risk: 'LOW', reason: 'Mock AI response' });
});
module.exports = router;
