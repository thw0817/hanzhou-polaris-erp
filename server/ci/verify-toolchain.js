import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(currentDirectory, "../..");

async function readJson(filename) {
  return JSON.parse(await fs.readFile(filename, "utf8"));
}

function versionFromNode() {
  return process.versions.node;
}

function readCommandVersion(command) {
  try {
    return execFileSync(command, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim().replace(/^v/, "");
  } catch {
    return "unknown";
  }
}

function sortedKeys(value) {
  return Object.keys(value || {}).sort();
}

export async function checkToolchain(root = defaultRoot, environment = process.env) {
  const packageJson = await readJson(path.join(root, "package.json"));
  const lockfile = await readJson(path.join(root, "package-lock.json"));
  const nvmrc = (await fs.readFile(path.join(root, ".nvmrc"), "utf8")).trim();
  const expectedNode = nvmrc;
  const expectedNpm = String(packageJson.packageManager || "").replace(/^npm@/, "");
  const actualNode = versionFromNode();
  const actualNpm = readCommandVersion("npm");
  const lockRoot = lockfile.packages?.[""] || {};
  const packageDependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.optionalDependencies,
  };
  const lockDependencies = {
    ...lockRoot.dependencies,
    ...lockRoot.devDependencies,
    ...lockRoot.optionalDependencies,
  };
  const checks = [
    {
      name: "node_version",
      passed: Boolean(expectedNode) && actualNode === expectedNode,
      expected: expectedNode,
      actual: actualNode,
    },
    {
      name: "npm_version",
      passed: Boolean(expectedNpm) && actualNpm === expectedNpm,
      expected: expectedNpm,
      actual: actualNpm,
    },
    {
      name: "package_manager_declared",
      passed: packageJson.packageManager === `npm@${expectedNpm}`,
      expected: `npm@${expectedNpm}`,
      actual: packageJson.packageManager || null,
    },
    {
      name: "engines_declared",
      passed:
        packageJson.engines?.node === expectedNode &&
        packageJson.engines?.npm === expectedNpm,
      expected: { node: expectedNode, npm: expectedNpm },
      actual: packageJson.engines || null,
    },
    {
      name: "lockfile_version",
      passed: lockfile.lockfileVersion === 3,
      expected: 3,
      actual: lockfile.lockfileVersion ?? null,
    },
    {
      name: "lockfile_root_dependencies",
      passed:
        JSON.stringify(sortedKeys(packageDependencies)) ===
        JSON.stringify(sortedKeys(lockDependencies)),
      expected: sortedKeys(packageDependencies),
      actual: sortedKeys(lockDependencies),
    },
    {
      name: "npm_config_user_agent",
      passed:
        !environment.npm_config_user_agent ||
        environment.npm_config_user_agent.includes(`npm/${expectedNpm}`),
      expected: `npm/${expectedNpm}`,
      actual: environment.npm_config_user_agent || null,
    },
  ];
  return {
    root,
    passed: checks.every((check) => check.passed),
    checks,
  };
}

async function main() {
  const root = path.resolve(process.argv.find((value) => value.startsWith("--root="))?.slice(7) || defaultRoot);
  const report = await checkToolchain(root);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.passed ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
