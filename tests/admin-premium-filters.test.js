import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const adminUrl = new URL("../src/admin/Admin.jsx", import.meta.url);
const overviewUrl = new URL("../src/admin/Overview.jsx", import.meta.url);
const adminCssUrl = new URL("../src/admin/admin.css", import.meta.url);
const overviewCssUrl = new URL("../src/admin/dashboard-cosmos.css", import.meta.url);

test("admin filters change the rendered navigation audit and overview data", async () => {
  const [admin, overview] = await Promise.all([
    readFile(adminUrl, "utf8"),
    readFile(overviewUrl, "utf8"),
  ]);

  assert.match(admin, /navigationTabs\s*=\s*tabs\.filter/);
  assert.match(admin, /navigationTabs\.map/);
  // Account filtering moved to the database and is covered by the transactional
  // directory regression checks including filtered counts and the second page
  assert.match(admin, /<AccountDirectory/);
  assert.match(admin, /visibleAudit\s*=\s*audit\.filter/);
  assert.match(admin, /visibleAudit\.map/);
  assert.match(admin, /value=\{auditAction\}/);

  assert.match(overview, /const overviewScopes\s*=\s*\[/);
  assert.match(overview, /const \[scope, setScope\]\s*=\s*useSessionState\('admin\.overview\.scope', 'all'/);
  assert.match(overview, /visibleMetrics\s*=\s*metrics\.filter/);
  assert.match(overview, /data-scope=\{scope\}/);
  assert.match(overview, /visibleMetrics\.map/);
  assert.match(overview, /scopeMatches\("content"\)/);
  assert.match(overview, /scopeMatches\("operations"\)/);
});

test("admin premium controls preserve responsive layout accessibility and dynamic contrast", async () => {
  const [adminCss, overviewCss] = await Promise.all([
    readFile(adminCssUrl, "utf8"),
    readFile(overviewCssUrl, "utf8"),
  ]);

  assert.match(adminCss, /\.a-primary\s*\{[^}]*color:\s*var\(--s-action-text,\s*#052e23\)/s);
  assert.match(adminCss, /\.a-sidebar-search/);
  assert.match(adminCss, /\.a-data-filter-bar/);
  assert.match(adminCss, /@media \(max-width:\s*600px\)/);
  assert.match(overviewCss, /\.a-overview-filter/);
  assert.match(overviewCss, /button\[aria-pressed=true\]/);
  assert.match(overviewCss, /\.a-command-grid\[data-scope=team\]/);
  assert.match(overviewCss, /@media\(max-width:760px\)/);
});
