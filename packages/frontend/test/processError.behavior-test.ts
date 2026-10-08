import assert from 'node:assert/strict';
import { resolveProcessErrorMessage } from '../src/utils/processError';

assert.equal(resolveProcessErrorMessage('PROCESS_STATISTICS_UNAVAILABLE', 'translated failure'), 'translated failure');
assert.equal(resolveProcessErrorMessage(undefined, 'translated failure'), 'translated failure');
assert.equal(resolveProcessErrorMessage('legacy message', 'translated failure'), 'legacy message');
console.log('process error localization tests passed');
