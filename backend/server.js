const express = require('express');
const cors = require('cors');
const sequelize = require('./db');

// Import routes (adjust paths if they exist)
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
app.use(express.urlencoded({ extended: true }));

// API endpoints
app.use('/api/auth', authRoutes);
app.use('/api/binance', binanceRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/bot', botRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/trades', tradeRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 404 fallback
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Sync database and start
sequelize.sync({ force: false })
  .then(() => {
    console.log('✅ Database synced (SQLite in-memory)');
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch(err => {
    console.error('❌ DB sync failed:', err);
    process.exit(1);
  });
