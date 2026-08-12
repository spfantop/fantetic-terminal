import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { SftpService, SftpSessionCleanupError } from '../sftp/sftp.service';

const ownerMessages: string[] = [];
const otherMessages: string[] = [];
const clientStates = new Map<string, any>([
  ['owner-session', {
    sftp: {},
    ws: { readyState: WebSocket.OPEN, send: (message: string) => ownerMessages.push(message) },
  }],
  ['other-session', {
    sftp: {},
    ws: { readyState: WebSocket.OPEN, send: (message: string) => otherMessages.push(message) },
  }],
]);

let writeCount = 0;
let endCount = 0;
let destroyCount = 0;
const uploadStream = {
  destroyed: false,
  writableEnded: false,
  write: () => {
    writeCount += 1;
    return true;
  },
  end: (callback?: (error?: Error) => void) => {
    endCount += 1;
    callback?.();
  },
  destroy: () => {
    destroyCount += 1;
  },
};

const service = new SftpService(clientStates);
const activeUploads = (service as unknown as { activeUploads: Map<string, any> }).activeUploads;
activeUploads.set('owned-upload', {
  remotePath: '/owner/private.txt',
  totalSize: 1,
  bytesWritten: 0,
  stream: uploadStream,
  sessionId: 'owner-session',
  chunkQueue: Promise.resolve(),
  expectedChunkIndex: 0,
  lastProgressSentAt: 0,
});

await service.handleUploadChunk('other-session', 'owned-upload', 0, Buffer.from('x').toString('base64'), 1, true);
service.cancelUpload('other-session', 'owned-upload');

assert.equal(writeCount, 0, 'a foreign session must not write an owned upload');
assert.equal(endCount, 0, 'a foreign session must not end an owned upload');
assert.equal(destroyCount, 0, 'a foreign session must not destroy an owned upload');
assert.ok(activeUploads.has('owned-upload'), 'a foreign session must not remove an owned upload');
assert.equal(ownerMessages.length, 0, 'the owner should not receive a message caused by a foreign request');
assert.equal(otherMessages.length, 2, 'the foreign session should receive explicit denial errors');
assert.ok(otherMessages.every(message => JSON.parse(message).type === 'sftp:upload:error'));

const sftpCloseError = new Error('SFTP transport close failed');
clientStates.set('cleanup-session', {
  sftp: { end: () => { throw sftpCloseError; } },
  ws: { readyState: WebSocket.OPEN, send: () => undefined },
});
let cleanupUploadEndCount = 0;
activeUploads.set('cleanup-upload', {
  remotePath: '/cleanup/partial.txt',
  totalSize: 10,
  bytesWritten: 1,
  stream: {
    destroyed: false,
    writableEnded: false,
    end: (callback?: (error?: Error) => void) => {
      cleanupUploadEndCount += 1;
      callback?.();
    },
    destroy: () => undefined,
  },
  sessionId: 'cleanup-session',
  chunkQueue: Promise.resolve(),
  expectedChunkIndex: 1,
  lastProgressSentAt: 0,
});
assert.throws(
  () => service.cleanupSftpSession('cleanup-session'),
  error => (
    error instanceof SftpSessionCleanupError
    && error.errors.includes(sftpCloseError)
  ),
);
assert.equal(clientStates.get('cleanup-session')?.sftp, undefined);
assert.equal(cleanupUploadEndCount, 1);
assert.equal(activeUploads.has('cleanup-upload'), false);

console.log('SFTP upload ownership behavior ok');
