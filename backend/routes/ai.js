const router = require('express').Router()
const { analyzeMarket } = require('../services/aiEngine')

router.post('/analyze', async (req, res) => {
  try {
    const result = await analyzeMarket(req.body)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: 'AI analysis failed' })
  }
})

module.exports = router
