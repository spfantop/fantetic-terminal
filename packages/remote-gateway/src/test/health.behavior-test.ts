import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import net from 'node:net';

import {
  bindGatewayReadinessLifecycle,
  createGatewayReadiness,
  createHealthSnapshot,
  isGuacdReachable,
} from '../health';

const run = async (): Promise<void> => {
  assert.deepEqual(
    createHealthSnapshot({ guacamoleReady: true }),
    { status: 'ready', checks: { guacamole: 'ready' } },
  );

  const guacd = net.createServer();
  await new Promise<void>((resolve) => guacd.listen(0, '127.0.0.1', resolve));
  const address = guacd.address();
  assert.ok(address && typeof address !== 'string');
  assert.equal(await isGuacdReachable({ host: '127.0.0.1', port: address.port, timeoutMs: 200 }), true);
  await new Promise<void>((resolve, reject) => guacd.close((error) => error ? reject(error) : resolve()));
  assert.equal(await isGuacdReachable({ host: '127.0.0.1', port: address.port, timeoutMs: 200 }), false);

  assert.deepEqual(
    createHealthSnapshot({ guacamoleReady: false }),
    { status: 'not_ready', checks: { guacamole: 'not_ready' } },
  );

  const readiness = createGatewayReadiness();
  assert.equal(readiness.isReady(), false);
  readiness.markReady();
  assert.equal(readiness.isReady(), true);
  readiness.markUnavailable();
  assert.equal(readiness.isReady(), false);

  const lifecycle = new EventEmitter();
  bindGatewayReadinessLifecycle(lifecycle, readiness);
  lifecycle.on('error', () => {});
  readiness.markReady();
  lifecycle.emit('error', new Error('socket failed'));
  assert.equal(readiness.isReady(), false);
  readiness.markReady();
  lifecycle.emit('close');
  assert.equal(readiness.isReady(), false);
};

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
