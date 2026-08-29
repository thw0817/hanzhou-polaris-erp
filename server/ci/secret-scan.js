import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(currentDirectory, "../..");

// These are immutable official API reference examples or cryptographic test
// vectors, not runtime configuration. They remain visible in the report so a
// reviewer cannot mistake the allowlist for proof that the values are secret-free.
const REFERENCE_ONLY_FILES = new Set([
  "docs/shein-api-raw/0aa9785d-c139-4af3-9032-c367a27a3ee8.txt",
  "docs/shein-api-raw/8b3a3b44-6581-4e39-8e55-1828e5e05125.txt",
  "server/credential-vault.test.js",
  "server/shein-crypto.test.js",
]);

const SECRET_PATTERNS = Object.freeze([
  { name: "private_key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "cloud_access_key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "github_token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/ },
  { name: "stripe_secret", pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/ },
  {
    name: "credential_assignment",
    pattern: /\b(?:api[_-]?key|access[_-]?key|secret[_-]?key|password|token)\s*[:=]\s*["'][^"']{32,}["']/i,
  },
]);

function trackedFiles(root) {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).split("\0").filter(Boolean);
}

export async function scanTrackedFiles(root = defaultRoot) {
  const findings = [];
  const referenceFindings = [];
  for (const relative of trackedFiles(root)) {
    if (relative === "server/ci/secret-scan.js") continue;
    const filename = path.join(root, relative);
    const contents = await fs.readFile(filename);
    if (contents.includes(0)) continue;
    const text = contents.toString("utf8");
    for (const item of SECRET_PATTERNS) {
      if (item.pattern.test(text)) {
        const finding = { file: relative, pattern: item.name };
        if (REFERENCE_ONLY_FILES.has(relative)) referenceFindings.push(finding);
        else findings.push(finding);
      }
    }
  }
  return {
    root,
    scannedFiles: trackedFiles(root).length,
    findings,
    referenceFindings,
    passed: findings.length === 0,
  };
}

async function main() {
  const root = path.resolve(process.argv.find((value) => value.startsWith("--root="))?.slice(7) || defaultRoot);
  const report = await scanTrackedFiles(root);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.passed ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
