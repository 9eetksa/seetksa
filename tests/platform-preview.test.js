import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));

async function loadProvider(env) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['src/admin/platform.jsx'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    loader: { '.css': 'empty' },
    define: { 'import.meta.env': JSON.stringify(env) },
    plugins: [{
      name: 'isolated-auth-transport',
      setup(builder) {
        builder.onResolve({ filter: /\/supabase$/ }, () => ({ path: 'auth', namespace: 'test' }));
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
          contents: `export const supabase = ${env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY ? '{}' : 'null'};`,
        }));
      },
    }],
  });
  const module = { exports: {} };
  runInNewContext(result.outputFiles[0].text, {
    module, exports: module.exports, require, URL,
    window: {
      location: { pathname: '/', origin: 'http://localhost:5175' },
      sessionStorage: { getItem: () => null },
    },
    fetch: () => { throw new Error('Preview must not contact a backend'); },
  });
  return module.exports;
}

test('unconfigured local preview renders public content without granting permissions', async () => {
  const { PlatformProvider, usePlatform } = await loadProvider({ DEV: true });
  let platform;
  function Content() {
    platform = usePlatform();
    return React.createElement('h1', null, 'صيت');
  }
  const html = renderToStaticMarkup(React.createElement(PlatformProvider, null, React.createElement(Content)));
  assert.match(html, /<h1>صيت<\/h1>/);
  assert.doesNotMatch(html, /a-loading/);
  assert.equal(platform.user, null);
  assert.equal(platform.authReady, true);
  assert.equal(platform.can('content.edit'), false);
  assert.equal(platform.editor, false);
  assert.equal(platform.owner, false);
  assert.equal((await platform.refresh()).version, null);
  await assert.rejects(platform.save({}), /platform_settings_unavailable/);
});

for (const [name, env] of [
  ['production without backend', { DEV: false }],
  ['configured development backend', { DEV: true, VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' }],
  ['partially configured development backend', { DEV: true, VITE_SUPABASE_URL: 'https://example.supabase.co' }],
]) {
  test(`${name} still requires platform settings`, async () => {
    const { PlatformProvider } = await loadProvider(env);
    const html = renderToStaticMarkup(React.createElement(PlatformProvider, null, React.createElement('h1', null, 'private-content')));
    assert.match(html, /a-loading/);
    assert.doesNotMatch(html, /private-content/);
  });
}
