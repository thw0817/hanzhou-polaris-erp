import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDisposableDatabaseUrl,
  assertRehearsalConfirmation,
  assertSuccessfulChecks,
} from "./rehearse-compliance-review-migration.js";

test("028 rehearsal accepts only explicitly disposable local databases", () => {
  for (const value of [
    "postgres://user:secret@127.0.0.1:5432/shein_console_rehearsal",
    "postgresql://user:secret@localhost:5432/shein-console-test",
    "postgres://user:secret@[::1]:5432/compliance_scratch",
  ]) {
    assert.doesNotThrow(() => assertDisposableDatabaseUrl(value));
  }

  for (const value of [
    "",
    "https://127.0.0.1/shein_console_rehearsal",
    "postgres://user:secret@db.example.com:5432/shein_console_rehearsal",
    "postgres://user:secret@127.0.0.1:5432/shein_console",
    "postgres://user:secret@localhost:5432/production",
  ]) {
    assert.throws(
      () => assertDisposableDatabaseUrl(value),
      /一次性本机 PostgreSQL/,
    );
  }
});

test("028 rehearsal requires an explicit destructive rehearsal confirmation", () => {
  assert.doesNotThrow(() => assertRehearsalConfirmation(
    "REHEARSE_028_ON_EMPTY_LOCAL_DATABASE",
  ));
  for (const value of ["", "yes", "REHEARSE_028"]) {
    assert.throws(
      () => assertRehearsalConfirmation(value),
      /REHEARSE_028_ON_EMPTY_LOCAL_DATABASE/,
    );
  }
});

test("028 rehearsal fails when a preflight or verification check is false", () => {
  assert.doesNotThrow(() => assertSuccessfulChecks(
    { rows: [{ check_name: "table:users", passed: true }] },
    "部署前检查",
  ));
  assert.throws(
    () => assertSuccessfulChecks(
      {
        rows: [
          { check_name: "table:users", passed: true },
          { check_name: "migration:028_pending", passed: false },
        ],
      },
      "部署前检查",
    ),
    /migration:028_pending/,
  );
  assert.throws(
    () => assertSuccessfulChecks({ rows: [] }, "迁移后验证"),
    /没有返回检查结果/,
  );
});
