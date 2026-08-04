import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const toggle = readFileSync(resolve('src/composables/useThemeToggle.ts'), 'utf8');
const styles = readFileSync(resolve('src/style.css'), 'utf8');

assert.match(toggle, /ThemeTransitionDirection/);
assert.match(toggle, /pseudoElement: direction === 'reveal' \? '::view-transition-new\(root\)' : '::view-transition-old\(root\)'/);
assert.match(toggle, /direction === 'reveal' \? \[from, to\] : \[to, from\]/);
assert.match(toggle, /theme-radial-retract-active/);
assert.match(toggle, /nextThemeMode === 'dark' \? 'reveal' : 'retract'/);
assert.match(styles, /\.theme-radial-retract-active::view-transition-old\(root\)/);
assert.match(styles, /\.theme-radial-retract-active::view-transition-new\(root\)/);

console.log('theme toggle transition behavior ok');
