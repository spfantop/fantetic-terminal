import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';

import { FakeWebSocket } from './support/terminal-session-runtime';

const main = async () => {
  const [{ createTerminalSessionLifecycle }, sessionState, connectionStoreModule] = await Promise.all([
    import('../src/stores/session/terminal-session-lifecycle'),
    import('../src/stores/session/state'),
    import('../src/stores/connections.store'),
  ]);
  const { activeSessionId, sessions, suspendedSshSessions } = sessionState;
  const { useConnectionsStore } = connectionStoreModule;

  setActivePinia(createPinia());
  sessions.value = new Map();
  activeSessionId.value = null;
  suspendedSshSessions.value = [];

  const connectionsStore = useConnectionsStore();
  connectionsStore.connections = [{
    id: 7,
    name: 'Architecture host',
    type: 'SSH',
    host: '127.0.0.1',
    port: 22,
    username: 'tester',
    auth_method: 'password',
    created_at: 1,
    updated_at: 1,
    last_connected_at: null,
  }, {
    id: 8,
    name: 'Legacy shell',
    type: 'TELNET',
    host: '127.0.0.1',
    port: 23,
    username: '',
    auth_method: 'password',
    created_at: 1,
    updated_at: 1,
    last_connected_at: null,
  }];

  const lifecycle = createTerminalSessionLifecycle({
    connectionsStore,
    t: ((key: string) => key) as never,
  });
  const frontendSessionId = lifecycle.open(7);

  assert.ok(frontendSessionId, 'opening a known SSH connection must return its frontend session ID');
  assert.equal(activeSessionId.value, frontendSessionId);
  assert.equal(sessions.value.get(frontendSessionId)?.kind, 'ssh');
  assert.equal(FakeWebSocket.instanceList.length, 1);

  const socket = FakeWebSocket.instanceList[0];
  socket.open();
  const sentMessageList = socket.sentFrameList.map(frame => JSON.parse(String(frame)));
  assert.deepEqual(sentMessageList.find(message => message.type === 'ssh:connect'), {
    type: 'ssh:connect',
    payload: {
      connectionId: '7',
      frontendSessionId,
      clientCapabilities: { sshBinaryOutput: true, sshBinaryInput: true },
    },
  });

  socket.receive({
    type: 'ssh:connected',
    payload: {
      sessionId: 'backend-session-7',
      connectionId: 7,
      serverCapabilities: { sshBinaryInput: true, sshBinaryOutput: true },
    },
  });
  const sessionId = 'backend-session-7';
  assert.equal(sessions.value.has(frontendSessionId), false);
  assert.equal(sessions.value.get(sessionId)?.sessionId, sessionId);
  assert.equal(activeSessionId.value, sessionId);

  socket.receive({
    type: 'SSH_MARKED_FOR_SUSPEND_ACK',
    payload: { sessionId, success: true },
  });
  assert.equal(sessions.value.get(sessionId)?.isMarkedForSuspend, true);
  socket.abnormalClose();
  assert.equal(
    sessions.value.get(sessionId)?.wsManager.connectionStatus.value,
    'disconnected',
    'a session marked for suspend must not schedule WebSocket reconnection',
  );

  assert.equal(lifecycle.close(sessionId), true);
  assert.equal(sessions.value.has(sessionId), false);
  assert.equal(activeSessionId.value, null);
  assert.equal(socket.readyState, FakeWebSocket.CLOSED);

  suspendedSshSessions.value = [{
    suspendSessionId: 'suspended-1',
    connectionName: 'Architecture host',
    connectionId: '7',
    suspendStartTime: new Date(0).toISOString(),
    backendSshStatus: 'hanging',
  }];

  const resumePromise = lifecycle.resume('suspended-1');
  const resumeSocket = FakeWebSocket.instanceList.at(-1);
  assert.ok(resumeSocket && resumeSocket !== socket, 'resume must create a dedicated WebSocket session');
  resumeSocket.open();
  const resumedFrontendSessionId = await resumePromise;
  assert.ok(resumedFrontendSessionId);

  const resumeMessageList = resumeSocket.sentFrameList.map(frame => JSON.parse(String(frame)));
  assert.equal(resumeMessageList.some(message => message.type === 'ssh:connect'), false);
  assert.deepEqual(
    resumeMessageList.find(message => message.type === 'SSH_SUSPEND_RESUME_REQUEST'),
    {
      type: 'SSH_SUSPEND_RESUME_REQUEST',
      payload: {
        suspendSessionId: 'suspended-1',
        newFrontendSessionId: resumedFrontendSessionId,
        clientCapabilities: { sshBinaryOutput: true, sshBinaryInput: true },
      },
    },
  );

  resumeSocket.receive({
    type: 'SSH_SUSPEND_RESUMED_NOTIF',
    payload: {
      suspendSessionId: 'suspended-1',
      newFrontendSessionId: resumedFrontendSessionId,
      success: true,
    },
  });
  assert.equal(sessions.value.get(resumedFrontendSessionId)?.isResuming, true);
  assert.equal(activeSessionId.value, resumedFrontendSessionId);
  assert.equal(suspendedSshSessions.value.length, 0);
  assert.equal(lifecycle.close(resumedFrontendSessionId), true);

  suspendedSshSessions.value = [{
    suspendSessionId: 'suspended-2',
    connectionName: 'Architecture host',
    connectionId: '7',
    suspendStartTime: new Date(0).toISOString(),
    backendSshStatus: 'hanging',
  }];
  const failedResumePromise = lifecycle.resume('suspended-2');
  const failedResumeSocket = FakeWebSocket.instanceList.at(-1);
  assert.ok(failedResumeSocket && failedResumeSocket !== resumeSocket);
  failedResumeSocket.open();
  const failedFrontendSessionId = await failedResumePromise;
  assert.ok(failedFrontendSessionId);
  failedResumeSocket.receive({
    type: 'SSH_SUSPEND_RESUMED_NOTIF',
    payload: {
      suspendSessionId: 'suspended-2',
      newFrontendSessionId: failedFrontendSessionId,
      success: false,
      error: 'backend refused resume',
    },
  });
  assert.equal(sessions.value.has(failedFrontendSessionId), false);
  assert.equal(suspendedSshSessions.value[0]?.suspendSessionId, 'suspended-2');
  assert.equal(failedResumeSocket.readyState, FakeWebSocket.CLOSED);
  assert.equal(failedResumeSocket.closeCallCount, 1);

  const telnetSessionId = lifecycle.open(8);
  assert.ok(telnetSessionId);
  const telnetSocket = FakeWebSocket.instanceList.at(-1);
  assert.ok(telnetSocket && telnetSocket !== failedResumeSocket);
  telnetSocket.open();
  const telnetMessageList = telnetSocket.sentFrameList.map(frame => JSON.parse(String(frame)));
  assert.deepEqual(telnetMessageList.find(message => message.type === 'telnet:connect'), {
    type: 'telnet:connect',
    payload: {
      connectionId: '8',
      frontendSessionId: telnetSessionId,
      clientCapabilities: { sshBinaryOutput: true, sshBinaryInput: false },
    },
  });
  telnetSocket.receive({
    type: 'SSH_MARKED_FOR_SUSPEND_ACK',
    payload: { sessionId: telnetSessionId, success: true },
  });
  assert.equal(sessions.value.get(telnetSessionId)?.isMarkedForSuspend, false);
  assert.equal(lifecycle.close(telnetSessionId), true);

  console.log('terminal session lifecycle behavior passed');
};

void main();
