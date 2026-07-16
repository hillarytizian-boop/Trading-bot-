const router = require('express').Router();
router.post('/run', (req, res) => res.json({ message: 'Backtest stub', totalReturn: 0 }));
module.exports = router;
