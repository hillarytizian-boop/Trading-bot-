const router = require('express').Router();
let running = false;
router.post('/start', (req, res) => { running = true; res.json({ status: 'started' }); });
router.post('/stop', (req, res) => { running = false; res.json({ status: 'stopped' }); });
router.get('/status', (req, res) => res.json({ running, paperBalance: 1000, tradesToday: 0 }));
module.exports = router;
