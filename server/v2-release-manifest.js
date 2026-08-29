import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const RELEASE_MANIFEST = "release-manifest.json";
const ASSET_MANIFEST = "asset-manifest.json";

function gitValue(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export function resolveV2BuildIdentity(root, environment = process.env) {
  const sourceRevision = String(
    environment.POLARIS_SOURCE_REVISION || gitValue(root, ["rev-parse", "HEAD"]) || "unknown",
  ).trim() || "unknown";
  const buildId = String(environment.POLARIS_BUILD_ID || sourceRevision).trim() || "unknown";
  const buildTime = String(
    environment.POLARIS_BUILD_TIME ||
      gitValue(root, ["show", "-s", "--format=%cI", "HEAD"]) ||
      new Date().toISOString(),
  ).trim();
  const sourceDirty = Boolean(
    gitValue(root, ["status", "--porcelain", "--untracked-files=all"]),
  );

  return Object.freeze({
    buildId,
    sourceRevision,
    buildTime,
    sourceDirty,
  });
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

async function listFiles(directory, prefix = "") {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? path.join(prefix, entry.name) : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolute, relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function createAssetManifest(outDir, identity) {
  const files = (await listFiles(outDir)).filter(
    (filename) => filename !== RELEASE_MANIFEST && filename !== ASSET_MANIFEST,
  );
  const assets = [];
  for (const filename of files) {
    const contents = await fs.readFile(path.join(outDir, filename));
    assets.push({
      path: toPosix(filename),
      bytes: contents.byteLength,
      sha256: sha256(contents),
    });
  }
  return {
    schemaVersion: 1,
    artifactKind: "hanzhou-polaris-v2-frontend",
    buildId: identity.buildId,
    sourceRevision: identity.sourceRevision,
    assets,
  };
}

export function createV2ReleaseMetadataPlugin({
  root = process.cwd(),
  outDir = "dist-v2",
  identity = resolveV2BuildIdentity(root),
} = {}) {
  const absoluteOutDir = path.resolve(root, outDir);
  return {
    name: "polaris-v2-release-metadata",
    apply: "build",
    async closeBundle() {
      const assetManifest = await createAssetManifest(absoluteOutDir, identity);
      const assetManifestText = `${JSON.stringify(assetManifest, null, 2)}\n`;
      await fs.writeFile(
        path.join(absoluteOutDir, ASSET_MANIFEST),
        assetManifestText,
        "utf8",
      );
      const releaseManifest = {
        schemaVersion: 1,
        artifactKind: "hanzhou-polaris-v2-frontend",
        buildId: identity.buildId,
        sourceRevision: identity.sourceRevision,
        buildTime: identity.buildTime,
        sourceDirty: identity.sourceDirty,
        ui: {
          mode: "v2",
          marker: "polaris-v2",
          entry: "src-v2/main.tsx",
          title: "SHEIN超级运营中心",
        },
        artifact: {
          outputDir: "dist-v2",
          index: "index.html",
          assetManifest: ASSET_MANIFEST,
          assetManifestSha256: sha256(assetManifestText),
        },
      };
      await fs.writeFile(
        path.join(absoluteOutDir, RELEASE_MANIFEST),
        `${JSON.stringify(releaseManifest, null, 2)}\n`,
        "utf8",
      );
    },
  };
}

export function escapeHtmlAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
