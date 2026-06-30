const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const binanceRoutes = require('./routes/binance');
const aiRoutes = require('./routes/ai');
const botRoutes = require('./routes/bot');
const adminRoutes = require('./routes/admin');
const tradeRoutes = require('./routes/trades');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/binance', binanceRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/bot', botRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/trades', tradeRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'OK' }));

// Serve static frontend files (built from frontend-react/dist)
const distPath = path.join(__dirname, '../frontend-react/dist');
app.use(express.static(distPath));

// For any non-API routes, serve index.html (SPA routing)
app.get('*', (req, res) => {
  // If it's an API route and hasn't been matched, return 404 JSON
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
