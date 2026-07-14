import assert from 'node:assert/strict';

type PatchedGuacdClient = {
    selectProtocolVersion(serverVersion: string): string;
    redactInstructionForLog(instruction: string[]): string[];
    summarizeInstructionNames(data: string): { total: number; counts: Record<string, number> };
};

const GuacdClient = require('guacamole-lite/lib/GuacdClient.js') as PatchedGuacdClient;

assert.equal(GuacdClient.selectProtocolVersion('1_5_0'), '1_5_0');
assert.equal(GuacdClient.selectProtocolVersion('1_4_0'), '1_3_0');
assert.equal(GuacdClient.selectProtocolVersion('1_2_0'), '1_1_0');
assert.equal(GuacdClient.selectProtocolVersion('0_9_0'), '1_0_0');
assert.deepEqual(GuacdClient.redactInstructionForLog(['connect', 'credential']), ['connect', '[REDACTED]']);
assert.deepEqual(GuacdClient.summarizeInstructionNames('4.args,1.a;5.ready,1.b;'), {
    total: 2,
    counts: { args: 1, ready: 1 },
});

console.log('guacamole-lite patch behavior ok');
