import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const adminCssUrl = new URL("../src/admin/admin.css", import.meta.url);
const globalCssUrl = new URL("../src/global.css", import.meta.url);

test("dashboard grid keeps padded content inside the viewport", async () => {
  const [adminCss, globalCss] = await Promise.all([
    readFile(adminCssUrl, "utf8"),
    readFile(globalCssUrl, "utf8"),
  ]);

  assert.match(
    globalCss,
    /\*,\s*\*::before,\s*\*::after\s*\{\s*box-sizing:\s*border-box;/,
  );
  assert.match(globalCss, /body\s*\{\s*margin:\s*0;/);
  assert.match(
    adminCss,
    /\.a-admin\s*\{[^}]*grid-template-columns:\s*270px minmax\(0,\s*1fr\);[^}]*width:\s*100%;[^}]*max-width:\s*100%;/s,
  );
  assert.match(adminCss, /\.a-admin \.a-admin-main\s*\{[^}]*min-width:\s*0/s);
});
