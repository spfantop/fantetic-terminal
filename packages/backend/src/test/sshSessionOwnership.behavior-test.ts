import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  resolveSshSessionOwnership,
  SshSessionOwnershipError,
} from '../websocket/ssh-session-ownership';
import { SshSuspendService } from '../ssh-suspend/ssh-suspend.service';
import { TemporaryLogStorageService } from '../ssh-suspend/temporary-log-storage.service';

const closeEventList: string[] = [];
const takeoverError = new Error('takeover failed');
const state = {
  sshClient: { end: () => { closeEventList.push('client'); } },
  sshShellStream: { end: () => { closeEventList.push('channel'); } },
  dbConnectionId: 17,
  connectionName: 'production-shell',
  isMarkedForSuspend: true,
  isSuspendedByService: false,
  suspendLogPath: 'session-log',
};

await assert.rejects(
  resolveSshSessionOwnership({
    sessionId: 'session-1',
    userId: 42,
    state,
    takeOver: async () => { throw takeoverError; },
  }),
  takeoverError,
);
assert.deepEqual(closeEventList, ['channel', 'client']);
assert.equal(state.sshClient, undefined);
assert.equal(state.sshShellStream, undefined);
assert.equal(state.isSuspendedByService, false);

const transferredCloseEventList: string[] = [];
const transferredState = {
  sshClient: { end: () => { transferredCloseEventList.push('client'); } },
  sshShellStream: { end: () => { transferredCloseEventList.push('channel'); } },
  dbConnectionId: 18,
  connectionName: 'suspended-shell',
  isMarkedForSuspend: true,
  isSuspendedByService: false,
  suspendLogPath: 'transferred-log',
};
const transferredDetails: Array<{ originalSessionId: string; connectionId: string }> = [];
const transferredResult = await resolveSshSessionOwnership({
  sessionId: 'session-2',
  userId: 43,
  state: transferredState,
  takeOver: async details => {
    transferredDetails.push(details);
    return 'suspended-session';
  },
});
assert.equal(transferredResult, 'transferred');
assert.deepEqual(transferredCloseEventList, [], 'success transfers ownership without closing resources');
assert.equal(transferredDetails.length, 1);
assert.equal(transferredDetails[0]?.originalSessionId, 'session-2');
assert.equal(transferredDetails[0]?.connectionId, '18');
assert.equal(transferredState.sshClient, undefined);
assert.equal(transferredState.sshShellStream, undefined);
assert.equal(transferredState.isSuspendedByService, true);

const resilientCloseEventList: string[] = [];
const channelCloseError = new Error('channel close failed');
const resilientState = {
  sshClient: { end: () => { resilientCloseEventList.push('client'); } },
  sshShellStream: {
    end: () => {
      resilientCloseEventList.push('channel');
      throw channelCloseError;
    },
  },
  dbConnectionId: 19,
  isMarkedForSuspend: true,
  isSuspendedByService: false,
  suspendLogPath: 'resilient-log',
};
await assert.rejects(
  resolveSshSessionOwnership({
    sessionId: 'session-3',
    userId: 44,
    state: resilientState,
    takeOver: async () => { throw takeoverError; },
  }),
  error => (
    error instanceof SshSessionOwnershipError
    && error.errors.includes(takeoverError)
    && error.errors.includes(channelCloseError)
  ),
);
assert.deepEqual(resilientCloseEventList, ['channel', 'client']);
assert.equal(resilientState.isSuspendedByService, false);

const rejectedCloseEventList: string[] = [];
const rejectedState = {
  sshClient: { end: () => { rejectedCloseEventList.push('client'); } },
  sshShellStream: {
    end: () => {
      rejectedCloseEventList.push('channel');
      throw channelCloseError;
    },
  },
  dbConnectionId: 20,
  isMarkedForSuspend: true,
  isSuspendedByService: false,
  suspendLogPath: 'rejected-log',
};
await assert.rejects(
  resolveSshSessionOwnership({
    sessionId: 'session-4',
    userId: 45,
    state: rejectedState,
    takeOver: async () => null,
  }),
  error => error instanceof SshSessionOwnershipError && error.errors.includes(channelCloseError),
);
assert.deepEqual(
  rejectedCloseEventList,
  ['channel', 'client'],
  'a rejected takeover must attempt each close operation exactly once',
);
assert.equal(rejectedState.isSuspendedByService, false);

const adapterCloseEventList: string[] = [];
const suspendService = new SshSuspendService();
const rejectedByAdapter = await Reflect.apply(
  suspendService.takeOverMarkedSession,
  suspendService,
  [{
    userId: 46,
    originalSessionId: 'session-5',
    sshClient: { end: () => { adapterCloseEventList.push('client'); } },
    channel: {
      readable: false,
      writable: false,
      end: () => { adapterCloseEventList.push('channel'); },
    },
    connectionName: 'unusable-shell',
    connectionId: '21',
    logIdentifier: 'unusable-log',
  }],
);
assert.equal(rejectedByAdapter, null);
assert.deepEqual(
  adapterCloseEventList,
  [],
  'the takeover adapter must not close resources still owned by the caller',
);

const failingLogStorage = {
  ensureLogDirectoryExists: async () => { throw new Error('log storage unavailable'); },
  writeToLog: async () => undefined,
  readLog: async () => '',
  deleteLog: async () => undefined,
};
const transactionalSuspendService = new SshSuspendService(failingLogStorage);
const inertResource = {
  readable: true,
  writable: true,
  end: () => undefined,
  on: () => inertResource,
  removeAllListeners: () => inertResource,
};
await assert.rejects(
  Reflect.apply(
    transactionalSuspendService.takeOverMarkedSession,
    transactionalSuspendService,
    [{
      userId: 47,
      originalSessionId: 'session-6',
      sshClient: inertResource,
      channel: inertResource,
      connectionName: 'transactional-shell',
      connectionId: '22',
      logIdentifier: 'transactional-log',
    }],
  ),
  /log storage unavailable/,
);
assert.deepEqual(
  await transactionalSuspendService.listSuspendedSessions(47),
  [],
  'failed preparation must not commit a suspended-session registry entry',
);

let releasePreparation: (() => void) | undefined;
let markPreparationStarted: (() => void) | undefined;
const preparationStarted = new Promise<void>(resolve => { markPreparationStarted = resolve; });
const preparationBarrier = new Promise<void>(resolve => { releasePreparation = resolve; });
const deferredLogStorage = {
  ensureLogDirectoryExists: async () => {
    markPreparationStarted?.();
    await preparationBarrier;
  },
  writeToLog: async () => undefined,
  readLog: async () => '',
  deleteLog: async () => undefined,
};
const deferredSuspendService = new SshSuspendService(deferredLogStorage);
const deferredCloseEventList: string[] = [];
const deferredClient = {
  end: () => { deferredCloseEventList.push('client'); },
  on: () => deferredClient,
  removeAllListeners: () => deferredClient,
};
const deferredChannel = {
  readable: true,
  writable: true,
  end: () => { deferredCloseEventList.push('channel'); },
  on: () => deferredChannel,
  removeAllListeners: () => deferredChannel,
};
const deferredState = {
  sshClient: deferredClient,
  sshShellStream: deferredChannel,
  dbConnectionId: 23,
  connectionName: 'deferred-shell',
  isMarkedForSuspend: true,
  isSuspendedByService: false,
  suspendLogPath: 'deferred-log',
};
const deferredOwnership = resolveSshSessionOwnership({
  sessionId: 'session-7',
  userId: 48,
  state: deferredState,
  takeOver: details => Reflect.apply(
    deferredSuspendService.takeOverMarkedSession,
    deferredSuspendService,
    [details],
  ),
});
await preparationStarted;
deferredChannel.readable = false;
deferredChannel.writable = false;
releasePreparation?.();
assert.equal(await deferredOwnership, 'closed');
assert.deepEqual(deferredCloseEventList, ['channel', 'client']);
assert.deepEqual(await deferredSuspendService.listSuspendedSessions(48), []);

const storageTestDirectory = mkdtempSync(join(tmpdir(), 'fantetic-suspend-storage-'));
try {
  const blockingFile = join(storageTestDirectory, 'blocking-file');
  writeFileSync(blockingFile, 'not a directory', 'utf8');
  const failingFilesystemStorage = new TemporaryLogStorageService(join(blockingFile, 'logs'));
  await assert.rejects(
    failingFilesystemStorage.ensureLogDirectoryExists(),
    /ENOTDIR|EEXIST/,
    'the real storage adapter must expose preparation failure to the ownership caller',
  );
} finally {
  rmSync(storageTestDirectory, { recursive: true, force: true });
}

console.log('SSH session ownership behavior passed');
