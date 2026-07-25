// Helper function to build API endpoint for any IP address or domain URL
export function getApiEndpoint(path = "") {
  let base = (import.meta.env.VITE_API_BASE_URL || "").trim();
  if (!base) return path;

  if (!/^https?:\/\//i.test(base)) {
    const isSecure = base.includes("ngrok") || base.includes("loca.lt") || base.endsWith(".trycloudflare.com");
    base = (isSecure ? "https://" : "http://") + base;
  }
  
  base = base.replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

// Helper function to build WebSocket URL for booth display mode
export function getWebSocketUrl(path = "/ws/display") {
  let base = (import.meta.env.VITE_API_BASE_URL || "").trim();
  if (base) {
    if (!/^https?:\/\//i.test(base)) {
      const isSecure = base.includes("ngrok") || base.includes("loca.lt") || base.endsWith(".trycloudflare.com");
      base = (isSecure ? "https://" : "http://") + base;
    }
    try {
      const url = new URL(base);
      const wsProto = url.protocol === "https:" ? "wss:" : "ws:";
      return `${wsProto}//${url.host}${path}`;
    } catch {
      // fallback
    }
  }

  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}${path}`;
}
