import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkToolchain } from "./verify-toolchain.js";

test("toolchain gate validates exact Node/npm declarations and lock root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "polaris-toolchain-"));
  const nodeVersion = process.versions.node;
  const npmVersion = "11.13.0";
  const dependency = { "fixture-package": "1.0.0" };
  await fs.writeFile(path.join(root, ".nvmrc"), `${nodeVersion}\n`);
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    packageManager: `npm@${npmVersion}`,
    engines: { node: nodeVersion, npm: npmVersion },
    dependencies: dependency,
  }));
  await fs.writeFile(path.join(root, "package-lock.json"), JSON.stringify({
    name: "fixture",
    lockfileVersion: 3,
    packages: { "": { dependencies: dependency } },
  }));
  const report = await checkToolchain(root, {
    npm_config_user_agent: `npm/${npmVersion} node/${nodeVersion}`,
  });
  assert.equal(report.passed, true);
});
