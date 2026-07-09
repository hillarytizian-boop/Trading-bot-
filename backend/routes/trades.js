const router = require('express').Router();
const supabase = require('../db');

// GET all trades for a user
router.get('/', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .eq('user_email', email)
      .order('opened_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET active (open) trades
router.get('/active', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .eq('user_email', email)
      .eq('status', 'open')
      .order('opened_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
