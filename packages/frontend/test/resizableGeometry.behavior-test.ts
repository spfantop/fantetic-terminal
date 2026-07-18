import assert from 'node:assert/strict';
import {
  isPointOnResizeEdge,
  resolveResizeGeometry,
} from '../src/utils/resizeGeometry';

const startRect = {
  left: 200,
  top: 100,
  width: 800,
  height: 600,
};

const rightResize = resolveResizeGeometry({
  edge: 'right',
  startRect,
  deltaX: 120,
  deltaY: 0,
  minWidth: 500,
  minHeight: 300,
  maxWidth: 1200,
  maxHeight: 900,
});
assert.deepEqual(rightResize, {
  left: 200,
  top: 100,
  width: 920,
  height: 600,
});

const leftResize = resolveResizeGeometry({
  edge: 'left',
  startRect,
  deltaX: 120,
  deltaY: 0,
  minWidth: 500,
  minHeight: 300,
  maxWidth: 1200,
  maxHeight: 900,
});
assert.deepEqual(leftResize, {
  left: 320,
  top: 100,
  width: 680,
  height: 600,
});
assert.equal(leftResize.left + leftResize.width, startRect.left + startRect.width);

const clampedLeftResize = resolveResizeGeometry({
  edge: 'left',
  startRect,
  deltaX: 600,
  deltaY: 0,
  minWidth: 500,
  minHeight: 300,
  maxWidth: 1200,
  maxHeight: 900,
});
assert.deepEqual(clampedLeftResize, {
  left: 500,
  top: 100,
  width: 500,
  height: 600,
});

const topLeftResize = resolveResizeGeometry({
  edge: 'top-left',
  startRect,
  deltaX: -100,
  deltaY: 50,
  minWidth: 500,
  minHeight: 300,
  maxWidth: 1200,
  maxHeight: 900,
});
assert.deepEqual(topLeftResize, {
  left: 100,
  top: 150,
  width: 900,
  height: 550,
});
assert.equal(topLeftResize.top + topLeftResize.height, startRect.top + startRect.height);

assert.equal(isPointOnResizeEdge(startRect, 997, 104, 8), true);
assert.equal(isPointOnResizeEdge(startRect, 600, 104, 8), true);
assert.equal(isPointOnResizeEdge(startRect, 600, 130, 8), false);

console.log('Resizable geometry behavior checks passed.');
