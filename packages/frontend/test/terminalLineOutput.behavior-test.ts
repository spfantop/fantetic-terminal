import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  hasTerminalBufferWrappedLines,
  resolveTerminalSingleLineOutputCols,
  TERMINAL_SINGLE_LINE_MAX_COLS,
  TERMINAL_SINGLE_LINE_MIN_COLS,
} from '../src/utils/terminalLineOutput';

const createBuffer = (segments: Array<{ text: string; isWrapped?: boolean }>) => ({
  length: segments.length,
  getLine: (index: number) => {
    const segment = segments[index];
    if (!segment) return undefined;
    return {
      isWrapped: Boolean(segment.isWrapped),
      translateToString: () => segment.text,
    };
  },
});

assert.equal(TERMINAL_SINGLE_LINE_MIN_COLS, 256);
assert.equal(TERMINAL_SINGLE_LINE_MAX_COLS, 4096);

let unwrappedLineTranslations = 0;
const unwrappedBuffer = {
  length: 18,
  getLine: (index: number) => index < 18 ? {
    isWrapped: false,
    translateToString: () => {
      unwrappedLineTranslations += 1;
      return 'INFO ordinary log output';
    },
  } : undefined,
};
assert.equal(
  hasTerminalBufferWrappedLines(unwrappedBuffer, 0),
  false,
  'ordinary single-line output should bypass the expensive width resolver',
);
assert.equal(
  unwrappedLineTranslations,
  0,
  'the wrapped-line probe must inspect metadata without translating buffer text',
);
assert.equal(
  resolveTerminalSingleLineOutputCols({ buffer: createBuffer([]), currentCols: 120, visibleCols: 120 }),
  256,
  'empty terminals should avoid the old unconditional 4096-column resize',
);
assert.equal(
  resolveTerminalSingleLineOutputCols({
    buffer: createBuffer([
      { text: 'x'.repeat(120) },
      { text: 'x'.repeat(120), isWrapped: true },
      { text: 'x'.repeat(60), isWrapped: true },
    ]),
    currentCols: 120,
    visibleCols: 120,
  }),
  512,
  'existing wrapped lines should be reconstructed before choosing a width bucket',
);
assert.equal(
  resolveTerminalSingleLineOutputCols({
    buffer: createBuffer([
      { text: 'x'.repeat(120) },
      { text: 'x'.repeat(120), isWrapped: true },
      { text: 'x'.repeat(60), isWrapped: true },
    ]),
    currentCols: 120,
    visibleCols: 120,
    startRow: 2,
  }),
  512,
  'incremental inspection must rewind from a wrapped continuation to its logical-line start',
);
assert.equal(
  resolveTerminalSingleLineOutputCols({ buffer: createBuffer([]), currentCols: 120, visibleCols: 700 }),
  1024,
  'the width bucket must always contain the visible terminal columns',
);
assert.equal(
  resolveTerminalSingleLineOutputCols({
    buffer: createBuffer([{ text: 'x'.repeat(5000) }]),
    currentCols: 120,
    visibleCols: 120,
  }),
  4096,
  'pathological lines must remain capped at the established maximum',
);

let pathologicalBufferReads = 0;
const pathologicalWrappedBuffer = {
  length: 200,
  getLine: (index: number) => {
    pathologicalBufferReads += 1;
    if (index < 0 || index >= 200) return undefined;
    return { isWrapped: index > 0, translateToString: () => 'x'.repeat(256) };
  },
};
assert.equal(
  resolveTerminalSingleLineOutputCols({
    buffer: pathologicalWrappedBuffer,
    currentCols: 256,
    visibleCols: 120,
    startRow: 199,
  }),
  4096,
);
assert.ok(
  pathologicalBufferReads < 50,
  `incremental inspection must stop once the 4096-column cap is proven, received ${pathologicalBufferReads} reads`,
);

const terminalSource = readFileSync(resolve('src/components/Terminal.vue'), 'utf8');
assert.match(terminalSource, /resolveTerminalSingleLineOutputCols/);
assert.match(terminalSource, /hasTerminalBufferWrappedLines/);
assert.match(terminalSource, /terminal\.onWriteParsed\(scheduleSingleLineOutputGrowth\)/);
assert.doesNotMatch(
  terminalSource,
  /SINGLE_LINE_OUTPUT_COLS\s*=\s*4096/,
  'the terminal component must not restore the unconditional 4096-column resize',
);

console.log('terminal line output behavior ok');
