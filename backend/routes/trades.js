const router = require('express').Router();
const supabase = require('../db');
router.get('/', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.json([]);
  const { data } = await supabase.from('trades').select('*').eq('user_email', email);
  res.json(data || []);
});
router.get('/active', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.json([]);
  const { data } = await supabase.from('trades').select('*').eq('user_email', email).eq('status', 'open');
  res.json(data || []);
});
module.exports = router;
