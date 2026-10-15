import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { setTimeout } from "node:timers/promises";

const execute = promisify(execFile);
const docker = (args) => execute("docker", args, { windowsHide: true });

// Each command owns its database, including when multiple test runs overlap.
export async function withTestDatabase(callback) {
  const name = `birthday-party-test-${randomUUID()}`;
  const password = randomUUID().replaceAll("-", "");
  let created = false;
  const cleanup = async () => {
    if (!created) return;
    created = false;
    await docker(["rm", "--force", "--volumes", name]);
  };
  const interrupted = () => {
    void cleanup().finally(() => process.exit(130));
  };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  try {
    console.log("Starting an isolated PostgreSQL test database...");
    await docker([
      "run",
      "--detach",
      "--name",
      name,
      "--publish",
      "127.0.0.1::5432",
      "--env",
      "POSTGRES_USER=birthday_test",
      "--env",
      "POSTGRES_DB=birthday_test",
      "--env",
      `POSTGRES_PASSWORD=${password}`,
      "postgres:18-alpine",
    ]);
    created = true;
    const deadline = Date.now() + 60_000;
    while (true) {
      try {
        await docker([
          "exec",
          name,
          "pg_isready",
          "-h",
          "127.0.0.1",
          "-U",
          "birthday_test",
          "-d",
          "birthday_test",
        ]);
        break;
      } catch {
        if (Date.now() >= deadline)
          throw new Error("The PostgreSQL test database did not become ready.");
        await setTimeout(300);
      }
    }
    const { stdout } = await docker([
      "inspect",
      "--format",
      "{{json .NetworkSettings.Ports}}",
      name,
    ]);
    const port = JSON.parse(stdout)["5432/tcp"][0].HostPort;
    const url = `postgresql://birthday_test:${password}@127.0.0.1:${port}/birthday_test?sslmode=disable`;
    return await callback({
      ...process.env,
      DATABASE_URL: url,
      TEST_DATABASE_URL: url,
    });
  } finally {
    process.off("SIGINT", interrupted);
    process.off("SIGTERM", interrupted);
    await cleanup();
  }
}
