const express = require('express');
const cors = require('cors');
const path = require('path');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(compression());
app.use(express.json());

// ─── Import all routes (they all exist now) ──────────────────────
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
console.log('✅ Mounting routes...');
app.use('/api/auth', authRoutes);
console.log('  /api/auth');
app.use('/api/binance', binanceRoutes);
console.log('  /api/binance');
app.use('/api/ai', aiRoutes);
console.log('  /api/ai');
app.use('/api/bot', botRoutes);
console.log('  /api/bot');
app.use('/api/admin', adminRoutes);
console.log('  /api/admin');
app.use('/api/trades', tradeRoutes);
console.log('  /api/trades');
app.use('/api/agent', agentRoutes);
console.log('  /api/agent');
app.use('/api/backtest', backtestRoutes);
console.log('  /api/backtest');
app.use('/api/user', userRoutes);
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
