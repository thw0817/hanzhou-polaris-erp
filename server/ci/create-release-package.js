import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditPolarisReleaseManifest,
  createPolarisReleaseManifest,
} from "./release-manifest.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(currentDirectory, "../..");

async function main() {
  if (process.env.POLARIS_CI_GATE !== "passed") {
    throw new Error("formal release package requires POLARIS_CI_GATE=passed");
  }
  const root = path.resolve(process.argv.find((value) => value.startsWith("--root="))?.slice(7) || defaultRoot);
  const channel = process.env.POLARIS_ARTIFACT_CHANNEL || "staging";
  const webRoot = path.join(root, "dist-v2");
  const manifest = await createPolarisReleaseManifest({ root, webRoot });
  const audit = await auditPolarisReleaseManifest({ root, webRoot, manifest, requireCleanSource: true });
  if (!audit.passed) throw new Error(`release manifest gate failed: ${audit.errors.join(",")}`);
  if (channel === "production" && manifest.publishCommandGate.canAcceptNewPublishCommand !== true) {
    throw new Error(`production release is not publishable: ${manifest.publishCommandGate.blockers.join(",")}`);
  }
  const revision = manifest.source.revision;
  const output = path.resolve(
    process.env.POLARIS_RELEASE_OUTPUT ||
      path.join(root, "artifacts", `polaris-${channel}-${revision}.tar.gz`),
  );
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "polaris-release-package-"));
  try {
    await fs.cp(webRoot, path.join(temporaryDirectory, "dist-v2"), { recursive: true });
    await fs.writeFile(
      path.join(temporaryDirectory, "release-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await fs.mkdir(path.dirname(output), { recursive: true });
    execFileSync("tar", ["-czf", output, "-C", temporaryDirectory, "dist-v2", "release-manifest.json"], {
      stdio: "inherit",
    });
    await fs.chmod(output, 0o444);
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
  process.stdout.write(`${JSON.stringify({ channel, output, releaseId: manifest.releaseId, manifest }, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
