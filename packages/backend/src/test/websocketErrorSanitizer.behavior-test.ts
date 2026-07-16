import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { installWebSocketErrorSanitizer } from '../websocket/error-sanitizer';

const sentMessageList: unknown[] = [];
const webSocket = {
  send(data: unknown) { sentMessageList.push(data); },
};
installWebSocketErrorSanitizer(webSocket as any);

webSocket.send(JSON.stringify({ type: 'ssh:error', payload: 'connect failed: private host details' }));
assert.deepEqual(JSON.parse(sentMessageList.pop() as string), {
  type: 'ssh:error',
  payload: '操作失败，请稍后重试。',
});

webSocket.send(JSON.stringify({ type: 'sftp_error', payload: { requestId: 'r1', message: 'remote path /secret', error: 'permission detail' } }));
assert.deepEqual(JSON.parse(sentMessageList.pop() as string), {
  type: 'sftp_error',
  payload: { requestId: 'r1', message: '操作失败，请稍后重试。', error: '操作失败，请稍后重试。' },
});

webSocket.send(JSON.stringify({ type: 'ssh:output', payload: 'normal terminal output' }));
assert.equal(sentMessageList.pop(), JSON.stringify({ type: 'ssh:output', payload: 'normal terminal output' }));

const binaryOutput = Buffer.from('{"type":"ssh:error","payload":"terminal output must remain binary"}');
webSocket.send(binaryOutput);
assert.equal(sentMessageList.pop(), binaryOutput);

const connectionHandlerSource = fs.readFileSync(path.resolve('src/websocket/connection.ts'), 'utf8');
assert.match(connectionHandlerSource, /installWebSocketErrorSanitizer\(ws\)/);
assert.doesNotMatch(connectionHandlerSource, /console\.(?:log|info|warn|error|debug)\([^\n]*JSON\.stringify\(payload\)/);
assert.doesNotMatch(connectionHandlerSource, /\bconsole\.(?:log|info|warn|error|debug)\b/);

const sshHandlerSource = fs.readFileSync(path.resolve('src/websocket/handlers/ssh.handler.ts'), 'utf8');
assert.match(sshHandlerSource, /createLogger\('SshHandler'\)/);
assert.doesNotMatch(sshHandlerSource, /\bconsole\.(?:log|info|warn|error|debug)\b/);

const dockerHandlerSource = fs.readFileSync(path.resolve('src/websocket/handlers/docker.handler.ts'), 'utf8');
assert.match(dockerHandlerSource, /createLogger\('DockerWebSocketHandler'\)/);
assert.doesNotMatch(dockerHandlerSource, /\bconsole\.(?:log|info|warn|error|debug)\b/);

console.log('websocket error sanitizer behavior ok');
