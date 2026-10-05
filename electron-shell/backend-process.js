const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

async function spawnBackend(projectRoot, {
  env = process.env, platform = process.platform, spawnProcess = spawn,
  existsSync = fs.existsSync, logger = console,
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
    try {
      const child = await new Promise((resolve, reject) => {
        const process = spawnProcess(bin, [script], {
          cwd: projectRoot, stdio: "inherit", windowsHide: true, env,
        });
        // ENOENT is emitted asynchronously; try/catch around spawn alone misses it.
        process.once("error", reject);
        process.once("spawn", () => {
          process.removeListener("error", reject);
          process.on("error", error => logger.warn(`backend process error: ${error.message}`));
          resolve(process);
        });
      });
      logger.log(`backend started with ${bin}`);
      return child;
    } catch (error) {
      logger.warn(`failed to spawn ${bin}: ${error.message}`);
    }
  }
  return null;
}

module.exports = { spawnBackend };
