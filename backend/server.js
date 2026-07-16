const express = require('express');
const cors = require('cors');
const path = require('path');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(compression());
app.use(express.json());

function safeRequire(routePath) {
  try {
    const module = require(routePath);
    if (typeof module === 'function') return module;
    if (module && module.router && typeof module.router === 'function') return module.router;
    if (module && typeof module === 'object') return module;
    return (req, res) => res.status(501).json({ error: `${routePath} not implemented` });
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
app.use('/api/signal', safeRequire('./routes/signal.js'));
console.log('✅ Routes mounted');

app.get('/api/health', (req, res) => res.json({ status: 'OK' }));

const distPath = path.join(__dirname, '../frontend-react/dist');
app.use(express.static(distPath));

app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
