const router = require('express').Router();
router.post('/analyze', (req, res) => res.json({ signal: 'HOLD', confidence: 50, reason: 'Mock' }));
module.exports = router;
