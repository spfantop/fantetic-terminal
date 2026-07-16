import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { resolveRemoteDesktopTokenFailure } from '../connections/remote-desktop-token-error';
import { RemoteDesktopGrantRegistry } from '../websocket/remote-desktop-grant';

let now = 1000;
const grants = new RemoteDesktopGrantRegistry({ ttlMs: 5000, maxEntries: 10, now: () => now });
grants.register('secret-token', 1, 42);
assert.equal(grants.consume('secret-token', 2), undefined);
assert.deepEqual(grants.consume('secret-token', 1), { connectionId: 42, protocol: undefined, connectionName: undefined });
assert.equal(grants.consume('secret-token', 1), undefined);
grants.register('expired-token', 1, 43);
now = 6001;
assert.equal(grants.consume('expired-token', 1), undefined);
grants.register('metadata-token', 1, 44, {
  protocol: 'RDP',
  connectionName: 'jump host',
  requestId: 'req-remote-desktop-1',
});
assert.deepEqual(grants.consume('metadata-token', 1), {
  connectionId: 44,
  protocol: 'RDP',
  connectionName: 'jump host',
  requestId: 'req-remote-desktop-1',
});

assert.deepEqual(
  resolveRemoteDesktopTokenFailure({ isAxiosError: true, response: { status: 503 } }),
  { status: 502, code: 'remoteDesktop.gatewayUnavailable' },
);
assert.deepEqual(
  resolveRemoteDesktopTokenFailure({ isAxiosError: true, request: {} }),
  { status: 504, code: 'remoteDesktop.gatewayTimeout' },
);
assert.deepEqual(
  resolveRemoteDesktopTokenFailure(new Error('密码解密失败')),
  { status: 400, code: 'remoteDesktop.connectionConfigurationInvalid' },
);

const controllerSource = fs.readFileSync(path.resolve('src/connections/connections.controller.ts'), 'utf8');
const remoteDesktopTokenSource = controllerSource.slice(
  controllerSource.indexOf('export const getRdpSessionToken'),
  controllerSource.indexOf('export const cloneConnection'),
);
assert.match(remoteDesktopTokenSource, /sendApiError/);
assert.doesNotMatch(remoteDesktopTokenSource, /res\.status\(statusCode\)\.json\(\{ message: responseMessage \}\)/);
assert.doesNotMatch(remoteDesktopTokenSource, /responseMessage \+=/);
assert.match(remoteDesktopTokenSource, /readAuditContext\(\)\?\.requestId/);
assert.match(remoteDesktopTokenSource, /getRemoteDesktopToken\([^\n]*readAuditContext\(\)\?\.requestId\)/);

const rdpProxySource = fs.readFileSync(path.resolve('src/websocket/handlers/rdp.handler.ts'), 'utf8');
assert.match(rdpProxySource, /'x-request-id': requestId/);
assert.doesNotMatch(rdpProxySource, /\bconsole\.(?:log|info|warn|error|debug)\b/);

console.log('remote desktop grant behavior ok');
