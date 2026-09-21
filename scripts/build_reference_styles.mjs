import {readFile,writeFile,copyFile} from 'node:fs/promises';

// Retain original scene layout while loading only the supplied identity fonts
const source = await readFile(new URL('../assets/reference-source/main.original.css', import.meta.url), 'utf8');
const css = source.replace(/@font-face\{[^}]*\}/g, '')
  .replace(/font-family:[^;}]+/g, 'font-family:var(--brand-font-arabic)')
  .replace(/#1a6e48\b/gi, '#101011')
  .replace(/#7be88a\b/gi, '#c8c3c3')
  .replace(/forced-color-adjust:none/g, 'forced-color-adjust:auto');
await writeFile(new URL('../public/scenes/reference/scene.css',import.meta.url), css);
await copyFile(new URL('../src/brand-fonts.css',import.meta.url),new URL('../public/scenes/reference/brand-fonts.css',import.meta.url));
await copyFile(new URL('../public/brand/seet-logo-light.svg',import.meta.url),new URL('../public/scenes/reference/assets/brand/nav_logo_white.svg',import.meta.url));
await copyFile(new URL('../public/brand/seet-logo-dark.svg',import.meta.url),new URL('../public/scenes/reference/assets/brand/nav_logo.svg',import.meta.url));
console.log('Scene layout and packaged brand fonts prepared');
