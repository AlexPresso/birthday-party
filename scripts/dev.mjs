import { mkdir, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { backend, frontend, findGo, localEnvironment, run } from "./runtime.mjs";

const children = new Set();
let stopping = false;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (process.platform === "win32" && child.pid) {
      // Next starts workers; terminate the complete process tree on Windows.
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("error", () => child.kill());
    } else {
      child.kill("SIGTERM");
    }
  }
}

function start(command, args, options) {
  const child = spawn(command, args, {
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });
  children.add(child);
  child.on("error", (error) => {
    console.error(error.message);
    void stop(1);
  });
  child.on("exit", (code) => {
    children.delete(child);
    if (!stopping) void stop(code ?? 1);
  });
  return child;
}

process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());

try {
  const next = path.join(frontend, "node_modules", "next", "dist", "bin", "next");
  await access(next).catch(() => {
    throw new Error("Install frontend dependencies with npm --prefix frontend ci.");
  });
  const env = localEnvironment();
  const output = path.join(backend, ".cache", process.platform === "win32" ? "server.exe" : "server");
  await mkdir(path.dirname(output), { recursive: true });
  console.log("Building the Go server...");
  await run(findGo(), ["build", "-o", output, "./cmd/server"], { cwd: backend, env });
  if (!stopping) {
    start(output, ["serve"], { cwd: backend, env });
    start(process.execPath, [next, "dev", "--hostname", "127.0.0.1", "--port", env.PORT], {
      cwd: frontend,
      env,
    });
    console.log(`Application: ${env.PUBLIC_URL}\nCtrl+C stops both services. Restart after changing Go code.`);
  }
} catch (error) {
  console.error(error.message);
  await stop(1);
}
