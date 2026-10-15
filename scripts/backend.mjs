import { backend, findGo, localEnvironment, run } from "./runtime.mjs";

try {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    throw new Error(
      'Usage: npm run backend -- serve | migrate | invite-admin --name "First name"',
    );
  }
  await run(findGo(), ["run", "./cmd/server", ...args], {
    cwd: backend,
    env: localEnvironment(),
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
