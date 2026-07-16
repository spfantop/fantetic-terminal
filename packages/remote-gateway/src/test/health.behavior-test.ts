import assert from 'node:assert/strict';
import net from 'node:net';

import { createHealthSnapshot, isGuacdReachable } from '../health';

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
};

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
