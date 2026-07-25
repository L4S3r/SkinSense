import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const aiServiceDir = path.resolve(__dirname, "../../ai_service");

let pythonAiProcess = null;

export function ensureAiServiceRunning() {
  const pythonCmd = process.platform === "win32" ? "python" : "python3";
  console.log(`\n🐍 [Backend Spawner] Auto-starting Python AI Microservice...`);

  pythonAiProcess = spawn(pythonCmd, ["-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"], {
    cwd: aiServiceDir,
    stdio: "pipe",
    shell: true,
  });

  pythonAiProcess.stdout.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg) console.log(`   [Python AI] ${msg}`);
  });

  pythonAiProcess.stderr.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg) console.error(`   [Python AI] ${msg}`);
  });

  pythonAiProcess.on("error", (err) => {
    console.error("⚠️  [Backend Spawner] Failed to start Python AI Microservice:", err.message);
  });
}

export function cleanupAiService() {
  if (pythonAiProcess) {
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", pythonAiProcess.pid, "/f", "/t"]);
      } else {
        pythonAiProcess.kill("SIGINT");
      }
    } catch (_) { }
  }
}

process.on("SIGINT", () => {
  cleanupAiService();
  process.exit(0);
});

process.on("SIGTERM", () => {
  cleanupAiService();
  process.exit(0);
});
