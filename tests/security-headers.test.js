import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("production responses carry the baseline browser security headers", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const globalRule = config.headers.find(rule => rule.source === "/(.*)");
  const headers = Object.fromEntries(globalRule.headers.map(header => [header.key.toLowerCase(), header.value]));
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["referrer-policy"], "strict-origin-when-cross-origin");
  assert.match(headers["strict-transport-security"], /^max-age=/);
  assert.match(headers["permissions-policy"], /camera=\(\)/);
  assert.equal(headers["x-permitted-cross-domain-policies"], "none");

  const assets = config.headers.find(rule => rule.source === "/assets/:path*");
  assert.match(assets.headers.find(header => header.key === "Cache-Control").value, /immutable/);
});
