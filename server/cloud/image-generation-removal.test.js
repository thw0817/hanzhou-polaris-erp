import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

test("image generation is removed from the active cloud and web runtime", async () => {
  const [control, demo, packageJson, compose, runtime, envExample, webApp, v2] =
    await Promise.all([
      read("server/cloud/control-server.js"),
      read("server/cloud/web-demo-server.js"),
      read("package.json"),
      read("deploy/docker-compose.cloud.yml"),
      read("server/cloud/runtime-database-capabilities.js"),
      read(".env.cloud.example"),
      read("src/WebApp.jsx"),
      read("src-v2/app/AppShell.tsx"),
    ]);

  for (const source of [control, demo]) {
    assert.doesNotMatch(source, /image-generation|ImageGeneration|image-provider|O1Key/);
  }
  assert.doesNotMatch(packageJson, /image-generation-worker|image-generation/);
  assert.doesNotMatch(compose, /image-generation-worker|SHEIN_IMAGE_GENERATION|O1KEY/);
  assert.doesNotMatch(runtime, /image-generation-worker-server\.js/);
  assert.doesNotMatch(envExample, /SHEIN_IMAGE_GENERATION|SHEIN_O1KEY|SHEIN_RUG_IMAGE_QUALITY/);
  assert.doesNotMatch(webApp, /图片与生图|生图工作台|批量生图|O1Key 生图接口/);
  assert.doesNotMatch(v2, /生图|image-generation|O1Key/);
});
