import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { encryptGatewayToken } from '../token';

type PatchedGuacdClient = {
    selectProtocolVersion(serverVersion: string): string;
    redactInstructionForLog(instruction: string[]): string[];
    summarizeInstructionNames(data: string): { total: number; counts: Record<string, number> };
};

const GuacdClient = require('guacamole-lite/lib/GuacdClient.js') as PatchedGuacdClient;
const Crypt = require('guacamole-lite/lib/Crypt.js') as new (algorithm: string, key: Buffer) => {
    decrypt(token: string): Record<string, unknown>;
};

assert.equal(GuacdClient.selectProtocolVersion('1_5_0'), '1_5_0');
assert.equal(GuacdClient.selectProtocolVersion('1_4_0'), '1_3_0');
assert.equal(GuacdClient.selectProtocolVersion('1_2_0'), '1_1_0');
assert.equal(GuacdClient.selectProtocolVersion('0_9_0'), '1_0_0');
assert.deepEqual(GuacdClient.redactInstructionForLog(['connect', 'credential']), ['connect', '[REDACTED]']);
assert.deepEqual(GuacdClient.summarizeInstructionNames('4.args,1.a;5.ready,1.b;'), {
    total: 2,
    counts: { args: 1, ready: 1 },
});
const gatewaySource = readFileSync(resolve('src/server.ts'), 'utf8');
assert.match(gatewaySource, /log:\s*\{\s*level:\s*'ERRORS'/);

const key = Buffer.alloc(32, 9);
const claims = { expiresAt: 20_000, nonce: 'nonce-guacamole-123' };
const encryptedToken = encryptGatewayToken(JSON.stringify(claims), key);
const crypt = new Crypt('aes-256-gcm', key);
assert.deepEqual(crypt.decrypt(encryptedToken), claims);

const envelope = JSON.parse(Buffer.from(encryptedToken, 'base64').toString('utf8')) as Record<string, string>;
const tag = Buffer.from(envelope.tag, 'base64');
tag[0] ^= 1;
envelope.tag = tag.toString('base64');
const tamperedToken = Buffer.from(JSON.stringify(envelope)).toString('base64');
assert.throws(() => crypt.decrypt(tamperedToken), /invalid gateway token/i);

console.log('guacamole-lite patch behavior ok');
