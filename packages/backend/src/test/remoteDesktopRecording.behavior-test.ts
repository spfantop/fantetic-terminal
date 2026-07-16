import assert from 'node:assert/strict';

import { createRemoteDesktopRecordingBridge } from '../websocket/remote-desktop-recording';

const callList: string[] = [];
const bridge = createRemoteDesktopRecordingBridge({
  start: async () => ({
    recordGuacamoleClient: (data: Buffer) => callList.push(`client:${data.toString('utf8')}`),
    recordGuacamoleServer: (data: Buffer) => callList.push(`server:${data.toString('utf8')}`),
    markIncomplete: () => callList.push('incomplete'),
    finish: async () => { callList.push('finish'); },
  }),
});

bridge.recordClient(Buffer.from('4.sync,1.a;'));
bridge.recordServer(Buffer.from('5.ready,1.b;'));
await bridge.ready;
await bridge.finish({ incomplete: true });

assert.deepEqual(callList, [
  'client:4.sync,1.a;',
  'server:5.ready,1.b;',
  'incomplete',
  'finish',
]);

const failedBridge = createRemoteDesktopRecordingBridge({
  start: async () => { throw new Error('index unavailable'); },
});
failedBridge.recordClient(Buffer.from('must not throw while startup is pending'));
await assert.rejects(failedBridge.ready, /index unavailable/);
await failedBridge.finish({ incomplete: true });

console.log('remote desktop recording behavior ok');
