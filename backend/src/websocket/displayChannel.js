import { WebSocketServer } from "ws";

const displays = new Set();

export function setupWebSocketDisplay(server) {
  const wss = new WebSocketServer({ server, path: "/ws/display" });

  wss.on("error", (err) => {
    console.error("WebSocket server error:", err);
  });

  wss.on("connection", (socket) => {
    displays.add(socket);
    socket.on("close", () => displays.delete(socket));
    socket.on("error", () => displays.delete(socket));

    try {
      socket.send(JSON.stringify({ type: "hello" }));
    } catch {
      // ignore
    }
  });

  return wss;
}

export function broadcastToDisplays(payload) {
  const data = JSON.stringify(payload);
  for (const socket of displays) {
    if (socket.readyState === socket.OPEN) {
      try {
        socket.send(data);
      } catch {
        displays.delete(socket);
      }
    } else {
      displays.delete(socket);
    }
  }
}
