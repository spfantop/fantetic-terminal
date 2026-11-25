export function readOpenSshErrorKey(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object' || !('code' in payload)) return null;
    switch (payload.code) {
        case 'OPENSSH_RECORDING_REQUIRED': return 'sshAuth.recordingRequired';
        case 'OPENSSH_UNSUPPORTED_CONNECTION': return 'sshAuth.unsupportedConnection';
        case 'OPENSSH_UNAVAILABLE': return 'sshAuth.unavailable';
        default: return null;
    }
}
