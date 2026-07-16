import axios from 'axios';
import { ConnectionWithTags } from '../types/connection.types';
import { createLogger } from '../logging/logger';

const logger = createLogger('GuacamoleService');

// 统一远程桌面网关服务的 Base URL
const REMOTE_GATEWAY_API_BASE = process.env.DEPLOYMENT_MODE === 'local'
    ? process.env.REMOTE_GATEWAY_API_BASE_LOCAL || 'http://localhost:9090'
    : process.env.REMOTE_GATEWAY_API_BASE_DOCKER || 'http://remote-gateway:9090';

interface TokenResponse {
    token: string;
}

interface RemoteDesktopDisplayOptions {
    colorDepth?: string;
    forceLossless?: string;
}

/**
 * 从统一远程桌面网关服务获取 Guacamole 令牌
 * @param protocol 'rdp' 或 'vnc'
 * @param connection 连接对象
 * @param decryptedPassword 解密后的密码
 * @param width 宽度
 * @param height 高度
 * @param dpi DPI (主要用于 RDP)
 * @returns Guacamole 令牌
 */
export const getRemoteDesktopToken = async (
    protocol: 'rdp' | 'vnc',
    connection: ConnectionWithTags,
    decryptedPassword?: string,
    width?: number,
    height?: number,
    dpi?: string, // DPI 主要用于 RDP
    displayOptions: RemoteDesktopDisplayOptions = {},
    requestId?: string,
): Promise<string> => {
    const gatewaySharedSecret = process.env.REMOTE_GATEWAY_SHARED_SECRET;
    if (!gatewaySharedSecret || gatewaySharedSecret.length < 32) {
        throw new Error('REMOTE_GATEWAY_SHARED_SECRET 未配置或长度不足。');
    }
    if ((protocol === 'rdp' || protocol === 'vnc') && connection.auth_method === 'password' && !decryptedPassword) {
        logger.warn('远程桌面连接缺少密码认证信息', { protocol, connectionId: connection.id });
        throw new Error(`${protocol.toUpperCase()} 连接使用密码认证，但密码解密失败或未提供密码。`);
    }
    
    const connectionConfig: any = {
        hostname: connection.host,
        port: connection.port.toString(),
        width: String(width || 1024), // 提供默认值
        height: String(height || 768), // 提供默认值
    };
    if (displayOptions.colorDepth) {
        connectionConfig.colorDepth = displayOptions.colorDepth;
    }
    if (displayOptions.forceLossless) {
        connectionConfig.forceLossless = displayOptions.forceLossless;
    }

    if (protocol === 'rdp') {
        if (!connection.username) {
             logger.warn('RDP 连接缺少用户名', { connectionId: connection.id });
             // 对于RDP，用户名通常是必需的，但让网关决定是否可以为空
        }
        connectionConfig.username = connection.username || ''; // RDP 通常需要用户名
        connectionConfig.password = decryptedPassword || ''; // RDP 通常需要密码
        connectionConfig.dpi = dpi || '96';
        connectionConfig.security = (connection as any).rdp_security || 'any';
        connectionConfig.ignoreCert = String((connection as any).rdp_ignore_cert ?? true);
        connectionConfig.resizeMethod = (connection as any).rdp_resize_method || 'display-update';
    } else if (protocol === 'vnc') {
        connectionConfig.password = decryptedPassword || ''; // VNC 通常需要密码
        if (connection.username) { // VNC 用户名是可选的
            connectionConfig.username = connection.username;
        }
        // 其他 VNC 特定参数可以从 connection.extras 获取
        // 例如: if (connection.extras?.enableAudio) connectionConfig.enableAudio = connection.extras.enableAudio;
    }

    const requestBody = {
        protocol,
        connectionConfig
    };

    const tokenUrl = `${REMOTE_GATEWAY_API_BASE}/api/remote-desktop/token`;
    logger.info('正在请求远程桌面网关令牌', { protocol, connectionId: connection.id });

    try {
        const response = await axios.post<TokenResponse>(tokenUrl, requestBody, {
            timeout: 10000,
            headers: {
                'x-fantetic-gateway-secret': gatewaySharedSecret,
                ...(requestId ? { 'x-request-id': requestId } : {}),
            },
        });

        if (response.status !== 200 || !response.data?.token) {
            logger.error('远程桌面网关返回了无效令牌', { protocol, connectionId: connection.id, status: response.status });
            throw new Error(`从 ${protocol.toUpperCase()} 后端获取令牌失败。`);
        }
        logger.info('已取得远程桌面网关令牌', { protocol, connectionId: connection.id });
        return response.data.token;
    } catch (error: any) {
        logger.error('调用远程桌面网关失败', { protocol, connectionId: connection.id, error });
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(`调用 ${protocol.toUpperCase()} 后端服务失败 (状态: ${error.response.status}): ${error.response.data?.message || error.message}`);
        }
        throw new Error(`调用 ${protocol.toUpperCase()} 后端服务时发生错误: ${error.message}`);
    }
};
