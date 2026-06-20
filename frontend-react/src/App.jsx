import { useEffect, useState } from 'react'
import { api } from './api'

export default function App() {
  const [price, setPrice] = useState(null)
  const [signal, setSignal] = useState(null)
  const [confidence, setConfidence] = useState(0)

  useEffect(() => {
    const ws = new WebSocket('wss://ws.deriv.com/websockets/v3?app_id=1089')

    ws.onopen = () => {
      ws.send(JSON.stringify({ ticks: 'R_100', subscribe: 1 }))
    }

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data)
      if (data.tick) setPrice(data.tick.quote)
    }

    return () => ws.close()
  }, [])

  const analyze = async () => {
    const res = await api().post('/ai/analyze', {
      market: 'R_100',
      price: price || 100
    })

    setSignal(res.data.signal)
    setConfidence(res.data.confidence)
  }

  return (
    <div style={{padding:20}}>
      <h2>Trading Terminal</h2>
      <p>Price: {price}</p>

      <button onClick={analyze}>Analyze</button>

      {signal && (
        <div>
          <h3>Signal: {signal}</h3>
          <p>Confidence: {confidence}%</p>
        </div>
      )}
    </div>
  )
}
