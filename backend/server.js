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
const PORT = process.env.PORT || 10000;

// ─── Validate environment gracefully ──────────────────────────────
const requiredEnv = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NVIDIA_API_KEY'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.warn(`⚠️ Warning: Missing environment variable: ${key}`);
  }
}

// ─── Middleware ────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('combined'));
app.set('trust proxy', 1);
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Supabase client ──────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_ANON_KEY || 'placeholder'
);

// ─── Authentication middleware ────────────────────────────────────
async function authenticate(req, res, next) {
  const publicPaths = ['/health', '/ai/market-data'];
  if (publicPaths.some(p => req.path.startsWith(p))) {
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
    } catch (e) {
      console.warn('[AUTH] JWT verification failed');
    }
  }

  const email = req.body?.email || req.query?.email;
  if (email) {
    req.user = { email, id: email };
    return next();
  }

  return res.status(401).json({ error: 'Authentication required' });
}

// ─── Public endpoints ──────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'OK', message: '17-Agent Desk Online' }));
app.get('/api/health', (req, res) => res.json({ status: 'OK', message: '17-Agent Desk Online' }));

app.get('/api/ai/market-data', async (req, res) => {
  let { symbol = 'BTCUSDT' } = req.query;
  symbol = symbol.replace(/\//g, '');
  try {
    const { instance } = require('./binanceData');
    const data = await instance.getAnalysisData(symbol);
    res.json(data);
  } catch (error) {
    console.error('[Market-Data] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Protected routes ──────────────────────────────────────────────
app.use('/api', authenticate);

function safeRequire(routePath) {
  try {
    const module = require(routePath);
    if (typeof module === 'function') return module;
    if (module && module.router) return module.router;
    return (req, res) => res.status(501).json({ error: `${routePath} not implemented` });
  } catch (e) {
    console.error(`❌ Failed to load ${routePath}:`, e.message);
    return (req, res) => res.status(501).json({ error: `${routePath} missing` });
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
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  if (fs.existsSync(distPath)) {
    res.sendFile(path.join(distPath, 'index.html'));
  } else {
    res.status(404).send('Backend running. Frontend build pending.');
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server active on port ${PORT}`);
});

// ─── WebSocket server ──────────────────────────────────────────────
const WebSocket = require('ws');
const { instance } = require('./binanceData');
const marketData = require('./marketData');

const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
});

let lastPrice = null;
async function broadcastPrice() {
  try {
    const data = await instance.getAnalysisData('BTCUSDT');
    if (data.price && data.price !== lastPrice) {
      lastPrice = data.price;
      const message = JSON.stringify({ price: data.price, candles: data.closes.slice(-50) });
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) client.send(message);
      });
    }
  } catch (e) {}
}

setInterval(broadcastPrice, 2000);
marketData.start(['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT']);

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
