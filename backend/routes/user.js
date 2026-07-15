const router = require('express').Router();
router.post('/settings', (req, res) => res.json({ success: true }));
router.get('/settings', (req, res) => res.json({ settings: {} }));
module.exports = router;
