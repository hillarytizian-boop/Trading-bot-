const express = require('express');
const cors = require('cors');
const path = require('path');

// Helper to safely require a route – returns a fallback handler if the file is missing
function safeRequire(routePath) {
  try {
    const module = require(routePath);
    // If it's a function (router), return it; otherwise return a fallback
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

app.use(cors());
app.use(express.json());

// Mount all API routes
app.use('/api/auth', safeRequire('./routes/auth'));
app.use('/api/binance', safeRequire('./routes/binance'));
app.use('/api/ai', safeRequire('./routes/ai'));
app.use('/api/bot', safeRequire('./routes/bot'));
app.use('/api/admin', safeRequire('./routes/admin'));
app.use('/api/trades', safeRequire('./routes/trades'));
app.use('/api/agent', safeRequire('./routes/agent'));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'OK' }));

// Serve static frontend
const distPath = path.join(__dirname, '../frontend-react/dist');
app.use(express.static(distPath));

// Catch-all for SPA
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
