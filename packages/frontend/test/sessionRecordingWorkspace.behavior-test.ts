import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTerminalRecordingEventRenderer } from '../src/utils/terminalRecordingReplay';
import {
  calculateReplayViewportScale,
  fitTerminalReplayViewport,
} from '../src/utils/terminalReplayViewport';

const component = readFileSync(resolve('src/components/settings/SessionRecordingSettings.vue'), 'utf8');
const adminCenter = readFileSync(resolve('src/views/AdminCenterView.vue'), 'utf8');
const api = readFileSync(resolve('src/services/sessionRecording.api.ts'), 'utf8');
const dialogDrag = readFileSync(resolve('src/composables/useDraggableDialog.ts'), 'utf8');

assert.match(api, /SessionRecordingListQuery/);
assert.match(api, /SessionRecordingListPage/);
assert.match(component, /filterQuery/);
assert.match(component, /filterStatus/);
assert.match(component, /currentPage/);
assert.match(component, /timelineOffset/);
assert.match(component, /seekTo/);
assert.match(component, /cachedEvents/);
assert.match(component, /ResizeObserver/);
assert.match(api, /async delete\(/);
assert.match(api, /signal\?: AbortSignal/);
assert.match(component, /AbortController/);
assert.match(component, /nextEventCursor/);
assert.match(component, /MAX_CACHED_EVENTS\s*=\s*1000/);
assert.doesNotMatch(component, /while \(cursor !== null\)/);
assert.match(component, /recording-modal/);
assert.match(component, /deleteRecording/);
assert.match(component, /sessionRecording\.confirmDelete/);
assert.match(component, /timelineOffset\.value >= lastOffset/);
assert.match(component, /seekTo\(0\)/);
assert.match(component, /playbackDurationMs/);
assert.match(component, /cachedEvents\.value\[cachedEvents\.value\.length - 1\]\?\.offsetMs/);
assert.match(component, /:max="Math\.max\(1, playbackDurationMs\)"/);
assert.match(component, /class="recording-primary"/);
assert.match(component, /class="recording-owner"/);
assert.match(component, /class="recording-state"/);
assert.match(component, /recordedTerminalSize/);
assert.match(component, /syncTerminalViewport/);
assert.match(component, /primeTerminalForReplay/);
assert.match(component, /cachedEvents\.value\.find\(event => event\.type === 'resize'\)/);
assert.match(component, /fitTerminalReplayViewport/);
assert.match(component, /createTerminalRecordingEventRenderer/);
assert.match(component, /grid-template-rows:auto auto minmax\(0,1fr\) auto/);
assert.match(component, /\.recording-modal\{[^}]*overflow:auto/, 'the modal must scroll instead of clipping the timeline on short viewports');
assert.match(component, /height:min\(48rem,calc\(100dvh - 1\.5rem\)\)/, 'the player must use the available viewport while retaining the timeline');
assert.match(
  component,
  /display\.onresize\s*=\s*syncRemoteDesktopReplayDisplay/,
  'the replay display must be rescaled when recorded dimensions become available',
);
assert.match(
  component,
  /getComputedStyle\(host\)/,
  'the replay scale must use the host content box at every window size',
);
assert.match(component, /@media\(max-width:640px\)/);
assert.match(component, /useDraggableDialog/);
assert.match(component, /recording-drag-handle/);
assert.match(component, /box-sizing:border-box/);
assert.doesNotMatch(component, /\.recording-modal \.terminal-host\{min-height:12rem\}/);
assert.match(adminCenter, /useDeviceDetection/);
assert.match(adminCenter, /item\.key !== 'sessionRecordings' \|\| !isMobile\.value/);
assert.match(adminCenter, /activeSection === 'sessionRecordings' && !isMobile/);
assert.match(dialogDrag, /setPointerCapture/);
assert.match(dialogDrag, /maxLeft/);
assert.match(dialogDrag, /pointercancel/);

const encode = (value: string) => Buffer.from(value).toString('base64');
const writeList: string[] = [];
const resizeList: Array<[number, number]> = [];
const renderer = createTerminalRecordingEventRenderer({
  write: value => writeList.push(value),
  resize: (cols, rows) => resizeList.push([cols, rows]),
});

renderer.render({ offsetMs: 0, type: 'output', data: encode('user@host:~$ ') });
renderer.render({ offsetMs: 1, type: 'input', data: encode('ls') });
renderer.render({ offsetMs: 2, type: 'output', data: encode('ls\r\nfile.txt\r\n') });
assert.equal(writeList.join(''), 'user@host:~$ ls\r\nfile.txt\r\n', 'recorded shell commands must be visible without duplicating remote echo');

renderer.render({ offsetMs: 3, type: 'output', data: encode('user@host:~$ ') });
renderer.render({ offsetMs: 4, type: 'input', data: encode('uptime\r') });
assert.match(writeList.join(''), /uptime$/, 'pasted commands must remain visible while the Enter control byte stays hidden');

renderer.render({ offsetMs: 5, type: 'output', data: encode('Password: ') });
renderer.render({ offsetMs: 6, type: 'input', data: encode('secret') });
assert.doesNotMatch(writeList.join(''), /secret/, 'password input must never be exposed during replay');

renderer.reset();
renderer.render({ offsetMs: 7, type: 'output', data: encode('\r\nEnter API secret: ') });
renderer.render({ offsetMs: 8, type: 'input', data: encode('custom-token') });
assert.doesNotMatch(writeList.join(''), /custom-token/, 'only shell commands may be replayed; arbitrary interactive input must stay hidden');

renderer.render({ offsetMs: 9, type: 'resize', cols: 120, rows: 40 });
assert.deepEqual(resizeList, [[120, 40]]);
renderer.reset();

assert.equal(calculateReplayViewportScale(800, 600, 1000, 900), 2 / 3);
assert.equal(calculateReplayViewportScale(1200, 900, 800, 600), 1, 'terminal replay must not blur content by scaling above 100%');

const xtermStyle: Record<string, string> = {};
const xtermElement = { style: xtermStyle };
const screenElement = { offsetWidth: 1000, scrollWidth: 1000, offsetHeight: 900, scrollHeight: 900 };
const host = {
  clientWidth: 804,
  clientHeight: 604,
  querySelector: (selector: string) => selector === '.xterm' ? xtermElement : screenElement,
} as unknown as HTMLElement;
const originalGetComputedStyle = globalThis.getComputedStyle;
globalThis.getComputedStyle = (() => ({
  paddingLeft: '2px',
  paddingRight: '2px',
  paddingTop: '2px',
  paddingBottom: '2px',
})) as typeof getComputedStyle;
try {
  fitTerminalReplayViewport(host);
} finally {
  if (originalGetComputedStyle) globalThis.getComputedStyle = originalGetComputedStyle;
  else Reflect.deleteProperty(globalThis, 'getComputedStyle');
}
assert.equal(xtermStyle.width, '1000px');
assert.equal(xtermStyle.height, '900px');
assert.equal(xtermStyle.transform, 'translate(-50%, -50%) scale(0.6666666666666666)');
assert.equal(xtermStyle.left, '50%');
assert.equal(xtermStyle.top, '50%');

console.log('session recording workspace behavior ok');
