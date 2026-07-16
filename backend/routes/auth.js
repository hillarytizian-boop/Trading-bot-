const router = require('express').Router();
const supabase = require('../db');
const bcrypt = require('bcryptjs');
const { generateToken, verifyToken } = require('../middleware/auth');

// ─── Sign up ─────────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    const { data, error } = await supabase
      .from('users')
      .insert([{ email, password_hash: hashedPassword, name: name || email.split('@')[0] }])
      .select('id, email, name, role')
      .single();
    if (error) throw error;
    const token = generateToken(data);
    res.json({ user: data, token });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, name, role, password_hash')
      .eq('email', email)
      .single();
    if (error || !data) throw new Error('Invalid credentials');
    const valid = await bcrypt.compare(password, data.password_hash);
    if (!valid) throw new Error('Invalid credentials');
    delete data.password_hash;
    const token = generateToken(data);
    res.json({ user: data, token });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ─── Get current user ──────────────────────────────────────────
router.get('/me', verifyToken, async (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
