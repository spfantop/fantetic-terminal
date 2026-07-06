import assert from 'node:assert/strict';
import { appendSelectedTagId } from '../src/utils/tagSelection';

const originalSelection = [1, 2];
const nextSelection = appendSelectedTagId(originalSelection, 3);

assert.deepEqual(nextSelection, [1, 2, 3]);
assert.notEqual(nextSelection, originalSelection, 'adding a tag must replace the array reference for v-model consumers');
assert.deepEqual(originalSelection, [1, 2], 'adding a tag must not mutate the previous selection array');

const duplicateSelection = appendSelectedTagId(originalSelection, 2);
assert.equal(duplicateSelection, originalSelection, 'duplicate tags should keep the existing selection reference');

console.log('addConnectionFormTagSelection behavior ok');
