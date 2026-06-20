const router = require('express').Router()
const engine = require('../services/tradeEngine')

router.post('/start', (req, res) => {
  const { derivToken } = req.body
  engine.start(derivToken)
  res.json({ status: "Hedge fund bot started" })
})

router.post('/stop', (req, res) => {
  engine.stop()
  res.json({ status: "Stopped" })
})

module.exports = router
