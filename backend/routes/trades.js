const router = require('express').Router();
router.get('/', (req, res) => {
  const { email } = req.query;
  res.json([]);
});
router.get('/active', (req, res) => {
  const { email } = req.query;
  res.json([]);
});
module.exports = router;
