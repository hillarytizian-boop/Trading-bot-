const express = require("express");
const path = require("path");
const http = require("http");
const cors = require("cors");
const WebSocket = require("ws");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const frontendPath = path.join(__dirname, "public");
app.use(express.static(frontendPath));

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

const io = new Server(server, {
  cors: { origin: "*" }
});

let symbol = "R_100";

const deriv = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089");

deriv.on("open", () => {
  deriv.send(JSON.stringify({
    ticks: symbol,
    subscribe: 1
  }));
});

deriv.on("message", (msg) => {
  const data = JSON.parse(msg);

  if (data.tick) {
    io.emit("tick", {
      symbol,
      price: data.tick.quote,
      time: data.tick.epoch
    });
  }
});

io.on("connection", (socket) => {
  socket.on("change_symbol", (newSymbol) => {
    symbol = newSymbol;

    deriv.send(JSON.stringify({ forget_all: "ticks" }));

    deriv.send(JSON.stringify({
      ticks: symbol,
      subscribe: 1
    }));
  });
});

server.listen(8000, () => {
  console.log("Server running on port 8000");
});
app.use('/api/binance', require('./routes/binance'));
