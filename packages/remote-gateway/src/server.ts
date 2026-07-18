// @ts-ignore - Still need this for the import as no types exist
import GuacamoleLite from 'guacamole-lite';
import express, { Request, Response } from 'express';
import http from 'http';
import crypto from 'crypto';
import {
    bindGatewayReadinessLifecycle,
    createGatewayReadiness,
    createHealthSnapshot,
    isGuacdReachable,
} from './health';
import { createGatewayTokenClaims, GatewayTokenReplayGuard, isAuthorizedGatewayRequest } from './security';
import { encryptGatewayToken } from './token';
import { createGatewayLogger } from './logging';

const logger = createGatewayLogger('RemoteGateway');

// --- 配置 ---
const REMOTE_GATEWAY_WS_PORT = process.env.REMOTE_GATEWAY_WS_PORT || 8080; // 统一端口，或按需分开
const REMOTE_GATEWAY_API_PORT = process.env.REMOTE_GATEWAY_API_PORT || 9090;
const GUACD_HOST = process.env.GUACD_HOST || 'localhost';
const GUACD_PORT = parseInt(process.env.GUACD_PORT || '4822', 10);
const GATEWAY_SHARED_SECRET = process.env.REMOTE_GATEWAY_SHARED_SECRET || '';
if (GATEWAY_SHARED_SECRET.length < 32) {
    throw new Error('REMOTE_GATEWAY_SHARED_SECRET must contain at least 32 characters.');
}

// --- 启动时生成内存加密密钥 ---
logger.info('正在为此会话生成新的内存加密密钥');
const ENCRYPTION_KEY_STRING = crypto.randomBytes(32).toString('hex');
const ENCRYPTION_KEY_BUFFER = Buffer.from(ENCRYPTION_KEY_STRING, 'hex');
logger.info('内存加密密钥已生成');

// --- Express 应用设置 ---
const app = express();
app.use(express.json({ limit: '32kb' }));
const apiServer = http.createServer(app);


const guacdOptions = {
    host: GUACD_HOST,
    port: GUACD_PORT,
};

const websocketOptions = {
    port: REMOTE_GATEWAY_WS_PORT,
    host: '0.0.0.0', // 监听所有接口
    verifyClient: ({ req }: { req: http.IncomingMessage }) => {
        const requestId = readGatewayRequestId(req);
        const authorized = isAuthorizedGatewayRequest(
            typeof req.headers['x-fantetic-gateway-secret'] === 'string'
            ? req.headers['x-fantetic-gateway-secret']
            : undefined,
            GATEWAY_SHARED_SECRET,
        );
        if (authorized) {
            logger.info('远程桌面 WebSocket 已授权', requestId ? { requestId } : {});
        } else {
            logger.warn('远程桌面 WebSocket 鉴权失败', requestId ? { requestId } : {});
        }
        return authorized;
    },
};

const clientOptions = {
    // guacamole-lite DEBUG logs include raw protocol frames. Keep the library at
    // error-only level so encrypted recording data and remote desktop content
    // never reach ordinary process logs.
    log: {
        level: 'ERRORS',
    },
    crypt: {
        key: ENCRYPTION_KEY_BUFFER,
        cypher: 'aes-256-gcm'
    },
    // 默认连接设置将根据协议动态调整
    connectionDefaultSettings: {},
};

let guacServer: any;
const gatewayReadiness = createGatewayReadiness();
const tokenReplayGuard = new GatewayTokenReplayGuard();
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

type RemoteDesktopConnectionConfig = Record<string, string | number | boolean | null | undefined>;

function readGatewayRequestId(req: Pick<http.IncomingMessage, 'headers'>): string | undefined {
    const header = req.headers['x-request-id'];
    const candidate = (Array.isArray(header) ? header[0] : header)?.trim();
    return candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : undefined;
}

const readConfigValue = (connectionConfig: RemoteDesktopConnectionConfig, ...keys: string[]): string | undefined => {
    for (const key of keys) {
        const value = connectionConfig[key];
        if (value === null || typeof value === 'undefined' || value === '') {
            continue;
        }
        return String(value);
    }
    return undefined;
};

const logRemoteDesktopSettingsSnapshot = (
    protocol: 'rdp' | 'vnc',
    settings: Record<string, unknown>,
    requestId?: string,
) => {
    const safeKeys = protocol === 'rdp'
        ? ['width', 'height', 'dpi', 'security', 'ignore-cert', 'color-depth', 'force-lossless', 'resize-method', 'disable-gfx', 'enable-wallpaper']
        : ['width', 'height', 'color-depth', 'force-lossless'];
    const snapshot = safeKeys.reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : '(omitted)';
        return acc;
    }, {});
    logger.info('guacd 参数快照', { protocol, settings: snapshot, ...(requestId ? { requestId } : {}) });
};

try {
    logger.info('正在初始化 GuacamoleLite', { websocketPort: websocketOptions.port, guacdHost: guacdOptions.host, guacdPort: guacdOptions.port });
    guacServer = new GuacamoleLite(websocketOptions, guacdOptions, clientOptions, {
        processConnectionSettings: (settings: any, callback: (error?: Error, value?: any) => void) => {
            try {
                tokenReplayGuard.consume({ expiresAt: settings.expiresAt, nonce: settings.nonce });
                delete settings.expiresAt;
                delete settings.nonce;
                callback(undefined, settings);
            } catch (error) {
                callback(error instanceof Error ? error : new Error('Invalid gateway token.'));
            }
        },
    });
    gatewayReadiness.markReady();
    logger.info('GuacamoleLite 初始化成功');

    if (guacServer.on) {
        bindGatewayReadinessLifecycle(guacServer, gatewayReadiness);
        guacServer.on('error', (error: Error) => {
            logger.error('GuacamoleLite 服务器错误', { error });
        });
        guacServer.on('close', () => {
            logger.warn('GuacamoleLite 服务器已关闭');
        });
        guacServer.on('connection', (client: any) => {
            const clientId = client.id || '未知客户端ID';
            logger.info('Guacd 连接已建立', { clientId });

            if (client && typeof client.on === 'function') {
                client.on('disconnect', () => {
                    logger.info('Guacd 连接已断开', { clientId });
                });
                client.on('error', (err: Error) => {
                     logger.error('Guacd 客户端错误', { clientId, error: err });
                });
            }
        });
   }
} catch (error) {
   logger.error('GuacamoleLite 初始化失败', { error });
   process.exit(1);
}

app.get('/health/live', (_req: Request, res: Response): void => {
    res.status(200).json({ status: 'alive' });
});

app.get(['/health', '/health/ready'], async (_req: Request, res: Response): Promise<void> => {
    const guacdReachable = gatewayReadiness.isReady()
        && await isGuacdReachable({ host: GUACD_HOST, port: GUACD_PORT });
    const snapshot = createHealthSnapshot({ guacamoleReady: guacdReachable });
    res.status(guacdReachable ? 200 : 503).json(snapshot);
});

const requireBackendAuthentication = (req: Request, res: Response, next: () => void): void => {
    const provided = req.get('x-fantetic-gateway-secret');
    if (!isAuthorizedGatewayRequest(provided, GATEWAY_SHARED_SECRET)) {
        res.status(401).json({ error: 'Unauthorized gateway request.' });
        return;
    }
    next();
};

app.post('/api/remote-desktop/token', requireBackendAuthentication, (req: Request, res: Response): void => {
    const requestId = readGatewayRequestId(req);
    const { protocol, connectionConfig } = req.body;

    if (!protocol || !connectionConfig) {
        res.status(400).json({ error: '缺少必需的参数 (protocol, connectionConfig)' });
        return;
    }

    if (protocol !== 'rdp' && protocol !== 'vnc') {
        res.status(400).json({ error: '无效的协议类型。支持 "rdp" 或 "vnc"。' });
        return;
    }

    const { hostname, port, username, password, width, height, dpi, security } = connectionConfig;

    if (!hostname || !port) {
        res.status(400).json({ error: '缺少必需的连接参数 (hostname, port)' });
        return;
    }

    let settings: any = {
        hostname: hostname as string,
        port: port as string,
        width: String(width || '1024'),
        height: String(height || '768'),
    };

    if (protocol === 'rdp') {
        if (typeof username === 'undefined' || typeof password === 'undefined') {
            res.status(400).json({ error: 'RDP 连接缺少 username 或 password' });
            return;
        }
        settings.username = username as string;
        settings.password = password as string;
        settings.security = security || 'any'; // RDP 特有，使用默认值 'any'
        settings['ignore-cert'] = readConfigValue(connectionConfig, 'ignoreCert', 'ignore-cert') || 'true'; // RDP 特有
        settings.dpi = String(dpi || '96'); // RDP 特有
        settings['color-depth'] = readConfigValue(connectionConfig, 'colorDepth', 'color-depth') || '24';
        settings['force-lossless'] = readConfigValue(connectionConfig, 'forceLossless', 'force-lossless') || 'false';
        const resizeMethod = readConfigValue(connectionConfig, 'resizeMethod', 'resize-method');
        if (resizeMethod) {
            settings['resize-method'] = resizeMethod;
        }
        settings['disable-gfx'] = readConfigValue(connectionConfig, 'disableGfx', 'disable-gfx') || 'true';
        settings['enable-wallpaper'] = readConfigValue(connectionConfig, 'enableWallpaper', 'enable-wallpaper') || 'false';
    } else if (protocol === 'vnc') {
        if (typeof password === 'undefined') {
            res.status(400).json({ error: 'VNC 连接缺少 password' });
            return;
        }
        settings.password = password as string;
        if (username) { // VNC 可选 username
            settings.username = username as string;
        }
        settings['color-depth'] = readConfigValue(connectionConfig, 'colorDepth', 'color-depth') || '24';
        settings['force-lossless'] = readConfigValue(connectionConfig, 'forceLossless', 'force-lossless') || 'false';
    }

    logRemoteDesktopSettingsSnapshot(protocol, settings, requestId);

    const connectionParams = {
        ...createGatewayTokenClaims(),
        connection: {
            type: protocol, // 'rdp' or 'vnc'
            settings: settings
        }
    };

    try {
        const tokenData = JSON.stringify(connectionParams);
        const encryptedToken = encryptGatewayToken(tokenData, ENCRYPTION_KEY_BUFFER);
        logger.info('远程桌面令牌已签发', { protocol, ...(requestId ? { requestId } : {}) });
        res.json({ token: encryptedToken });
    } catch (error) {
        logger.error('远程桌面令牌生成失败', { ...(requestId ? { requestId } : {}), error });
        res.status(500).json({ error: '生成令牌失败' });
    }
});

apiServer.listen(REMOTE_GATEWAY_API_PORT, () => {
    logger.info('API 服务器正在监听', { apiPort: REMOTE_GATEWAY_API_PORT, websocketPort: REMOTE_GATEWAY_WS_PORT });
});

const gracefulShutdown = (signal: string) => {
    logger.info('收到关闭信号，开始优雅关闭', { signal });

  gatewayReadiness.markUnavailable();
  let guacClosed = false;
  let apiClosed = false;

  const tryExit = () => {
    if (guacClosed && apiClosed) {
      logger.info('所有服务器已关闭，正在退出');
      process.exit(0);
    }
  };

  apiServer.close((err) => {
    if (err) {
        logger.error('关闭 API 服务器时出错', { error: err });
    } else {
        logger.info('API 服务器已关闭');
    }
    apiClosed = true;
    tryExit();
  });

  if (typeof guacServer !== 'undefined' && guacServer && typeof guacServer.close === 'function') {
    logger.info('正在关闭 Guacamole 服务器');
    guacServer.close(() => {
        logger.info('Guacamole 服务器已关闭');
        guacClosed = true;
        tryExit();
    });
  } else {
    logger.info('Guacamole 服务器未运行或不支持 close 方法');
    guacClosed = true;
    tryExit();
  }

  setTimeout(() => {
    logger.error('关闭超时，强制退出');
    process.exit(1);
  }, 10000); // 10 秒超时
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGUSR2', () => {
    gracefulShutdown('SIGUSR2 (nodemon restart)');
});
