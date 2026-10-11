const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

function probeBackend(baseUrl, timeoutMs = 1000) {
  return new Promise(resolve => {
    let connected = false, settled = false;
    const done = status => { if (!settled) { settled = true; resolve(status); } };
    const request = http.get(`${baseUrl}/health`, { timeout: timeoutMs }, response => {
      let body = "";
      response.on("data", chunk => {
        body += chunk;
        if (body.length > 4096) { done("foreign"); request.destroy(); }
      });
      response.on("end", () => {
        try {
          const data = JSON.parse(body);
          done(response.statusCode === 200 && data.status === "ok" && data.service === "star-office-ui" ? "ready" : "foreign");
        } catch (_) { done("foreign"); }
      });
      response.on("error", () => done("foreign"));
    });
    request.on("socket", socket => socket.once("connect", () => { connected = true; }));
    request.on("timeout", () => { done(connected ? "foreign" : "unavailable"); request.destroy(); });
    request.on("error", () => done(connected ? "foreign" : "unavailable"));
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function stopChild(child) {
  if (child.exitCode != null || child.signalCode != null) return;
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 2000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.kill();
  });
}

async function spawnBackend(projectRoot, {
  env = process.env, platform = process.platform, spawnProcess = spawn,
  existsSync = fs.existsSync, logger = console,
  baseUrl = `http://${env.STAR_BACKEND_HOST || "127.0.0.1"}:${env.STAR_BACKEND_PORT || 19000}`,
  probe = probeBackend, timeoutMs = 20000, pollMs = 200,
} = {}) {
  const script = path.join(projectRoot, "backend", "app.py");
  if (!existsSync(script)) {
    logger.warn(`backend/app.py not found: ${script}`);
    return null;
  }
  const venv = platform === "win32"
    ? path.join(projectRoot, ".venv", "Scripts", "python.exe")
    : path.join(projectRoot, ".venv", "bin", "python");
  const candidates = [...new Set([
    env.STAR_BACKEND_PYTHON, venv,
    ...(platform === "win32" ? ["python", "python3"] : ["python3", "python"]),
  ].filter(Boolean))];
  for (const bin of candidates) {
    let child = null;
    try {
      let exited = false;
      child = await new Promise((resolve, reject) => {
        const process = spawnProcess(bin, [script], {
          cwd: projectRoot, stdio: "inherit", windowsHide: true, env,
        });
        // ENOENT is emitted asynchronously; try/catch around spawn alone misses it.
        process.once("error", reject);
        process.once("exit", () => { exited = true; });
        process.once("spawn", () => {
          process.removeListener("error", reject);
          process.on("error", error => logger.warn(`backend process error: ${error.message}`));
          resolve(process);
        });
      });
      const deadline = Date.now() + timeoutMs;
      while (!exited && Date.now() < deadline) {
        const status = await probe(baseUrl);
        if (exited) break;
        if (status === "ready") {
          logger.log(`backend ready with ${bin}`);
          return child;
        }
        if (status === "foreign") throw new Error(`${baseUrl} is occupied by another service`);
        await sleep(pollMs);
      }
      throw new Error(exited ? "Python exited before backend was ready" : "backend not ready within startup timeout");
    } catch (error) {
      if (child) await stopChild(child);
      logger.warn(`failed to spawn ${bin}: ${error.message}`);
    }
  }
  return null;
}

async function ensureBackend(projectRoot, options = {}) {
  const env = options.env || process.env;
  const baseUrl = options.baseUrl || `http://${env.STAR_BACKEND_HOST || "127.0.0.1"}:${env.STAR_BACKEND_PORT || 19000}`;
  const status = await (options.probe || probeBackend)(baseUrl);
  if (status === "ready") return null;
  if (status === "foreign") throw new Error(`${baseUrl} is occupied by another service; choose another STAR_BACKEND_PORT`);
  const child = await spawnBackend(projectRoot, { ...options, baseUrl });
  if (!child) throw new Error("Cannot start STAR OFFICE backend. Check Python and backend/requirements.txt.");
  return child;
}

module.exports = { spawnBackend, ensureBackend, probeBackend };
