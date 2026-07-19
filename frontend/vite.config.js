import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_API_TARGET || env.VITE_API_BASE_URL || "http://localhost:3000";
  const wsTarget = target.replace(/^http/, "ws");

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: target,
          changeOrigin: true,
        },
        "/ws/display": {
          target: wsTarget,
          ws: true,
        },
      },
    },
  };
});

