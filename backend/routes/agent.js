const router = require('express').Router();
router.post('/start', (req, res) => res.json({ status: 'started' }));
router.post('/stop', (req, res) => res.json({ status: 'stopped' }));
router.get('/status', (req, res) => res.json({ running: false }));
router.post('/manual-trade', (req, res) => res.json({ success: true }));
module.exports = router;
