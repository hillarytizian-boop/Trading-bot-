const router = require('express').Router();
const supabase = require('../db');
router.post('/settings', async (req, res) => {
  const { email, settings } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const { data: existing } = await supabase.from('users').select('bot_settings').eq('email', email).single();
  const merged = { ...(existing?.bot_settings || {}), ...settings };
  await supabase.from('users').update({ bot_settings: merged }).eq('email', email);
  res.json({ success: true, settings: merged });
});
router.get('/settings', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });
  const { data } = await supabase.from('users').select('bot_settings, paper_balance').eq('email', email).single();
  res.json({ settings: data?.bot_settings || {}, paperBalance: data?.paper_balance || 1000 });
});
module.exports = router;
