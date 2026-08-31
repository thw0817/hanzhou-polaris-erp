import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ledgerPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/COMMERCIAL_ERP_EXECUTION_LEDGER_2026-08-28.md",
);

function parseStepRows(markdown) {
  return markdown
    .split("\n")
    .filter((line) => /^\| ERP-\d{2} \|/.test(line))
    .map((line) => {
      const cells = line.split("|").map((cell) => cell.trim());
      return {
        id: cells[1],
        status: cells[3],
        run: cells[4],
      };
    });
}

test("execution ledger has at most one active step and accurately records a blocked gap", async () => {
  const markdown = await fs.readFile(ledgerPath, "utf8");
  const steps = parseStepRows(markdown);
  const activeSteps = steps.filter((step) => step.status === "IN_PROGRESS");
  assert.ok(activeSteps.length <= 1, "at most one ERP step may be IN_PROGRESS");

  const currentMatch = markdown.match(
    /当前活动步骤：(?:ERP-\d{2}) \/ IN_PROGRESS \/ (RUN-[A-Z0-9-]+)/,
  );
  if (activeSteps.length === 0) {
    assert.equal(currentMatch, null, "a blocked gap must not claim an active ERP run");
    assert.match(
      markdown,
      /当前活动步骤：无 \/ BLOCKED \/ .+/,
      "a blocked gap must record the concrete reason no ERP step is active",
    );
    return;
  }

  assert.ok(currentMatch, "ledger must declare the current active run");
  assert.equal(activeSteps[0].run, currentMatch[1]);

  const erpRunHeaders = [...markdown.matchAll(/^### (RUN-\d{8}-ERP\d{2}-[A-Z0-9-]+)$/gm)].map(
    (match) => match[1],
  );
  assert.ok(erpRunHeaders.length > 0, "ledger must contain at least one ERP Run record");
  assert.equal(currentMatch[1], erpRunHeaders.at(-1));
});
