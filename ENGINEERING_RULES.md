# SHEIN Console Engineering Rules

This repository is an integration-heavy full-stack system: React/Vite UI, Node local proxy, SHEIN API adapter, V2 contract bridge, cloud services, caches, queues, and database projections. A change is complete only when its owning layer and its user-visible behavior are both verified.

## 1. Scope Every Change

Before editing, record:

```text
bug:
layer:
owner module:
allowed files:
regression test:
success criteria:
```

The default change budget is the smallest number of files that can reproduce and fix the bug. Unrelated cleanup is postponed.

## 2. Ownership Map

| Layer | Owner | Rule |
| --- | --- | --- |
| V2 UI | `src-v2/features/<feature>` | UI renders API state; it does not guess SHEIN state |
| V2 client | `src-v2/lib/api.ts` | Owns request/response types and stable client errors |
| Local V2 bridge | `server/v2-local-real-server.js` | Projects local legacy responses into V2; no domain mutation |
| Local routes | `server/index.js` | Routes and orchestrates local behavior |
| SHEIN transport | `server/shein-client.js` | Signs requests and preserves upstream diagnostics |
| Business sync | `server/store-data-sync.js` | Owns product, sales, inventory snapshots |
| Compliance | `server/shein-compliance.js` and compliance services | Owns compliance rows and sync semantics |
| Cloud | `server/cloud/*` | Owns cloud-only auth, workers, DB, and queues |

Local fixes must not change cloud behavior. UI fixes must not silently change server contracts. Shared-file changes require consumer tests.

## 3. Test Before Fix

Every bug gets a regression test first at the narrowest useful layer:

- pure transform or error mapping: unit test;
- local/V2 endpoint: route contract test;
- page interaction: browser regression test;
- SHEIN response variants: adapter fixture or network mock;
- cache/queue/database behavior: integration test with an isolated store.

Never use live SHEIN as the only test. Live SHEIN is an acceptance check, not a deterministic fixture.

## 4. Freeze Stable Areas

Passing features are frozen while another feature is repaired. A frozen feature may change only when:

1. the change is required by an explicit shared contract;
2. its existing tests are named in the change scope;
3. the full impacted test set passes.

Do not change authorization scope, write-enable flags, data semantics, deployment settings, or unrelated routes as part of a UI repair.

## 5. Error Truthfulness

Preserve SHEIN `code`, `msg`, and `traceId`. Classify only at the adapter boundary:

- `openapi00001`: signature/authorization failure, then reauthorization flow;
- IP whitelist rejection: configuration failure, show the rejected IP and whitelist action;
- rate limit: retry/queue, keep the store authorized;
- timeout/network: service unavailable, keep the store authorized;
- no rows/no products: honest empty state, never fake successful `0/0` work.

## 6. Verification Gates

Run the smallest relevant checks first, then:

```bash
node --test server/*.test.js
npm run build:v2                 # when V2 or shared API code changes
npm run release:audit:v2         # before a cloud release
```

For user-facing changes, open the local browser and verify the exact workflow, including loading, empty, success, failure, retry, and authorization states as applicable. A stopped local server is an environment failure and must be reported separately from an application failure.

## 7. Diff Review

Before declaring success, inspect the diff and confirm:

- only scoped modules changed;
- no credentials, tokens, signatures, or `.data` contents were added;
- no real SHEIN write endpoint was enabled;
- no cached data was silently converted into live data;
- tests describe the bug and protect the fix;
- the handoff is updated with the result and remaining external prerequisites.
