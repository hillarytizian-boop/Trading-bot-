const router = require('express').Router();

// Minimal stub – will be replaced with full logic later
router.get('/status', (req, res) => {
  res.json({ running: false, lastSignal: null, tradesToday: 0, dailyLoss: 0 });
});

router.post('/start', (req, res) => {
  res.json({ status: 'started (stub)' });
});

router.post('/stop', (req, res) => {
  res.json({ status: 'stopped (stub)' });
});

module.exports = router;
