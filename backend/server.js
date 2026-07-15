const express = require('express');
const cors = require('cors');
const path = require('path');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(compression());
app.use(express.json());

// ─── Import routes ──────────────────────────────────────────────────
const authRoutes = require('./routes/auth');
const binanceRoutes = require('./routes/binance');
const aiRoutes = require('./routes/ai');
const botRoutes = require('./routes/bot');
const adminRoutes = require('./routes/admin');
const tradeRoutes = require('./routes/trades');
const agentRoutes = require('./routes/agent');
const backtestRoutes = require('./routes/backtest');
const userRoutes = require('./routes/user');

// ─── Mount routes ──────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/binance', binanceRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/bot', botRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/backtest', backtestRoutes);
app.use('/api/user', userRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'OK' }));

// ─── DEBUG: Print all registered routes ──────────────────────────
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
