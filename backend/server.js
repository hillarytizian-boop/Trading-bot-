// ─── Global fetch polyfill ──────────────────────────────────────────
const fetch = require('node-fetch');
global.fetch = fetch;

const express = require('express');
const cors = require('cors');
const path = require('path');
const compression = require('compression');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(compression());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ─── Authentication middleware with fallback ──────────────────────
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  // 1. If JWT token is provided, verify it with Supabase
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (!error && user) {
        req.user = user;
        console.log(`[AUTH] JWT user: ${user.email}`);
        return next();
      }
    } catch (e) {
      console.warn('[AUTH] JWT verification failed, falling back to email body');
    }
  }

  // 2. Fallback: use email from request body (backward compatibility)
  const email = req.body?.email || req.query?.email;
  if (email) {
    // Create a minimal user object
    req.user = { email, id: email };
    console.log(`[AUTH] Fallback email: ${email}`);
    return next();
  }

  // 3. No email and no token – reject
  return res.status(401).json({ error: 'Authentication required' });
}

// ─── Public endpoints ──────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'OK' }));

// ─── Protected routes (with fallback) ──────────────────────────────
app.use('/api', authenticate);

function safeRequire(routePath) {
  try {
    const module = require(routePath);
    if (typeof module === 'function') return module;
    if (module && module.router && typeof module.router === 'function') return module.router;
    if (module && typeof module === 'object') return module;
    return (req, res) => res.status(501).json({ error: `${routePath} not implemented` });
  } catch (e) {
    console.error(`❌ Failed to load ${routePath}:`, e.message);
    return (req, res) => res.status(501).json({ error: `${routePath} not available` });
  }
}

console.log('✅ Mounting routes...');
app.use('/api/auth', safeRequire('./routes/auth.js'));
app.use('/api/binance', safeRequire('./routes/binance.js'));
app.use('/api/ai', safeRequire('./routes/ai.js'));
app.use('/api/bot', safeRequire('./routes/bot.js'));
app.use('/api/admin', safeRequire('./routes/admin.js'));
app.use('/api/trades', safeRequire('./routes/trades.js'));
app.use('/api/agent', safeRequire('./routes/agent.js'));
app.use('/api/backtest', safeRequire('./routes/backtest.js'));
app.use('/api/user', safeRequire('./routes/user.js'));
app.use('/api/trade', safeRequire('./routes/trade.js'));
console.log('✅ Routes mounted');

// ─── Serve frontend ──────────────────────────────────────────────────
const distPath = path.join(__dirname, '../frontend-react/dist');
app.use(express.static(distPath));

app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
