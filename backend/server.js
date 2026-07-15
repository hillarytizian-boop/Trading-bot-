const express = require('express');
const cors = require('cors');
const path = require('path');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(compression());
app.use(express.json());

// ─── Helper to safely require a route ────────────────────────────
function safeRequire(routePath) {
  try {
    const module = require(routePath);
    // If it's a function, assume it's a router
    if (typeof module === 'function') return module;
    // If it has a router property, use that
    if (module && module.router && typeof module.router === 'function') return module.router;
    // If it's an object with routes, try to use it as is (some routers are objects)
    if (module && typeof module === 'object') return module;
    // Fallback
    console.warn(`⚠️ Route ${routePath} is not a valid router, using fallback`);
    return (req, res) => res.status(501).json({ error: `${routePath} not implemented` });
  } catch (e) {
    console.warn(`⚠️ Route ${routePath} not found, using fallback`);
    return (req, res) => res.status(501).json({ error: `${routePath} not available` });
  }
}

// ─── Mount routes ──────────────────────────────────────────────────
console.log('✅ Mounting routes...');
app.use('/api/auth', safeRequire('./routes/auth'));
console.log('  /api/auth');
app.use('/api/binance', safeRequire('./routes/binance'));
console.log('  /api/binance');
app.use('/api/ai', safeRequire('./routes/ai'));
console.log('  /api/ai');
app.use('/api/bot', safeRequire('./routes/bot'));
console.log('  /api/bot');
app.use('/api/admin', safeRequire('./routes/admin'));
console.log('  /api/admin');
app.use('/api/trades', safeRequire('./routes/trades'));
console.log('  /api/trades');
app.use('/api/agent', safeRequire('./routes/agent'));
console.log('  /api/agent');
app.use('/api/backtest', safeRequire('./routes/backtest'));
console.log('  /api/backtest');
app.use('/api/user', safeRequire('./routes/user'));
console.log('  /api/user');

app.get('/api/health', (req, res) => res.json({ status: 'OK' }));

// ─── Serve static frontend ────────────────────────────────────────
const distPath = path.join(__dirname, '../frontend-react/dist');
app.use(express.static(distPath));

// ─── Catch‑all for SPA ────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
