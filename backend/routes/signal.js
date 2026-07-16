const router = require('express').Router();
router.get('/', (req, res) => res.json({ signal: 'HOLD', confidence: 0 }));
module.exports = router;
