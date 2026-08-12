import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  collectRuntimeImportGraph,
  listStronglyConnectedModules,
} from './support/runtime-import-graph';

const fixtureRoot = mkdtempSync(join(tmpdir(), 'fantetic-runtime-graph-'));
try {
  writeFileSync(join(fixtureRoot, 'a.ts'), "import { b } from './b'; export const a = b;\n");
  writeFileSync(join(fixtureRoot, 'b.ts'), "import { C } from './c'; export { type C } from './c'; export const b = 1; export type B = C;\n");
  writeFileSync(join(fixtureRoot, 'c.ts'), "import { a } from './a'; export const c = a; export type C = typeof a;\n");
  writeFileSync(join(fixtureRoot, 'widget.vue'), '<template><aside /></template>\n');
  writeFileSync(join(fixtureRoot, 'view.vue'), "<script setup lang=\"ts\">import Widget from './widget.vue'; import { C } from './c'; const lazy = () => import('./a'); type ViewModel = C;</script>\n<template><Widget /></template>\n");

  const graph = collectRuntimeImportGraph(fixtureRoot);
  assert.deepEqual(graph.get(join(fixtureRoot, 'b.ts')), []);
  assert.deepEqual(graph.get(join(fixtureRoot, 'view.vue')), [
    join(fixtureRoot, 'a.ts'),
    join(fixtureRoot, 'widget.vue'),
  ]);
  assert.deepEqual(listStronglyConnectedModules(graph), []);

  writeFileSync(join(fixtureRoot, 'b.ts'), "import { c } from './c'; export const b = c;\n");
  const cyclicGraph = collectRuntimeImportGraph(fixtureRoot);
  assert.deepEqual(
    listStronglyConnectedModules(cyclicGraph).map(group => group.map(file => file.split(/[\\/]/).at(-1)).sort()),
    [['a.ts', 'b.ts', 'c.ts']],
  );
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

const frontendGraph = collectRuntimeImportGraph(resolve(process.cwd(), 'src'));
const frontendCycleList = listStronglyConnectedModules(frontendGraph);
const authenticationModuleSuffixList = [
  '/authentication-runtime.ts',
  '/utils/apiClient.ts',
  '/stores/auth.store.ts',
  '/router/index.ts',
];

assert.equal(
  frontendCycleList.some(group => group.some(file => (
    authenticationModuleSuffixList.some(suffix => file.replaceAll('\\', '/').endsWith(suffix))
  ))),
  false,
  'authentication runtime modules must remain outside runtime import cycles',
);
assert.ok(
  frontendCycleList.every(group => group.length <= 2),
  'frontend runtime SCCs must not regress beyond the current two-module baseline',
);
