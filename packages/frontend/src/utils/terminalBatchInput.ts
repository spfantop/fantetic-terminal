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

  const targetIds = workspaceSplitSessionIds.filter(sessionId => sessions.get(sessionId)?.kind === 'ssh');
  return targetIds.length > 0 ? targetIds : [sourceSessionId];
};
