import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const sourceRoot = path.resolve(process.cwd(), 'src');
const readSource = (relativePath: string): string => fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8');

const serviceSource = readSource('connections/connection.service.ts');
const repositorySource = readSource('connections/connection.repository.ts');
const controllerSource = readSource('connections/connections.controller.ts');
const notificationProcessorSource = readSource('notifications/notification.processor.service.ts');
const notificationServiceSource = readSource('notifications/notification.service.ts');
const passkeyServiceSource = readSource('passkey/passkey.service.ts');
const dockerServiceSource = readSource('docker/docker.service.ts');
const ipBlacklistServiceSource = readSource('auth/ip-blacklist.service.ts');
const authControllerSource = readSource('auth/auth.controller.ts');
const notificationSenderSources = [
  readSource('notifications/senders/webhook.sender.service.ts'),
  readSource('notifications/senders/email.sender.service.ts'),
  readSource('notifications/senders/telegram.sender.service.ts'),
];

assert.doesNotMatch(serviceSource, /JSON\.stringify\(input/);
assert.doesNotMatch(repositorySource, /JSON\.stringify\(data\s*[,)]/);
assert.doesNotMatch(repositorySource, /JSON\.stringify\(params\s*[,)]/);
assert.match(serviceSource, /createLogger\(['"]ConnectionService['"]\)/);
assert.match(repositorySource, /createLogger\(['"]ConnectionRepository['"]\)/);
assert.match(controllerSource, /createLogger\(['"]ConnectionsController['"]\)/);
assert.doesNotMatch(controllerSource, /\bconsole\.(?:log|info|warn|error|debug)\b/);
assert.match(notificationProcessorSource, /createLogger\(['"]NotificationProcessor['"]\)/);
assert.doesNotMatch(notificationProcessorSource, /\bconsole\.(?:log|info|warn|error|debug)\b/);
assert.match(notificationServiceSource, /createLogger\(['"]NotificationService['"]\)/);
assert.doesNotMatch(notificationServiceSource, /\bconsole\.(?:log|info|warn|error|debug)\b/);
assert.match(passkeyServiceSource, /createLogger\(['"]PasskeyService['"]\)/);
assert.doesNotMatch(passkeyServiceSource, /\bconsole\.(?:log|info|warn|error|debug)\b/);
assert.match(dockerServiceSource, /createLogger\(['"]DockerService['"]\)/);
assert.doesNotMatch(dockerServiceSource, /\bconsole\.(?:log|info|warn|error|debug)\b/);
assert.match(ipBlacklistServiceSource, /createLogger\(['"]IpBlacklistService['"]\)/);
assert.doesNotMatch(ipBlacklistServiceSource, /\bconsole\.(?:log|info|warn|error|debug)\b/);
assert.match(authControllerSource, /createLogger\(['"]AuthController['"]\)/);
assert.doesNotMatch(authControllerSource, /\bconsole\.(?:log|info|warn|error|debug)\b/);
for (const source of notificationSenderSources) {
  assert.match(source, /createLogger\(/);
  assert.doesNotMatch(source, /\bconsole\.(?:log|info|warn|error|debug)\b/);
}

console.log('credential logging behavior ok');
