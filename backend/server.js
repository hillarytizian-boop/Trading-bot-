const express = require('express');
const cors = require('cors');
const path = require('path');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(compression());
app.use(express.json());

// ─── Helper: try to require, fallback to dummy router ──────────────
function loadRoute(file) {
  try {
    const mod = require(file);
    if (typeof mod === 'function' && mod.router) return mod.router;
    if (typeof mod === 'function') return mod;
    if (mod && typeof mod === 'object' && mod.router) return mod.router;
    // If it's a plain object, wrap it
    if (mod && typeof mod === 'object') {
      const router = express.Router();
      router.use((req, res) => res.status(501).json({ error: `${file} not implemented` }));
      return router;
    }
    // Fallback
    const router = express.Router();
    router.use((req, res) => res.status(501).json({ error: `${file} not found` }));
    return router;
  } catch (e) {
    const router = express.Router();
    router.use((req, res) => res.status(501).json({ error: `${file} unavailable` }));
    return router;
  }
}

// ─── Mount routes ──────────────────────────────────────────────────
app.use('/api/auth', loadRoute('./routes/auth'));
app.use('/api/binance', loadRoute('./routes/binance'));
app.use('/api/ai', loadRoute('./routes/ai'));
app.use('/api/bot', loadRoute('./routes/bot'));
app.use('/api/admin', loadRoute('./routes/admin'));
app.use('/api/trades', loadRoute('./routes/trades'));
app.use('/api/agent', loadRoute('./routes/agent'));
app.use("/api/backtest", safeRequire("./routes/backtest"));
app.use('/api/backtest', loadRoute('./routes/backtest'));
app.use('/api/user', loadRoute('./routes/user'));

app.get('/api/health', (req, res) => res.json({ status: 'OK' }));

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
