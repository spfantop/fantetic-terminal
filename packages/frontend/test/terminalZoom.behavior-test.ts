import assert from 'node:assert/strict';
import {
  calculateTerminalZoomPercent,
  clampTerminalFontSize,
  isTerminalZoomReset,
  resolveTerminalWheelZoomUpdate,
} from '../src/utils/terminalZoom';

assert.equal(
  calculateTerminalZoomPercent(18, 12),
  150,
  'terminal zoom percent should be relative to the original font size',
);

assert.equal(
  calculateTerminalZoomPercent(12, 12),
  100,
  'original font size should be shown as 100%',
);

assert.equal(
  clampTerminalFontSize(7, 8, 40),
  8,
  'terminal zoom should not go below the minimum font size',
);

assert.equal(
  clampTerminalFontSize(42, 8, 40),
  40,
  'terminal zoom should not exceed the maximum font size',
);

assert.equal(
  isTerminalZoomReset(12, 12),
  true,
  'reset button should be disabled when terminal zoom is already 100%',
);

assert.equal(
  isTerminalZoomReset(13, 12),
  false,
  'reset button should be enabled after zoom changes',
);

const wheelZoomUpdate = resolveTerminalWheelZoomUpdate(12, -100);

assert.equal(
  wheelZoomUpdate.fontSize,
  13,
  'ctrl wheel up should enlarge the current terminal font size',
);

assert.equal(
  wheelZoomUpdate.persistAppearanceSetting,
  false,
  'terminal zoom changes must stay local and not update the shared appearance font size',
);

console.log('terminal zoom behavior ok');
