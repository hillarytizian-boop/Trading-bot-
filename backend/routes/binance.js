const router = require('express').Router();
router.post('/connect', (req, res) => res.json({ success: true }));
router.get('/status', (req, res) => res.json({ connected: false }));
router.get('/balance', (req, res) => res.json({ balance: '0.00' }));
module.exports = router;

// ─── Test endpoint ──────────────────────────────────────────────────
router.get('/test', (req, res) => {
  res.json({ status: 'Binance route is working', time: new Date().toISOString() });
});

// ─── Quick test endpoint (returns immediately) ─────────────────────
router.get('/test-connect', async (req, res) => {
  const { email, apiKey, secretKey } = req.query;
  if (!apiKey || !secretKey) {
    return res.status(400).json({ error: 'Missing keys' });
  }
  try {
    const Binance = require('binance-api-node').default;
    const client = Binance({ apiKey, secretKey });
    const account = await client.accountInfo();
    res.json({ success: true, accountType: account.accountType });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
