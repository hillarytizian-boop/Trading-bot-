const DERIV_WS = "wss://ws.derivws.com/websockets/v3?app_id=1089"

class DerivClient {
  constructor() {
    this.ws = null
    this.token = null
    this.callbacks = {}
  }

  connect() {
    this.ws = new WebSocket(DERIV_WS)

    this.ws.onopen = () => {
      console.log("Deriv connected")
      if (this.token) this.authorize(this.token)
    }

    this.ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data)

      if (this.callbacks[data.msg_type]) {
        this.callbacks[data.msg_type](data)
      }
    }

    this.ws.onclose = () => {
      console.log("Deriv disconnected, reconnecting...")
      setTimeout(() => this.connect(), 3000)
    }
  }

  setToken(token) {
    this.token = token
  }

  authorize(token) {
    this.send({
      authorize: token
    })
  }

  getBalance(callback) {
    this.callbacks.balance = callback
    this.send({ balance: 1 })
  }

  subscribeTicks(symbol, callback) {
    this.callbacks.tick = callback
    this.send({
      ticks: symbol,
      subscribe: 1
    })
  }

  buy(contractType, amount, symbol) {
    this.send({
      buy: 1,
      price: amount,
      parameters: {
        amount,
        basis: "stake",
        contract_type: contractType,
        currency: "USD",
        symbol
      }
    })
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }
}

export const deriv = new DerivClient()
