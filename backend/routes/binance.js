const router = require('express').Router();
router.post('/connect', (req, res) => res.json({ success: true }));
router.get('/status', (req, res) => res.json({ connected: false }));
router.get('/balance', (req, res) => res.json({ balance: '0.00' }));
module.exports = router;

// ─── Test endpoint ──────────────────────────────────────────────────
router.get('/test', (req, res) => {
  res.json({ status: 'Binance route is working', time: new Date().toISOString() });
});
