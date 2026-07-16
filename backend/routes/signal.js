const router = require('express').Router();
router.get('/', (req, res) => res.json({ message: 'Signal stub' }));
module.exports = router;
