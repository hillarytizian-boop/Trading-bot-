const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

// ─── Environment validation ──────────────────────────────────────
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NVIDIA_GLM_API_KEY', 'NVIDIA_DEEPSEEK_API_KEY'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error('❌ Missing required env vars:', missing.join(', '));
  process.exit(1);
}

// ─── Rate limiting ──────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => req.path === '/api/health', // skip health checks
});

function safeRequire(routePath) {
  try {
    const module = require(routePath);
    if (typeof module === 'function') return module;
    if (module && typeof module === 'object' && module.router) return module.router;
    return (req, res) => res.status(501).json({ error: `${routePath} not implemented` });
  } catch (e) {
    console.warn(`⚠️ Route ${routePath} not found – using fallback`);
    return (req, res) => res.status(501).json({ error: `${routePath} not available` });
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Trust proxy (fixes rate limiter warning) ────────────────────
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());
app.use('/api', limiter);

// API routes
app.use('/api/auth', safeRequire('./routes/auth'));
app.use('/api/binance', safeRequire('./routes/binance'));
app.use('/api/ai', safeRequire('./routes/ai'));
app.use('/api/bot', safeRequire('./routes/bot'));
app.use('/api/admin', safeRequire('./routes/admin'));
app.use('/api/trades', safeRequire('./routes/trades'));
app.use('/api/agent', safeRequire('./routes/agent'));
app.use("/api/backtest", safeRequire("./routes/backtest"));
app.use("/api/user", safeRequire("./routes/user"));
app.use('/api/backtest', safeRequire('./routes/backtest'));

app.get('/api/health', (req, res) => res.json({ status: 'OK' }));

// Serve static frontend
const distPath = path.join(__dirname, '../frontend-react/dist');
app.use(express.static(distPath));

// Catch‑all for SPA
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
