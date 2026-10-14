import { backend, findGo, npmArguments, run } from "./runtime.mjs";

try {
  const go = findGo();
  await run(go, ["vet", "./..."], { cwd: backend });
  await run(go, ["test", "./..."], { cwd: backend });
  for (const script of ["lint", "typecheck", "test"]) {
    await run(process.execPath, npmArguments(["--prefix", "frontend", "run", script]));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
