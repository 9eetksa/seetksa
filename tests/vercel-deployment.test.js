import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Vercel builds from the checked in generated scene", async () => {
  const [configuration, packageJson, ignore] = await Promise.all([
    readFile(new URL("../vercel.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../.vercelignore", import.meta.url), "utf8"),
  ]);

  assert.equal(configuration.buildCommand, "npm run vercel-build");
  assert.equal(packageJson.scripts["vercel-build"], "vite build");
  assert.match(ignore, /^scripts\/$/m);
  assert.doesNotMatch(packageJson.scripts["vercel-build"], /scripts\//);
  assert.match(ignore, /^!supabase\/functions\/_shared\/\*\.js$/m);
});
