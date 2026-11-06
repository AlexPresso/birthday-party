import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { WebSocket, WebSocketServer } = require("next/dist/compiled/ws");
const frontendRoot = fileURLToPath(new URL("../", import.meta.url));

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  await exited;
}

function ready(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(output)), 30000);
    const capture = (chunk) => {
      output += chunk.toString();
      if (output.includes("Ready in")) {
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error(output));
    });
  });
}

test(
  "one standalone build uses each runtime backend for HTTP, WebSocket, and SSR",
  { timeout: 120000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "birthday-runtime-smoke-"));
    try {
      await cp(join(frontendRoot, ".next/standalone"), directory, {
        recursive: true,
      });
      await cp(
        join(frontendRoot, "startup.mjs"),
        join(directory, "startup.mjs"),
      );
      await cp(join(frontendRoot, "runtime"), join(directory, "runtime"), {
        recursive: true,
      });
      const manifestPath = join(directory, ".next/routes-manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.rewrites.afterFiles.find(
        (route) => route.source === "/api/:path*",
      ).destination = "http://build-only.invalid:8080/api/:path*";
      await writeFile(manifestPath, JSON.stringify(manifest));

      for (const label of ["Runtime backend one", "Runtime backend two"]) {
        const configCookies = [];
        const backend = createServer(async (request, response) => {
          response.setHeader("Content-Type", "application/json");
          if (request.url === "/api/config") {
            configCookies.push(request.headers.cookie);
            response.end(
              JSON.stringify({
                age: 30,
                invitation: {
                  title: label,
                  description: null,
                  locales: Object.fromEntries(
                    ["en", "fr", "de", "it", "es"].map((locale) => [
                      locale,
                      { title: null, description: null },
                    ]),
                  ),
                },
              }),
            );
            return;
          }
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          response.end(
            JSON.stringify({
              url: request.url,
              method: request.method,
              cookie: request.headers.cookie,
              body: Buffer.concat(chunks).toString(),
            }),
          );
        });
        const sockets = new WebSocketServer({ server: backend });
        const upgrades = [];
        sockets.on("connection", (socket, request) => {
          upgrades.push({ url: request.url, cookie: request.headers.cookie });
          socket.on("message", (message) =>
            socket.send(`${label}: ${message}`),
          );
        });
        const backendPort = await listen(backend);
        const reservation = createServer();
        const frontendPort = await listen(reservation);
        await new Promise((resolve) => reservation.close(resolve));
        const child = spawn(process.execPath, ["startup.mjs"], {
          cwd: directory,
          env: {
            ...process.env,
            NODE_ENV: "production",
            NEXT_TELEMETRY_DISABLED: "1",
            API_INTERNAL_URL: `http://127.0.0.1:${backendPort}/`,
            HOSTNAME: "127.0.0.1",
            PORT: String(frontendPort),
          },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        try {
          await ready(child);
          const origin = `http://127.0.0.1:${frontendPort}`;
          const cookie = "session=runtime-smoke";
          const response = await fetch(
            `${origin}/api/runtime-check?value=hello%20world`,
            {
              method: "POST",
              headers: { Cookie: cookie, "Content-Type": "text/plain" },
              body: label,
              signal: AbortSignal.timeout(10000),
            },
          );
          assert.equal(response.status, 200);
          assert.deepEqual(await response.json(), {
            url: "/api/runtime-check?value=hello%20world",
            method: "POST",
            cookie,
            body: label,
          });

          const socket = new WebSocket(
            `ws://127.0.0.1:${frontendPort}/api/realtime`,
            { headers: { Cookie: cookie } },
          );
          await once(socket, "open", { signal: AbortSignal.timeout(10000) });
          const message = once(socket, "message", {
            signal: AbortSignal.timeout(10000),
          });
          socket.send("hello");
          assert.equal((await message)[0].toString(), `${label}: hello`);
          assert.deepEqual(upgrades, [{ url: "/api/realtime", cookie }]);
          socket.close();
          await once(socket, "close", { signal: AbortSignal.timeout(10000) });

          const page = await fetch(`${origin}/invitation`, {
            headers: { Cookie: cookie, "Accept-Language": "en" },
            signal: AbortSignal.timeout(10000),
          });
          assert.equal(page.status, 200);
          assert.ok((await page.text()).includes(`<title>${label}</title>`));
          assert.ok(configCookies.includes(cookie));
        } finally {
          await stop(child);
          for (const socket of sockets.clients) socket.terminate();
          await new Promise((resolve) => sockets.close(resolve));
          backend.closeAllConnections();
          await new Promise((resolve) => backend.close(resolve));
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
