import { spawn } from "node:child_process";

const proxyPort = process.env.SHEIN_PROXY_PORT || "8787";
const apiPort = process.env.SHEIN_V2_REAL_PORT || "8790";
const webPort = process.env.SHEIN_V2_REAL_WEB_PORT || "5174";
const baseEnv = {
  ...process.env,
  SHEIN_RUNTIME_MODE: "local",
  SHEIN_LOCAL_DIRECT_AUTH: "true",
  SHEIN_PROXY_PORT: proxyPort,
  SHEIN_REDIRECT_URL: `http://127.0.0.1:${webPort}/app/settings/stores`,
  SHEIN_DESKTOP_REDIRECT_URL:
    process.env.SHEIN_DESKTOP_REDIRECT_URL ||
    `http://127.0.0.1:${proxyPort}/api/shein/auth/callback`,
};

const children = [
  spawn(process.execPath, ["server/index.js"], {
    env: baseEnv,
    stdio: "inherit",
  }),
  spawn(process.execPath, ["server/v2-local-real-server.js"], {
    env: {
      ...baseEnv,
      SHEIN_V2_REAL_PORT: apiPort,
      SHEIN_LOCAL_PROXY_TARGET: `http://127.0.0.1:${proxyPort}`,
    },
    stdio: "inherit",
  }),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--mode", "v2", "--port", webPort],
    {
      env: {
        ...baseEnv,
        VITE_V2_API_TARGET: `http://127.0.0.1:${apiPort}`,
      },
      stdio: "inherit",
    },
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
    if (!stopping && code !== 0) process.exitCode = code ?? 1;
    if (!stopping && signal) process.exitCode = 1;
    stop();
  });
}
