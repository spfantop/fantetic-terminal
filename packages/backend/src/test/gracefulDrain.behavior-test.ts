import assert from 'node:assert/strict';

import { createGracefulDrainRegistry, GracefulDrainError } from '../config/graceful-drain';

const executionOrder: string[] = [];
const registry = createGracefulDrainRegistry();
registry.register('release', 'single-node-lease', () => {
  executionOrder.push('lease');
});
registry.register('connections', 'websocket', async () => {
  executionOrder.push('websocket');
});
registry.register('stop', 'backup-scheduler', () => {
  executionOrder.push('scheduler');
});
registry.register('storage', 'database', () => {
  executionOrder.push('database');
});
registry.register('connections', 'http', () => {
  executionOrder.push('http');
});

const firstDrain = registry.drain('SIGTERM');
const repeatedDrain = registry.drain('SIGINT');
assert.equal(firstDrain, repeatedDrain, 'repeated signals must share one drain promise');
await firstDrain;
assert.deepEqual(executionOrder, ['scheduler', 'websocket', 'http', 'database', 'lease']);

const failureOrder: string[] = [];
const cleanupErrors: Array<{ name: string; error: unknown }> = [];
const failureRegistry = createGracefulDrainRegistry({
  onCleanupError: (name, error) => cleanupErrors.push({ name, error }),
});
failureRegistry.register('connections', 'websocket', () => {
  failureOrder.push('websocket');
  throw new Error('websocket close failed');
});
failureRegistry.register('storage', 'database', () => {
  failureOrder.push('database');
});
failureRegistry.register('release', 'single-node-lease', () => {
  failureOrder.push('lease');
});

await assert.rejects(
  failureRegistry.drain('startupFailure'),
  (error: GracefulDrainError) => {
    assert.equal(error.errors.length, 1);
    assert.match(error.message, /websocket/);
    return true;
  },
);
assert.deepEqual(failureOrder, ['websocket', 'database', 'lease']);
assert.equal(cleanupErrors.length, 1);
assert.equal(cleanupErrors[0]?.name, 'websocket');

console.log('graceful drain behavior passed');
