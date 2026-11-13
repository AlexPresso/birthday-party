import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { loadEnvFile } from "node:process";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const backend = path.join(root, "backend");
export const frontend = path.join(root, "frontend");

const environmentFile = path.join(root, ".env");
if (existsSync(environmentFile)) loadEnvFile(environmentFile);

export function findGo() {
  if (process.env.GO_BIN) return process.env.GO_BIN;
  const command = spawnSync("go", ["version"], { windowsHide: true });
  if (!command.error && command.status === 0) return "go";

  // Also recognize an isolated toolchain installed by the development assistant.
  const localTools = path.join(homedir(), ".codex", "tools");
  if (existsSync(localTools)) {
    const directories = readdirSync(localTools)
      .filter((name) => /^go-\d/.test(name))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const directory of directories) {
      const candidate = path.join(
        localTools,
        directory,
        "go",
        "bin",
        process.platform === "win32" ? "go.exe" : "go",
      );
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error(
    "Go was not found: install Go 1.27.2+ or set GO_BIN to its executable path.",
  );
}

export function localEnvironment() {
  const port = process.env.PORT || "3000";
  const database = new URL("postgresql://127.0.0.1");
  database.port = process.env.POSTGRES_PORT || "5432";
  database.username = process.env.POSTGRES_USER || "birthday";
  database.password = process.env.POSTGRES_PASSWORD || "birthday-local-only";
  database.pathname = `/${process.env.POSTGRES_DB || "birthday"}`;
  database.searchParams.set("sslmode", "disable");
  return {
    ...process.env,
    PORT: port,
    LISTEN_ADDR: process.env.LISTEN_ADDR || "127.0.0.1:8080",
    API_INTERNAL_URL: process.env.API_INTERNAL_URL || "http://127.0.0.1:8080",
    PUBLIC_URL: process.env.PUBLIC_URL || `http://localhost:${port}`,
    DATA_DIR: path.resolve(backend, process.env.DATA_DIR || "data"),
    DATABASE_URL: process.env.DATABASE_URL || database.toString(),
  };
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      windowsHide: true,
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`${path.basename(command)} failed (${signal || code}).`),
        );
    });
  });
}

export function npmArguments(args) {
  const executable = process.env.npm_execpath;
  if (!executable) throw new Error("Run this command with npm run.");
  return [executable, ...args];
}
