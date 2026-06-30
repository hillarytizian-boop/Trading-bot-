const express = require('express');
const cors = require('cors');
const supabase = require('./db');

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

app.use('/api/auth', authRoutes);
app.use('/api/binance', binanceRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/bot', botRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/trades', tradeRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'OK' }));

// 404 catch-all – using function (no path) to avoid path-to-regexp error
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server (no database sync needed with Supabase)
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
