// ─── Global fetch polyfill (Node 18+ has native fetch) ─────────────
// const fetch = require('node-fetch');
// global.fetch = fetch;

const express = require('express');
const cors = require('cors');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Validate required environment variables ──────────────────────
const requiredEnv = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`❌ Missing environment variable: ${key}`);
    process.exit(1);
  }
}

// ─── Security & logging middleware ────────────────────────────────
app.use(helmet());
app.use(morgan('combined'));
app.set('trust proxy', 1);
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Supabase client ──────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ─── Authentication middleware ────────────────────────────────────
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  // 1. JWT token
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
      console.warn('[AUTH] JWT verification failed');
    }
  }

  // 2. Email fallback (only if enabled)
  const email = req.body?.email || req.query?.email;
  if (email && process.env.ALLOW_EMAIL_FALLBACK === 'true') {
    req.user = { email, id: email };
    console.log(`[AUTH] Fallback (demo) email: ${email}`);
    return next();
  }

  // 3. No valid auth
  return res.status(401).json({ error: 'Authentication required' });
}

// ─── Public endpoint ──────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'OK' }));

// ─── Protect all other /api routes ──────────────────────────────
app.use('/api', authenticate);

// ─── Safe route loader ─────────────────────────────────────────────
function safeRequire(routePath) {
  try {
    const module = require(routePath);
    if (typeof module === 'function') return module;
    if (module && module.router && typeof module.router === 'function') return module.router;
    if (module && typeof module === 'object' && module.router) return module.router;
    console.warn(`⚠️ ${routePath} does not export a valid router, using fallback`);
    return (req, res) => res.status(501).json({ error: `${routePath} not properly implemented` });
  } catch (e) {
    console.error(`❌ Failed to load ${routePath}:`, e.message);
    console.error(e.stack);
    return (req, res) => res.status(501).json({ error: `${routePath} not available: ${e.message}` });
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

// ─── Serve static frontend ──────────────────────────────────────
const distPath = path.join(__dirname, '../frontend-react/dist');
if (!fs.existsSync(distPath)) {
  console.warn('⚠️ Frontend build not found. Run `npm run build` in frontend-react');
} else {
  app.use(express.static(distPath));
}

// ─── Catch‑all for SPA ──────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  if (fs.existsSync(distPath)) {
    res.sendFile(path.join(distPath, 'index.html'));
  } else {
    res.status(404).send('Frontend not built – run `npm run build`');
  }
});

// ─── Global error handler ────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('🔥 Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Graceful shutdown ────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('🔻 Shutting down gracefully...');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('🔻 Stopping server...');
  process.exit(0);
});

// ─── Start server ──────────────────────────────────────────────────
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
