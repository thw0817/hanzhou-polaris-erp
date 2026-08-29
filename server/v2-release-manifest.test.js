import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createV2ReleaseMetadataPlugin,
  resolveV2BuildIdentity,
} from "./v2-release-manifest.js";

test("V2 release metadata records a deterministic identity and every built asset", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "polaris-v2-manifest-"));
  const outDir = path.join(root, "dist-v2");
  await fs.mkdir(path.join(outDir, "assets"), { recursive: true });
  await fs.writeFile(path.join(outDir, "index.html"), "<meta name=polaris-ui content=v2>");
  await fs.writeFile(path.join(outDir, "assets/app.js"), "console.log('v2');");

  const identity = resolveV2BuildIdentity(root, {
    POLARIS_BUILD_ID: "build-fixed-001",
    POLARIS_SOURCE_REVISION: "revision-fixed-001",
    POLARIS_BUILD_TIME: "2026-08-29T00:00:00.000Z",
  });
  await createV2ReleaseMetadataPlugin({ root, identity }).closeBundle();

  const assets = JSON.parse(await fs.readFile(path.join(outDir, "asset-manifest.json"), "utf8"));
  const release = JSON.parse(await fs.readFile(path.join(outDir, "release-manifest.json"), "utf8"));
  assert.equal(release.buildId, "build-fixed-001");
  assert.equal(release.sourceRevision, "revision-fixed-001");
  assert.equal(release.ui.marker, "polaris-v2");
  assert.equal(release.ui.entry, "src-v2/main.tsx");
  assert.equal(release.artifact.outputDir, "dist-v2");
  assert.deepEqual(assets.assets.map((asset) => asset.path), ["assets/app.js", "index.html"]);
  for (const asset of assets.assets) {
    const contents = await fs.readFile(path.join(outDir, asset.path));
    assert.equal(asset.bytes, contents.byteLength);
    assert.equal(asset.sha256, crypto.createHash("sha256").update(contents).digest("hex"));
  }
  assert.equal(
    release.artifact.assetManifestSha256,
    crypto.createHash("sha256").update(await fs.readFile(path.join(outDir, "asset-manifest.json"))).digest("hex"),
  );
});
