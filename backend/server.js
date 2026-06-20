require('dotenv').config()
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')

const app = express()

app.use(cors())
app.use(helmet())
app.use(express.json())

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120
}))

app.use('/api/auth', require('./routes/auth'))
app.use('/api/bot', require('./routes/bot'))
app.use('/api/ai', require('./routes/ai'))
app.use('/api/dashboard', require('./routes/dashboard'))
app.use('/api/profile', require('./routes/profile'))

app.get('/', (req, res) => {
  res.json({ status: 'Trading Bot Backend Running' })
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
