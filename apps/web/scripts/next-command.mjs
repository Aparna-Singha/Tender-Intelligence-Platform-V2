import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const command = process.argv[2];
if (command !== "dev" && command !== "start") {
  process.stderr.write("Expected the Next.js command 'dev' or 'start'.\n");
  process.exitCode = 1;
} else {
  const port = process.env.WEB_PORT ?? "3000";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65_535) {
    process.stderr.write("WEB_PORT must be an integer between 1 and 65535.\n");
    process.exitCode = 1;
  } else {
    const nextCli = fileURLToPath(
      new URL("../node_modules/next/dist/bin/next", import.meta.url),
    );
    const child = spawn(
      process.execPath,
      [nextCli, command, "--hostname", "0.0.0.0", "--port", port],
      { stdio: "inherit" },
    );
    child.on("exit", (code, signal) => {
      if (signal !== null) process.kill(process.pid, signal);
      else process.exitCode = code ?? 1;
    });
    child.on("error", (error) => {
      process.stderr.write(`Next.js failed to start (${error.name}).\n`);
      process.exitCode = 1;
    });
  }
}
