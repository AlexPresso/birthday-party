import path from "node:path";
import { root, run } from "./runtime.mjs";
import { withTestDatabase } from "./test-database.mjs";

try {
  await withTestDatabase((env) => run(
    process.execPath,
    [path.join(root, "node_modules", "@playwright", "test", "cli.js"), "test", ...process.argv.slice(2)],
    { cwd: root, env },
  ));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
