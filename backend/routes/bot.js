const router = require('express').Router();
router.post('/start', (req, res) => res.json({ status: 'started' }));
router.post('/stop', (req, res) => res.json({ status: 'stopped' }));
module.exports = router;
