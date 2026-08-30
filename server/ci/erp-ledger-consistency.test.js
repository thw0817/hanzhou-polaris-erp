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

test("execution ledger has one active step and points to its latest ERP run", async () => {
  const markdown = await fs.readFile(ledgerPath, "utf8");
  const steps = parseStepRows(markdown);
  const activeSteps = steps.filter((step) => step.status === "IN_PROGRESS");
  assert.equal(activeSteps.length, 1, "exactly one ERP step may be IN_PROGRESS");

  const currentMatch = markdown.match(
    /当前活动步骤：(?:ERP-\d{2}) \/ IN_PROGRESS \/ (RUN-[A-Z0-9-]+)/,
  );
  assert.ok(currentMatch, "ledger must declare the current active run");
  assert.equal(activeSteps[0].run, currentMatch[1]);

  const erpRunHeaders = [...markdown.matchAll(/^### (RUN-\d{8}-ERP\d{2}-[A-Z0-9-]+)$/gm)].map(
    (match) => match[1],
  );
  assert.ok(erpRunHeaders.length > 0, "ledger must contain at least one ERP Run record");
  assert.equal(currentMatch[1], erpRunHeaders.at(-1));
});
