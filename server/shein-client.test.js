import test from "node:test";
import assert from "node:assert/strict";
import { requestShein, SheinApiError } from "./shein-client.js";

test("sends SHEIN headers without exposing credentials in the response", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return new Response(
      JSON.stringify({
        code: "0",
        msg: "OK",
        info: { data: [] },
        traceId: "trace-1",
      }),
      { status: 200 },
    );
  };

  const result = await requestShein({
    baseUrl: "https://openapi.sheincorp.cn",
    path: "/open-api/goods/query-category-tree",
    body: {},
    openKeyId: "OPEN_KEY",
    secretKey: "SECRET_KEY",
    randomKey: "abc12",
    now: (() => {
      const values = [1752570817402, 1752570817411];
      return () => values.shift();
    })(),
    fetchImpl,
  });

  assert.equal(
    captured.url,
    "https://openapi.sheincorp.cn/open-api/goods/query-category-tree",
  );
  assert.equal(captured.options.headers["x-lt-openKeyId"], "OPEN_KEY");
  assert.equal(captured.options.headers["x-lt-timestamp"], "1752570817402");
  assert.match(captured.options.headers["x-lt-signature"], /^abc12/);
  assert.equal(captured.options.body, "{}");
  assert.deepEqual(result.diagnostics, {
    status: 200,
    code: "0",
    traceId: "trace-1",
    durationMs: 9,
  });
  assert.equal(JSON.stringify(result).includes("SECRET_KEY"), false);
});

test("preserves SHEIN code and traceId on business errors", async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        code: "openapi00002",
        msg: "IP is not in the whitelist",
        traceId: "trace-ip",
      }),
      { status: 200 },
    );

  await assert.rejects(
    requestShein({
      baseUrl: "https://openapi.sheincorp.cn",
      path: "/open-api/goods/query-category-tree",
      body: {},
      openKeyId: "OPEN_KEY",
      secretKey: "SECRET_KEY",
      randomKey: "abc12",
      fetchImpl,
    }),
    (error) => {
      assert.ok(error instanceof SheinApiError);
      assert.equal(error.code, "openapi00002");
      assert.equal(error.traceId, "trace-ip");
      return true;
    },
  );
});

test("includes query parameters in the signed SHEIN request path", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ code: "0", info: {}, traceId: "trace-query" }), {
      status: 200,
    });
  };
  await requestShein({
    baseUrl: "https://openapi.sheincorp.cn",
    method: "GET",
    path: "/open-api/goods/product/check-publish-permission",
    query: { brandCode: "2tgt1" },
    openKeyId: "OPEN_KEY",
    secretKey: "SECRET_KEY",
    randomKey: "abc12",
    fetchImpl,
  });
  assert.equal(
    captured.url,
    "https://openapi.sheincorp.cn/open-api/goods/product/check-publish-permission?brandCode=2tgt1",
  );
});
