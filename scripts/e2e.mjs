import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { frontend, root } from "./runtime.mjs";
import { withTestDatabase } from "./test-database.mjs";

// The specs share one party per server, so they run one at a time against it.
// To use more cores, Playwright's --shard splits the tests into groups,
// and each group gets its own database, Go server, Next dev server, media
// folder and ports. Each stack needs about two cores: up to four here, while
// CI gives each runner one shard (tests.yml). E2E_SHARDS overrides the count; a run limited to
// some specs uses one stack, since starting more would cost more than it saves.
const args = process.argv.slice(2);
const requested = Number.parseInt(process.env.E2E_SHARDS ?? "", 10);
const selectsSpecs = args.some((arg) => !arg.startsWith("-"));
const shards =
  requested > 0
    ? requested
    : selectsSpecs
      ? 1
      : Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));

function shardEnvironment(index, env) {
  if (shards === 1) return env;
  const name = `e2e-${index}`;
  // A tsconfig of its own keeps Next from adding this build directory's types
  // to the tracked tsconfig.json; .next/ is ignored by git.
  const tsconfig = path.posix.join(".next", `${name}.tsconfig.json`);
  mkdirSync(path.join(frontend, ".next"), { recursive: true });
  writeFileSync(
    path.join(frontend, tsconfig),
    JSON.stringify({ extends: "../tsconfig.json" }),
  );
  return {
    ...env,
    E2E_PORT: String(3300 + index),
    E2E_API_PORT: String(18080 + index),
    NEXT_DIST_DIR: path.posix.join(".next", name),
    NEXT_TSCONFIG_PATH: tsconfig,
    SERVER_BINARY_NAME: `server-${name}`,
    PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(root, "playwright-report", name),
    PLAYWRIGHT_HTML_OPEN: "never",
  };
}

// Runs Playwright and reports whether it passed. Several shards prefix their
// lines so the interleaved output stays readable.
function runShard(index, env) {
  const shardArgs =
    shards === 1
      ? args
      : [
          ...args,
          `--shard=${index}/${shards}`,
          `--output=${path.join("test-results", `shard-${index}`)}`,
        ];
  const child = spawn(
    process.execPath,
    [
      path.join(root, "node_modules", "@playwright", "test", "cli.js"),
      "test",
      ...shardArgs,
    ],
    {
      cwd: root,
      env: shardEnvironment(index, env),
      stdio: shards === 1 ? "inherit" : ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  if (shards > 1) {
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on("line", (line) =>
        console.log(`[${index}/${shards}] ${line}`),
      );
    }
  }
  return new Promise((resolve) => {
    child.on("error", (error) => {
      console.error(error.message);
      resolve(false);
    });
    child.on("exit", (code) => resolve(code === 0));
  });
}

try {
  if (shards > 1) {
    rmSync(path.join(root, "playwright-report"), {
      recursive: true,
      force: true,
    });
    console.log(`Running the browser tests in ${shards} parallel shards.`);
  }
  const results = await Promise.all(
    Array.from({ length: shards }, (_, offset) =>
      withTestDatabase((env) => runShard(offset + 1, env)),
    ),
  );
  const failed = results.flatMap((passed, offset) =>
    passed ? [] : [`${offset + 1}/${shards}`],
  );
  if (failed.length > 0) {
    throw new Error(`Browser tests failed in shard ${failed.join(", ")}.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
