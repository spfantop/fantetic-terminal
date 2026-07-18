interface PollingGroup {
  active: boolean;
  connectionId: number;
  sessionIdSet: Set<string>;
  timer: NodeJS.Timeout;
}

export const createConnectionPollingCoordinator = ({
  poll,
  setInterval = global.setInterval,
  clearInterval = global.clearInterval,
  onConnectionEmpty = () => undefined,
  onPollError = () => undefined,
}: {
  poll: (connectionId: number, sessionIdList: readonly string[]) => void | Promise<void>;
  setInterval?: typeof global.setInterval;
  clearInterval?: typeof global.clearInterval;
  onConnectionEmpty?: (connectionId: number) => void;
  onPollError?: (connectionId: number, error: unknown) => void;
}) => {
  const groupByConnectionId = new Map<number, PollingGroup>();
  const connectionIdBySessionId = new Map<string, number>();

  const runPoll = (group: PollingGroup): void => {
    if (!group.active) return;
    const sessionIdList = [...group.sessionIdSet];
    Promise.resolve()
      .then(() => poll(group.connectionId, sessionIdList))
      .catch(error => onPollError(group.connectionId, error));
  };

  const leave = (sessionId: string): void => {
    const connectionId = connectionIdBySessionId.get(sessionId);
    if (connectionId === undefined) return;
    connectionIdBySessionId.delete(sessionId);

    const group = groupByConnectionId.get(connectionId);
    if (!group) return;
    group.sessionIdSet.delete(sessionId);
    if (group.sessionIdSet.size > 0) return;

    group.active = false;
    clearInterval(group.timer);
    groupByConnectionId.delete(connectionId);
    onConnectionEmpty(connectionId);
  };

  const join = (connectionId: number, sessionId: string, intervalMs: number): void => {
    const currentConnectionId = connectionIdBySessionId.get(sessionId);
    if (currentConnectionId === connectionId) return;
    if (currentConnectionId !== undefined) leave(sessionId);

    const currentGroup = groupByConnectionId.get(connectionId);
    if (currentGroup) {
      currentGroup.sessionIdSet.add(sessionId);
      connectionIdBySessionId.set(sessionId, connectionId);
      return;
    }

    const group = {
      active: true,
      connectionId,
      sessionIdSet: new Set([sessionId]),
      timer: undefined as unknown as NodeJS.Timeout,
    };
    group.timer = setInterval(() => runPoll(group), intervalMs);
    groupByConnectionId.set(connectionId, group);
    connectionIdBySessionId.set(sessionId, connectionId);
    runPoll(group);
  };

  const dispose = (): void => {
    for (const group of groupByConnectionId.values()) {
      group.active = false;
      clearInterval(group.timer);
      onConnectionEmpty(group.connectionId);
    }
    groupByConnectionId.clear();
    connectionIdBySessionId.clear();
  };

  return {
    dispose,
    hasSession: (sessionId: string): boolean => connectionIdBySessionId.has(sessionId),
    join,
    leave,
  };
};
