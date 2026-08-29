import test from "node:test";
import assert from "node:assert/strict";
import {
  compileComplianceWriteRequests,
  ComplianceWriteExecutor,
  createWriteConfirmationToken,
} from "./compliance-write-executor.js";

test("compiles only verified certificate, agency, and warning requests", () => {
  const result = compileComplianceWriteRequests({
    plans: [
      {
        skc: "rug-1",
        status: "ready",
        actions: [
          {
            type: "certificate.bind_existing",
            requirementKey: "CERT",
            poolSn: "POOL-1",
            certificateTypeCode: "CERT",
          },
          {
            type: "agency.bind",
            requirementKey: "Manufacturer",
            agencyId: 10,
            agencyType: 0,
          },
          {
            type: "warning.update",
            requirementKey: "WARN",
            certificateTypeCode: "WARN",
            rules: {
              presetInfo: {
                presetFields: [
                  {
                    fieldCode: "ATTR",
                    fieldSort: 0,
                    isEnabled: 1,
                    presetFieldValues: [
                      { fieldValueId: 1, isEnabled: 1 },
                    ],
                  },
                  {
                    fieldCode: "WARNING",
                    fieldSort: 1,
                    isEnabled: 1,
                    presetFieldValues: [
                      {
                        fieldValueId: 2,
                        isEnabled: 1,
                        mappingPaths: [{ fieldValueIds: [1] }],
                      },
                    ],
                  },
                ],
              },
            },
            selectedByField: { ATTR: [1] },
          },
        ],
      },
    ],
  });

  assert.equal(result.executable, true);
  assert.equal(result.requests.length, 3);
  assert.equal(result.blockers.length, 0);
});

test("fails closed for certificate creation and photos without SHEIN upload receipts", () => {
  const result = compileComplianceWriteRequests({
    plans: [
      {
        skc: "rug-2",
        status: "ready",
        actions: [
          { type: "certificate.create_and_bind", requirementKey: "CERT" },
          { type: "photo.upload_and_bind", requirementKey: "88:1" },
        ],
      },
    ],
  });
  assert.equal(result.executable, false);
  assert.deepEqual(
    result.blockers.map((item) => item.code),
    [
      "CERTIFICATE_CREATE_EXECUTION_NOT_READY",
      "PHOTO_UPLOAD_RECEIPT_REQUIRED",
    ],
  );
});

test("does not call upstream when execute is false or writes are disabled", async () => {
  let calls = 0;
  const executor = new ComplianceWriteExecutor({
    enabled: false,
    request: async () => {
      calls += 1;
      return {};
    },
  });
  const plans = [
    {
      skc: "rug-3",
      status: "ready",
      actions: [
        {
          type: "certificate.bind_existing",
          requirementKey: "CERT",
          poolSn: "POOL-3",
        },
      ],
    },
  ];
  const dryRun = await executor.execute({ plans, execute: false });
  assert.equal(dryRun.executed, false);
  assert.equal(calls, 0);
  const blocked = await executor.execute({ plans, execute: true });
  assert.equal(blocked.executed, false);
  assert.equal(blocked.blockers.at(-1).code, "WRITE_DISABLED");
  assert.equal(calls, 0);
});

test("requires confirmation and post-write readback when enabled", async () => {
  const plans = [
    {
      skc: "rug-4",
      status: "ready",
      actions: [
        {
          type: "certificate.bind_existing",
          requirementKey: "CERT",
          poolSn: "POOL-4",
        },
      ],
    },
  ];
  let calls = 0;
  let verified = 0;
  const executor = new ComplianceWriteExecutor({
    enabled: true,
    confirmationSecret: "unit-test-secret",
    request: async () => {
      calls += 1;
      return { payload: { code: "0" }, diagnostics: { traceId: "trace-1" } };
    },
    verify: async () => {
      verified += 1;
      return { status: "waiting_review" };
    },
  });
  const expectedToken = createWriteConfirmationToken({
    plan: plans,
    secret: "unit-test-secret",
  });
  const result = await executor.execute({
    plans,
    execute: true,
    confirmationToken: expectedToken,
  });
  assert.equal(result.executed, true);
  assert.equal(result.mode, "executed");
  assert.equal(calls, 1);
  assert.equal(verified, 1);
});

test("stops on business-level partial failure even when top-level code is zero", async () => {
  const plans = [
    {
      skc: "rug-5",
      status: "ready",
      actions: [
        {
          type: "warning.update",
          requirementKey: "WARN",
          certificateTypeCode: "WARN",
          rules: {
            presetInfo: {
              presetFields: [
                {
                  fieldCode: "ATTR",
                  fieldSort: 0,
                  isEnabled: 1,
                  presetFieldValues: [
                    { fieldValueId: 1, isEnabled: 1 },
                  ],
                },
                {
                  fieldCode: "WARNING",
                  fieldSort: 1,
                  isEnabled: 1,
                  presetFieldValues: [
                    {
                      fieldValueId: 2,
                      isEnabled: 1,
                      mappingPaths: [{ fieldValueIds: [1] }],
                    },
                  ],
                },
              ],
            },
          },
          selectedByField: { ATTR: [1] },
        },
      ],
    },
  ];
  let verified = 0;
  const executor = new ComplianceWriteExecutor({
    enabled: true,
    confirmationSecret: "unit-test-secret",
    request: async () => ({
      payload: {
        code: "0",
        info: {
          successList: [],
          failedList: [
            { skcName: "rug-5", code: "INVALID", reason: "invalid" },
          ],
        },
      },
      diagnostics: { traceId: "trace-partial" },
    }),
    verify: async () => {
      verified += 1;
      return {};
    },
  });
  const result = await executor.execute({
    plans,
    execute: true,
    confirmationToken: createWriteConfirmationToken({
      plan: plans,
      secret: "unit-test-secret",
    }),
  });
  assert.equal(result.executed, false);
  assert.equal(result.mode, "failed");
  assert.equal(
    result.blockers.at(-1).code,
    "SHEIN_WRITE_PARTIAL_FAILURE",
  );
  assert.equal(result.blockers.at(-1).traceId, "trace-partial");
  assert.equal(verified, 0);
});
