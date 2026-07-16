import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(process.cwd(), 'src/utils/serverIcons.ts'), 'utf8');
const loadPopularBody = source.match(/export const loadServerIconOptions = async \(\) => \{([\s\S]*?)\n\};/)?.[1] ?? '';
const readIconBody = source.match(/export const readServerIconOption = async \(([\s\S]*?)\n\};/)?.[1] ?? '';
const searchIconBody = source.match(/export const searchServerIconOptions = async \(([\s\S]*?)\n\};/)?.[1] ?? '';

assert.match(source, /import \{[\s\S]*mdiServerOutline[\s\S]*\} from '@mdi\/js';/);
assert.doesNotMatch(loadPopularBody, /loadAllIcon|import\('@mdi\/js'\)/);
assert.match(loadPopularBody, /serverIconOptions/);
assert.equal((source.match(/import\('@mdi\/js\?server-icon-catalog'\)/g) ?? []).length, 1);
assert.match(
  source,
  /const loadAllIconOptions[\s\S]*import\('@mdi\/js\?server-icon-catalog'\)[\s\S]*export const loadServerIconOptions/,
);
assert.match(source, /const staticIconPaths[\s\S]*mdiConnection,[\s\S]*mdiConsoleLine,[\s\S]*mdiServerOutline,/);
assert.match(readIconBody, /staticIconOptionMap\.get\(normalized\)[\s\S]*if \(staticOption\) return staticOption;[\s\S]*loadAllIconOptionMap\(\)/);
assert.match(readIconBody, /getServerIconOption\(undefined, type\)/);
assert.match(searchIconBody, /if \(!term\) return loadServerIconOptions\(\);[\s\S]*loadAllIconOptions\(\)/);
