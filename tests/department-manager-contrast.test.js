import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stylesUrl = new URL('../src/workflow/department-manager.css', import.meta.url);

test('department primary actions keep readable contrast across admin styles', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  const primaryRule = styles.match(/\.dep-manager \.dep-primary-button\s*\{([\s\S]*?)\}/)?.[1] || '';
  assert.match(primaryRule, /background-color:\s*#d8ff79!important/);
  assert.match(primaryRule, /border-color:\s*#d8ff79!important/);
  assert.doesNotMatch(primaryRule, /--dep-accent|--s-lime/);
  assert.match(styles, /\.dep-manager \.dep-primary-button\s*\{[\s\S]*?color:\s*#092017!important/);
  assert.match(styles, /\.dep-manager \.dep-primary-button:disabled\s*\{[\s\S]*?background-color:\s*#879b70!important/);
  assert.match(styles, /\.dep-manager \.dep-primary-button:disabled\s*\{[\s\S]*?opacity:\s*1/);
});
