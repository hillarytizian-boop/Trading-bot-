const express = require('express');
const cors = require('cors');
const path = require('path');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(compression());
app.use(express.json());

// ─── Helper to safely require routes ────────────────────────────
function safeRequire(routePath) {
  try {
    const module = require(routePath);
    if (typeof module === 'function') return module;
    if (module && module.router && typeof module.router === 'function') return module.router;
    if (module && typeof module === 'object') return module;
    return (req, res) => res.status(501).json({ error: `${routePath} not implemented` });
  } catch (e) {
    console.warn(`⚠️ Route ${routePath} not found, using fallback`);
    return (req, res) => res.status(501).json({ error: `${routePath} not available` });
  }
}

// ─── Mount routes ──────────────────────────────────────────────────
console.log('✅ Mounting routes...');
app.use('/api/auth', safeRequire('./routes/auth'));
app.use("/api/ai", safeRequire("./routes/ai"));
app.use('/api/binance', safeRequire('./routes/binance'));
app.use('/api/ai', safeRequire('./routes/ai'));
app.use('/api/bot', safeRequire('./routes/bot'));
app.use('/api/admin', safeRequire('./routes/admin'));
app.use('/api/trades', safeRequire('./routes/trades'));
app.use("/api/backtest", safeRequire("./routes/backtest"));
app.use('/api/agent', safeRequire('./routes/agent'));
app.use("/api/trade", safeRequire("./routes/trade"));
app.use("/api/backtest", safeRequire("./routes/backtest"));
app.use('/api/backtest', safeRequire('./routes/backtest'));
app.use('/api/user', safeRequire('./routes/user'));
app.use("/api/signal", safeRequire("./routes/signal"));
console.log('✅ Routes mounted');

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
