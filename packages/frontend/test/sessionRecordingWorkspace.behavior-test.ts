import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const component = readFileSync(resolve('src/components/settings/SessionRecordingSettings.vue'), 'utf8');
const api = readFileSync(resolve('src/services/sessionRecording.api.ts'), 'utf8');

assert.match(api, /SessionRecordingListQuery/);
assert.match(api, /SessionRecordingListPage/);
assert.match(component, /filterQuery/);
assert.match(component, /filterStatus/);
assert.match(component, /currentPage/);
assert.match(component, /timelineOffset/);
assert.match(component, /seekTo/);
assert.match(component, /cachedEvents/);
assert.match(component, /ResizeObserver/);

console.log('session recording workspace behavior ok');
