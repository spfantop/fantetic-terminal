type BatchInputSession = {
  kind?: string;
};

type ResolveTerminalBatchInputTargetIdsOptions = {
  sourceSessionId: string;
  batchEnabled: boolean;
  workspaceSplitActive: boolean;
  workspaceSplitSessionIds: readonly string[];
  sessions: ReadonlyMap<string, BatchInputSession>;
};

const isTerminalShellSessionKind = (kind?: string) => kind === 'ssh' || kind === 'telnet';

export const resolveTerminalBatchInputTargetIds = ({
  sourceSessionId,
  batchEnabled,
  workspaceSplitActive,
  workspaceSplitSessionIds,
  sessions,
}: ResolveTerminalBatchInputTargetIdsOptions): string[] => {
  if (!batchEnabled || !workspaceSplitActive || !workspaceSplitSessionIds.includes(sourceSessionId)) {
    return [sourceSessionId];
  }

  const targetIds = workspaceSplitSessionIds.filter(sessionId => isTerminalShellSessionKind(sessions.get(sessionId)?.kind));
  return targetIds.length > 0 ? targetIds : [sourceSessionId];
};
