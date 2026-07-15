const express = require('express');
const cors = require('cors');
const path = require('path');
const compression = require('compression');

// ─── Safe require wrapper ──────────────────────────────────────────
function safeRequire(routePath) {
  try {
    const mod = require(routePath);
    if (typeof mod === 'function') return mod;
    if (mod && typeof mod === 'object' && mod.router) return mod.router;
    // If it's an object with no router, return a fallback
    if (mod && typeof mod === 'object') {
      return (req, res) => res.status(501).json({ error: `${routePath} is not a router` });
    }
    return (req, res) => res.status(501).json({ error: `${routePath} not implemented` });
  } catch (e) {
    console.warn(`⚠️ Route ${routePath} not found – using fallback`);
    return (req, res) => res.status(501).json({ error: `${routePath} unavailable` });
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(compression());
app.use(express.json());

// ─── Mount routes ──────────────────────────────────────────────────
app.use('/api/auth', safeRequire('./routes/auth'));
app.use('/api/binance', safeRequire('./routes/binance'));
app.use('/api/ai', safeRequire('./routes/ai'));
app.use('/api/bot', safeRequire('./routes/bot'));
app.use('/api/admin', safeRequire('./routes/admin'));
app.use('/api/trades', safeRequire('./routes/trades'));
app.use('/api/agent', safeRequire('./routes/agent'));
app.use('/api/backtest', safeRequire('./routes/backtest'));
app.use('/api/user', safeRequire('./routes/user'));

app.get('/api/health', (req, res) => res.json({ status: 'OK' }));

// ─── Debug: print routes ──────────────────────────────────────────
console.log('✅ Registered API routes:');
app._router.stack.forEach((layer) => {
  if (layer.route) {
    console.log(`  ${Object.keys(layer.route.methods).join(',')} ${layer.route.path}`);
  } else if (layer.name === 'router' && layer.regexp) {
    const basePath = layer.regexp.source
      .replace(/\\\//g, '/')
      .replace(/\^/g, '')
      .replace(/\?/g, '')
      .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, ':param');
    layer.handle.stack.forEach((handler) => {
      if (handler.route) {
        const methods = Object.keys(handler.route.methods).join(',');
        const fullPath = basePath + handler.route.path;
        console.log(`  ${methods} ${fullPath}`);
      }
    });
  }
});
console.log('✅ Route listing complete.\n');

// ─── Serve static frontend ──────────────────────────────────────
const distPath = path.join(__dirname, '../frontend-react/dist');
app.use(express.static(distPath));

// ─── Catch‑all for SPA ──────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
