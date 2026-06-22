const express = require("express");
const path = require("path");
const http = require("http");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// health route
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// frontend path
const frontendPath = path.join(__dirname, "public");

// serve frontend
app.use(express.static(frontendPath));

// FIXED fallback route (no '*')
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

const PORT = process.env.PORT || 8000;

server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
