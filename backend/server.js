// ─── Global fetch polyfill ──────────────────────────────────────────
const fetch = require('node-fetch');
global.fetch = fetch;

const express = require('express');
const cors = require('cors');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// ─── Global uncaught exception handler ────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('🔥 Uncaught Exception:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('🔥 Unhandled Rejection:', reason);
});

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Validate env ──────────────────────────────────────────────────
const requiredEnv = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`❌ Missing ${key}`);
    process.exit(1);
  }
}

// ─── Middleware ────────────────────────────────────────────────────
app.use(helmet());
app.use(morgan('combined'));
app.set('trust proxy', 1);
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ─── Authentication ──────────────────────────────────────────────
async function authenticate(req, res, next) {
  // ─── Public endpoints: no auth required ──────────────────────────
  const publicPaths = ["/api/health", "/api/ai/market-data"];
  if (publicPaths.some(path => req.path.startsWith(path))) {
    return next();
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (!error && user) {
        req.user = user;
        return next();
      }
    } catch (e) { /* ignore */ }
  }
  const email = req.body?.email || req.query?.email;
  if (email && process.env.ALLOW_EMAIL_FALLBACK === 'true') {
    req.user = { email, id: email };
    return next();
  }
  return res.status(401).json({ error: 'Authentication required' });
}

app.get('/api/health', (req, res) => res.json({ status: 'OK' }));
app.use('/api', authenticate);

function safeRequire(routePath) {
  try {
    const module = require(routePath);
    if (typeof module === 'function') return module;
    if (module && module.router && typeof module.router === 'function') return module.router;
    if (module && typeof module === 'object' && module.router) return module.router;
    return (req, res) => res.status(501).json({ error: `${routePath} not properly implemented` });
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

// ─── Serve frontend ──────────────────────────────────────────────
const distPath = path.join(__dirname, '../frontend-react/dist');
if (fs.existsSync(distPath)) app.use(express.static(distPath));

app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  if (fs.existsSync(distPath)) {
    res.sendFile(path.join(distPath, 'index.html'));
  } else {
    res.status(404).send('Frontend not built');
  }
});

// ─── Global error handler ────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('🔥 Global error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Create HTTP server ──────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// ─── WebSocket server (simpler approach) ──────────────────────────
const WebSocket = require('ws');
const { instance } = require('./binanceData');
const marketData = require('./marketData');

const wss = new WebSocket.Server({ 
  server, 
  path: '/ws' 
});

wss.on('connection', (ws) => {
  console.log('[WS] Frontend connected');
  ws.on('close', () => console.log('[WS] Frontend disconnected'));
});

// ─── Broadcast price updates every 2 seconds ──────────────────────
let lastPrice = null;
let lastCandles = [];

async function broadcastPrice() {
  try {
    const data = await instance.getAnalysisData('BTCUSDT');
    const price = data.price;
    const candles = data.closes;
    if (price && price !== lastPrice) {
      lastPrice = price;
      lastCandles = candles;
      const message = JSON.stringify({ price, candles: candles.slice(-50) });
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    }
  } catch (e) {
    // ignore
  }
}

setInterval(broadcastPrice, 2000);

// ─── Start market data subscriptions ──────────────────────────────
marketData.start(['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT']);

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
