const router = require('express').Router();
router.get('/me', (req, res) => res.json({ user: { name: 'Demo', role: 'user' } }));
module.exports = router;
