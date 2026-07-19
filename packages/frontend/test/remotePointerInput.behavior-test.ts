import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setupNativeRemoteCursor } from '../src/utils/nativeRemoteCursor';

const showCursorCallList: boolean[] = [];
const display = {
  oncursor: null as ((canvas: HTMLCanvasElement, x: number, y: number) => void) | null,
  showCursor: (shown: boolean) => showCursorCallList.push(shown),
};
const displayElement = { style: { cursor: '' } } as HTMLElement;
const canvas = {} as HTMLCanvasElement;
const nativeMouse = {
  setCursor: (_canvas: HTMLCanvasElement, _x: number, _y: number) => true,
};
const cleanupNativeCursor = setupNativeRemoteCursor(display, nativeMouse, displayElement);

assert.deepEqual(showCursorCallList, [false], 'the software cursor must be hidden before the first remote cursor arrives');
display.oncursor?.(canvas, 3, 4);
assert.deepEqual(showCursorCallList, [false, false], 'a supported native cursor must keep the software cursor hidden');
assert.equal(displayElement.style.cursor, '', 'native cursor styling must be owned by Guacamole.Mouse');

nativeMouse.setCursor = () => false;
display.oncursor?.(canvas, 0, 0);
assert.deepEqual(showCursorCallList, [false, false, true], 'unsupported native cursors must fall back to the software cursor');
assert.equal(displayElement.style.cursor, 'none', 'the host cursor must be hidden only while software fallback is active');

nativeMouse.setCursor = () => {
  throw new Error('cursor image rejected');
};
display.oncursor?.(canvas, 0, 0);
assert.equal(showCursorCallList.at(-1), true, 'cursor image failures must use the same software fallback');

cleanupNativeCursor();
cleanupNativeCursor();
assert.equal(display.oncursor, null, 'cursor callbacks must be detached during disconnect');
assert.equal(displayElement.style.cursor, 'default', 'disconnect must restore the host cursor');

for (const componentPath of [
  'src/components/RemoteDesktopSession.vue',
  'src/components/RemoteDesktopModal.vue',
  'src/components/VncModal.vue',
]) {
  const source = readFileSync(resolve(import.meta.dirname, '..', 'packages/frontend', componentPath), 'utf8');
  assert.doesNotMatch(source, /createRemotePointerScheduler/, `${componentPath} must not add a frame of pointer latency`);
  assert.match(
    source,
    /mouse\.value\.onmousemove\s*=\s*mouse\.value\.onmousedown\s*=\s*mouse\.value\.onmouseup\s*=\s*\(mouseState[^)]*\)\s*=>\s*\{\s*guacClient\.value\?\.sendMouseState\(mouseState\)/,
    `${componentPath} must forward every pointer state immediately`,
  );
  assert.match(source, /setupNativeRemoteCursor\(/, `${componentPath} must use the local hardware cursor path`);
  assert.doesNotMatch(source, /style\.cursor\s*=\s*'none'[\s\S]{0,500}new Guacamole\.Mouse/, `${componentPath} must not hide the local cursor unconditionally`);
}

console.log('remote pointer input behavior passed');
