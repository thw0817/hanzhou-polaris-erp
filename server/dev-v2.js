import { spawn } from "node:child_process";

const demoPort = "8790";
const webPort = "5174";
const children = [
  spawn(process.execPath, ["server/cloud/web-demo-server.js"], {
    env: { ...process.env, SHEIN_WEB_DEMO_PORT: demoPort },
    stdio: "inherit",
  }),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--mode", "v2", "--port", webPort],
    { stdio: "inherit" },
  ),
];

let stopping = false;

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(signal));
}

for (const child of children) {
  child.on("error", () => stop());
  child.on("exit", (code, signal) => {
    if (!stopping && code !== 0) {
      process.exitCode = code ?? 1;
    }
    if (!stopping && signal) {
      process.exitCode = 1;
    }
    stop();
  });
}
