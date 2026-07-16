type AxiosLikeError = {
    isAxiosError?: boolean;
    request?: unknown;
    response?: {
        status: number;
    };
};

const isAxiosLikeError = (error: unknown): error is AxiosLikeError => (
    typeof error === 'object'
    && error !== null
    && (error as AxiosLikeError).isAxiosError === true
);

export const resolveRemoteDesktopTokenFailure = (error: unknown): { status: number; code: string } => {
    const message = error instanceof Error ? error.message : '';
    if (isAxiosLikeError(error)) {
        if (error.response) {
            return {
                status: error.response.status >= 500 ? 502 : 400,
                code: error.response.status >= 500
                    ? 'remoteDesktop.gatewayUnavailable'
                    : 'remoteDesktop.gatewayRejected',
            };
        }
        if (error.request) return { status: 504, code: 'remoteDesktop.gatewayTimeout' };
    }
    if (
        message.includes('密码认证')
        || message.includes('密码解密失败')
        || message.includes('连接类型必须是')
    ) {
        return { status: 400, code: 'remoteDesktop.connectionConfigurationInvalid' };
    }
    if (message.includes('调用 ') || message.includes('获取令牌失败')) {
        return { status: 503, code: 'remoteDesktop.gatewayUnavailable' };
    }
    return { status: 500, code: 'remoteDesktop.tokenCreationFailed' };
};
