import { useEffect, useState } from "react"
import { deriv } from "./deriv"

function App() {
  const [balance, setBalance] = useState(null)
  const [price, setPrice] = useState(null)
  const [token, setToken] = useState("")

  useEffect(() => {
    deriv.connect()
  }, [])

  const connectAccount = () => {
    deriv.setToken(token)
    deriv.authorize(token)

    deriv.getBalance((data) => {
      setBalance(data.balance?.balance)
    })

    deriv.subscribeTicks("R_100", (data) => {
      setPrice(data.tick?.quote)
    })
  }

  const tradeBuy = () => {
    deriv.buy("CALL", 1, "R_100")
  }

  const tradeSell = () => {
    deriv.buy("PUT", 1, "R_100")
  }

  return (
    <div style={{ padding: 20, fontFamily: "monospace" }}>
      <h1>DERIV LIVE TERMINAL</h1>

      <input
        placeholder="Paste API Token"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        style={{ width: "100%", padding: 10 }}
      />

      <button onClick={connectAccount}>Connect</button>

      <h2>Balance: {balance ?? "Not connected"}</h2>
      <h2>Price: {price ?? "Waiting..."}</h2>

      <button onClick={tradeBuy}>BUY</button>
      <button onClick={tradeSell}>SELL</button>
    </div>
  )
}

export default App
