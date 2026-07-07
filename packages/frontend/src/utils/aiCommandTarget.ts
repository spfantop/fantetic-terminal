export function resolveAICommandInputTarget(options: {
  targetSessionId?: string | null;
  activeSessionId?: string | null;
}): string | null {
  return options.targetSessionId || options.activeSessionId || null;
}

export function shouldShowAICommandEntry(options: {
  isMobile?: boolean;
  isAIEnabled: boolean;
}): boolean {
  return !options.isMobile && options.isAIEnabled;
}
