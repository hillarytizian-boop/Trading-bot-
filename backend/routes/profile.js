const express = require('express');
const auth = require('../middleware/auth');
const router = express.Router();

router.put('/', auth, async (req, res) => {
  try {
    if (req.body.binanceApiKey) req.user.binanceApiKey = req.body.binanceApiKey;
    if (req.body.binanceSecretKey) req.user.binanceSecretKey = req.body.binanceSecretKey;
    await req.user.save();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ msg: err.message }); }
});

module.exports = router;
