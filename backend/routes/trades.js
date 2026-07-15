const router = require('express').Router();
router.get('/', (req, res) => res.json([]));
router.get('/active', (req, res) => res.json([]));
module.exports = router;
