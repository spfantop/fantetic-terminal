type ResolveVisibleActiveSessionIdOptions = {
  activeSessionId: string | null;
  visibleSessionIds: readonly string[];
};

type ResolveWorkspaceLayoutActiveSessionIdOptions = ResolveVisibleActiveSessionIdOptions & {
  previousLayoutActiveSessionId: string | null;
  fullscreenSessionId: string | null;
};

export const resolveVisibleActiveSessionId = ({
  activeSessionId,
  visibleSessionIds,
}: ResolveVisibleActiveSessionIdOptions): string | null => (
  activeSessionId && visibleSessionIds.includes(activeSessionId) ? activeSessionId : null
);

export const resolveWorkspaceLayoutActiveSessionId = ({
  activeSessionId,
  visibleSessionIds,
  previousLayoutActiveSessionId,
  fullscreenSessionId,
}: ResolveWorkspaceLayoutActiveSessionIdOptions): string | null => {
  if (fullscreenSessionId) {
    return fullscreenSessionId;
  }

  const visibleActiveSessionId = resolveVisibleActiveSessionId({ activeSessionId, visibleSessionIds });
  if (visibleActiveSessionId) {
    return visibleActiveSessionId;
  }

  if (previousLayoutActiveSessionId && visibleSessionIds.includes(previousLayoutActiveSessionId)) {
    return previousLayoutActiveSessionId;
  }

  return visibleSessionIds[0] ?? null;
};
