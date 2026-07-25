// =====================================================
// Meloniq Skin Analyzer — Modular Backend Gateway
// Serves the API, WebSocket display channel, and static assets
// =====================================================

import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

import { PORT } from "./src/config/index.js";
import apiRoutes from "./src/routes/api.js";
import { setupWebSocketDisplay } from "./src/websocket/displayChannel.js";
import { ensureAiServiceRunning } from "./src/services/processSpawner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: "15mb" }));

// Enable CORS for frontend & ngrok cross-origin access
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, ngrok-skip-browser-warning, User-Agent"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Serve Meloniq soap images statically
app.use("/soaps", express.static(path.join(__dirname, "public/soaps")));

// Mount API routes
app.use(apiRoutes);

// Create HTTP server and attach WebSocket booth display channel
const server = http.createServer(app);
setupWebSocketDisplay(server);

// Socket error handling
server.on("connection", (socket) => {
  socket.on("error", (err) => {
    if (["ECONNRESET", "ECONNABORTED", "EPIPE"].includes(err.code)) return;
    console.error("Connection socket error:", err);
  });
});

server.on("clientError", (err, socket) => {
  if (["ECONNRESET", "ECONNABORTED", "EPIPE"].includes(err.code)) {
    socket.destroy();
    return;
  }
  console.warn("Client connection error:", err.message);
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

// Process-level exception handlers
process.on("uncaughtException", (err) => {
  if (["ECONNRESET", "ECONNABORTED", "EPIPE"].includes(err.code)) {
    console.warn(`[Node Process] Handled socket error gracefully: ${err.message}`);
    return;
  }
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

server.listen(PORT, "0.0.0.0", () => {
  ensureAiServiceRunning();
  console.log(`\n Meloniq Backend Gateway running on port ${PORT}`);
  console.log(`   Health Check   : http://localhost:${PORT}/api/health`);
  console.log(`   API Endpoint   : http://localhost:${PORT}/api/analyze`);
  console.log(`   Python AI      : http://localhost:8000/health`);
  console.log(`   WebSocket      : ws://localhost:${PORT}/ws/display\n`);
});
