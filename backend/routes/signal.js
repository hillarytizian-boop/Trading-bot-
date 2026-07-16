const router = require('express').Router();
const { getEngine } = require('../services/tradingEngine');

router.get('/latest', (req, res) => {
  const engine = getEngine();
  if (!engine) {
    return res.status(503).json({ error: 'Engine not started' });
  }
  const signal = engine.getLatestSignal();
  res.json(signal);
});

module.exports = router;
