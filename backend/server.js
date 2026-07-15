const { spawn } = require("child_process");
const express = require('express');
const cors = require('cors');
const path = require('path');
const compression = require('compression');
const { spawn } = require('child_process');

// ─── Start Python agent service ──────────────────────────────────
console.log("🐍 Starting Python agent service...");
const pythonProcess = spawn("./backend/agents_py/start.sh", [], {
  detached: false,
  stdio: "inherit",
  shell: true,
});
pythonProcess.on("error", (err) => console.error("Python agent error:", err));
pythonProcess.on("exit", (code) => console.log("Python agent exited with code", code));

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Start Python agent service ──────────────────────────────────
console.log('🐍 Starting Python agent service...');
const pythonProcess = spawn('./backend/agents_py/start.sh', [], {
  detached: false,
  stdio: 'inherit',
  shell: true,
});
pythonProcess.on('error', (err) => {
  console.error('Failed to start Python agent:', err);
});
pythonProcess.on('exit', (code) => {
  console.log(`Python agent exited with code ${code}`);
});

// ─── Rest of server (routes, static, etc.) ──────────────────────
// ... (same as before, but with the Python process started)
