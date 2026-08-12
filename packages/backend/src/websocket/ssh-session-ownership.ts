interface EndableResource {
  end: () => unknown;
}

interface SshSessionOwnershipState<
  SshClient extends EndableResource,
  SshChannel extends EndableResource,
> {
  sshClient?: SshClient;
  sshShellStream?: SshChannel;
  dbConnectionId: number;
  connectionName?: string;
  isMarkedForSuspend?: boolean;
  isSuspendedByService?: boolean;
  suspendLogPath?: string;
}

interface SshSessionTakeoverDetails<
  SshClient extends EndableResource,
  SshChannel extends EndableResource,
> {
  userId: number;
  originalSessionId: string;
  sshClient: SshClient;
  channel: SshChannel;
  connectionName: string;
  connectionId: string;
  logIdentifier: string;
  customSuspendName?: string;
}

export type SshSessionOwnershipResult = 'closed' | 'transferred' | 'unchanged';

export class SshSessionOwnershipError extends Error {
  constructor(message: string, public readonly errors: unknown[]) {
    super(message);
    this.name = 'SshSessionOwnershipError';
  }
}

const closeResources = <SshClient extends EndableResource, SshChannel extends EndableResource>(
  sshClient: SshClient,
  channel: SshChannel | undefined,
): unknown[] => {
  const errorList: unknown[] = [];
  try {
    channel?.end();
  } catch (error) {
    errorList.push(error);
  }
  try {
    sshClient.end();
  } catch (error) {
    errorList.push(error);
  }
  return errorList;
};

const throwCloseErrors = (errorList: unknown[]): void => {
  if (errorList.length > 0) {
    throw new SshSessionOwnershipError(
      'Failed to close all SSH session resources.',
      errorList,
    );
  }
};

export const resolveSshSessionOwnership = async <
  SshClient extends EndableResource,
  SshChannel extends EndableResource,
>({
  sessionId,
  userId,
  state,
  takeOver,
}: {
  sessionId: string;
  userId: number | undefined;
  state: SshSessionOwnershipState<SshClient, SshChannel>;
  takeOver: (
    details: SshSessionTakeoverDetails<SshClient, SshChannel>,
  ) => Promise<string | null>;
}): Promise<SshSessionOwnershipResult> => {
  const sshClient = state.sshClient;
  const channel = state.sshShellStream;

  if (
    state.isMarkedForSuspend
    && sshClient
    && channel
    && state.suspendLogPath
    && userId !== undefined
  ) {
    state.sshClient = undefined;
    state.sshShellStream = undefined;
    state.isSuspendedByService = true;

    let suspendSessionId: string | null;
    try {
      suspendSessionId = await takeOver({
        userId,
        originalSessionId: sessionId,
        sshClient,
        channel,
        connectionName: state.connectionName || '未知连接',
        connectionId: String(state.dbConnectionId),
        logIdentifier: state.suspendLogPath,
        customSuspendName: undefined,
      });
    } catch (error) {
      const closeErrorList = closeResources(sshClient, channel);
      state.isSuspendedByService = false;
      if (closeErrorList.length > 0) {
        throw new SshSessionOwnershipError(
          'SSH session takeover and resource cleanup failed.',
          [error, ...closeErrorList],
        );
      }
      throw error;
    }
    if (suspendSessionId) return 'transferred';

    const closeErrorList = closeResources(sshClient, channel);
    state.isSuspendedByService = false;
    throwCloseErrors(closeErrorList);
    return 'closed';
  }

  if (!state.isSuspendedByService && sshClient) {
    throwCloseErrors(closeResources(sshClient, channel));
    return 'closed';
  }
  return 'unchanged';
};
