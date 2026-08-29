import assert from "node:assert/strict";
import test from "node:test";
import {
  localPublishReadbackDemo,
  runLocalPublishReadbackDemo,
} from "../../src-v2/lib/local-publish-readback-demo.js";

test("local readback demo uses unmistakably non-platform identifiers", () => {
  assert.equal(localPublishReadbackDemo.mode, "local-field-demo");
  assert.match(localPublishReadbackDemo.spuName, /^DEMO-/);
  assert.match(localPublishReadbackDemo.version, /^DEMO-/);
  assert.match(localPublishReadbackDemo.warning, /不会调用 SHEIN/);
});

test("local readback demo covers document state, relationships, and both report branches", () => {
  const result = runLocalPublishReadbackDemo({
    spuName: localPublishReadbackDemo.spuName,
    version: localPublishReadbackDemo.version,
  });

  assert.equal(result.documentState.summary.passedRecordCount, 1);
  assert.equal(result.readback.summary.skcCount, 2);
  assert.equal(result.readback.summary.skuCount, 3);
  assert.deepEqual(
    result.compliance.skcs.map((skc) => skc.report.reportType),
    ["1631", "1630"],
  );
  assert.ok(
    result.compliance.skcs.every(
      (skc) => skc.capabilities.gcc.writeStatus === "unsupported_by_official_api",
    ),
  );
  assert.equal(result.compliance.completionEligible, false);
  assert.equal(result.documentState.mode, "local-field-demo");
  assert.equal(result.readback.mode, "local-field-demo");
});

test("local readback demo rejects arbitrary identifiers", () => {
  assert.throws(
    () =>
      runLocalPublishReadbackDemo({
        spuName: "SPU-REAL",
        version: "VERSION-REAL",
      }),
    /只接受页面提供的 DEMO-SPU 和 DEMO-VERSION/,
  );
});
