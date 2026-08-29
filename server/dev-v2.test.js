import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const source = readFileSync(new URL("./dev-v2.js", import.meta.url), "utf8");

test("local V2 launcher keeps the demo API and V2 web ports aligned", () => {
  assert.equal(packageJson.scripts["dev:v2:local"], "node server/dev-v2.js");
  assert.match(source, /SHEIN_WEB_DEMO_PORT: demoPort/);
  assert.match(source, /const demoPort = "8790"/);
  assert.match(source, /const webPort = "5174"/);
  assert.match(
    source,
    /node_modules\/vite\/bin\/vite\.js", "--mode", "v2", "--port", webPort/,
  );
});

test("local V2 launcher cleans both children on exit or signal", () => {
  assert.match(source, /process\.on\(signal, \(\) => stop\(signal\)\)/);
  assert.match(source, /child\.on\("error", \(\) => stop\(\)\)/);
  assert.match(source, /child\.on\("exit", \(code, signal\) =>/);
  assert.match(source, /if \(!child\.killed\) child\.kill\(signal\)/);
});
