import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const brand = "SHEIN超级运营中心";
const oldBrand = /SHEIN\s*涵舟工作室/;

const v2BrandingSources = [
  "index.html",
  "src-v2/app/AppShell.tsx",
  "src-v2/features/auth/LoginPage.tsx",
  "src-v2/features/auth/RegisterPage.tsx",
  "src-v2/features/auth/ForgotPasswordPage.tsx",
  "src-v2/features/auth/ResetPasswordPage.tsx",
  "src-v2/features/auth/InvitePage.tsx",
  "server/cloud/web-email.js",
];

test("V2 user-facing branding uses the current site name", () => {
  for (const path of v2BrandingSources) {
    const source = read(path);
    assert.match(source, new RegExp(brand), `${path} should contain the current site name`);
    assert.doesNotMatch(source, oldBrand, `${path} should not contain the previous site name`);
  }
});

test("V2 build keeps the current site title as its HTML fallback", () => {
  const viteConfig = read("vite.config.js");
  assert.match(viteConfig, /replace\("SHEIN涵舟工作室", "SHEIN超级运营中心"\)/);
  assert.match(viteConfig, /const isBuild = command === "build"/);
  assert.match(viteConfig, /createV2ReleaseMetadataPlugin/);
  assert.match(read("index.html"), /<title>SHEIN超级运营中心<\/title>/);
  assert.match(read("index.html"), /name="polaris-ui" content="v2"/);
});

test("the default preview serves the current web build", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(packageJson.scripts.build, "npm run build:v2");
  assert.equal(packageJson.scripts["build:web"], "npm run build:v2");
  assert.equal(packageJson.scripts.preview, "vite preview --outDir dist-v2");
  assert.equal(packageJson.scripts["preview:v2"], "vite preview --outDir dist-v2");
});
