const router = require('express').Router();
router.get('/settings', (req, res) => res.json({ settings: {} }));
router.post('/settings', (req, res) => res.json({ success: true }));
module.exports = router;
