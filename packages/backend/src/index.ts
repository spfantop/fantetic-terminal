import dotenv from 'dotenv';
import path from 'path';

import { ensureAndGetPathInAppData, getAppDataPath, initializeAppDataPath } from './config/app-data-path';

initializeAppDataPath();

// --- 开始环境变量的早期加载 ---
// 1. 加载根目录的 .env 文件 (定义部署模式等)
// 注意: __dirname 在 dist/src 中，所以需要回退三级到项目根目录
const projectRootEnvPath = path.resolve(__dirname, '../../../.env');
const rootConfigResult = dotenv.config({ path: projectRootEnvPath });

if (rootConfigResult.error && (rootConfigResult.error as NodeJS.ErrnoException).code !== 'ENOENT') {
    console.warn(`[ENV Init Early] Warning: Could not load root .env file from ${projectRootEnvPath}. Error: ${rootConfigResult.error.message}`);
} else if (!rootConfigResult.error) {
    console.log(`[ENV Init Early] Loaded environment variables from root .env file: ${projectRootEnvPath}`);
} else {
    console.log(`[ENV Init Early] Root .env file not found at ${projectRootEnvPath}, proceeding without it.`);
}

// 2. 加载 data/.env 文件 (定义密钥等)
const dataEnvPathGlobal = path.join(getAppDataPath(), '.env'); // Renamed to avoid conflict if 'dataEnvPath' is used later
const dataConfigResultGlobal = dotenv.config({ path: dataEnvPathGlobal }); // Renamed

if (dataConfigResultGlobal.error && (dataConfigResultGlobal.error as NodeJS.ErrnoException).code !== 'ENOENT') {
    console.warn(`[ENV Init Early] Warning: Could not load data .env file from ${dataEnvPathGlobal}. Error: ${dataConfigResultGlobal.error.message}`);
} else if (!dataConfigResultGlobal.error) {
     console.log(`[ENV Init Early] Loaded environment variables from data .env file: ${dataEnvPathGlobal}`);
}


import express = require('express');
import { Request, Response, NextFunction, RequestHandler } from 'express';
import http from 'http';
import cors from 'cors';
import { WebSocketServer } from 'ws';


import session from 'express-session';
import sessionFileStore from 'session-file-store';
import { closeDbInstance, getDbInstance } from './database/connection';
import authRouter from './auth/auth.routes';
import connectionsRouter from './connections/connections.routes';
import versionRouter from './version/version.routes';
import sftpRouter from './sftp/sftp.routes';
import proxyRoutes from './proxies/proxies.routes';
import tagsRouter from './tags/tags.routes';
import settingsRoutes from './settings/settings.routes';
import notificationRoutes from './notifications/notification.routes';
import auditRoutes from './audit/audit.routes';
import sessionRecordingRoutes from './session-recording/session-recording.routes';
import { markInterruptedSessionRecordings } from './session-recording/session-recording.repository';
import commandHistoryRoutes from './command-history/command-history.routes';
import quickCommandsRoutes from './quick-commands/quick-commands.routes';
import terminalThemeRoutes from './terminal-themes/terminal-theme.routes';
import appearanceRoutes from './appearance/appearance.routes';
import sshKeysRouter from './ssh_keys/ssh_keys.routes'; 
import quickCommandTagRoutes from './quick-command-tags/quick-command-tag.routes'; 
import sshSuspendRouter from './ssh-suspend/ssh-suspend.routes';
import { transfersRoutes } from './transfers/transfers.routes';
import pathHistoryRoutes from './path-history/path-history.routes';
import favoritePathsRouter from './favorite-paths/favorite-paths.routes';
import aiRoutes from './ai-ops/ai.routes';
import { initializeWebSocket } from './websocket';
import { ipWhitelistMiddleware } from './auth/ipWhitelist.middleware';
import { isCorsOriginAllowed, parseCorsOrigins, readForwardedHost } from './config/cors-origin';
import { resolveServerBinding } from './config/server-binding';
import { createClientIpResolver } from './config/client-ip';
import accessControlRouter from './access-control/access-control.routes';
import { initializeRuntimeSecrets } from './config/runtime-secrets';
import { installProcessLifecycle } from './config/process-lifecycle';
import { auditContextMiddleware } from './audit/audit-context';
import backupRouter from './backup/backup.routes';
import { applyScheduledRestore } from './backup/backup.service';
import { createLogger } from './logging/logger';
import { apiErrorHandler, securityHeaders, validateJsonComplexity, validateMutationOrigin } from './security/web-security.middleware';


import './services/event.service'; 
import './notifications/notification.processor.service'; 
import './notifications/notification.dispatcher.service'; 

const logger = createLogger('Application');



// 基础 Express 应用设置
const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);
const clientIpResolver = createClientIpResolver();

// --- 信任代理设置 ---
app.set('trust proxy', (address: string) => clientIpResolver.isTrustedProxy(address));

// --- 中间件 ---
app.use(ipWhitelistMiddleware as RequestHandler);
app.use(securityHeaders);
app.use(express.json({ limit: '100kb', strict: true }));
app.use(validateJsonComplexity({ maxDepth: 20, maxKeys: 2_000, maxStringLength: 65_536 }));

const allowedCorsOrigins = parseCorsOrigins(
    process.env.RP_ORIGIN || 'http://localhost:5173',
    process.env.CORS_ALLOWED_ORIGINS,
    'http://localhost:22457',
);

app.use(cors((req, callback) => {
    const requestHost = readForwardedHost(req.get('x-forwarded-host')) || req.get('host');
    const requestOrigin = requestHost ? `${req.protocol}://${requestHost}` : undefined;
    const origin = req.get('origin');

    callback(null, {
        origin: isCorsOriginAllowed(origin, allowedCorsOrigins, requestOrigin),
        credentials: true,
    });
}));
app.use('/api/v1', validateMutationOrigin(allowedCorsOrigins));

// --- 静态文件服务 ---
const uploadsPath = ensureAndGetPathInAppData('uploads');
// app.use('/uploads', express.static(uploadsPath)); // 不再需要，文件通过 API 提供


// 扩展 Express Request 类型
declare module 'express-session' {
    interface SessionData {
        userId?: number;
        username?: string;
    }
}

const serverBinding = resolveServerBinding({
    appMode: process.env.FANTETIC_APP_MODE,
    host: process.env.HOST,
    port: process.env.PORT,
});

// 初始化数据库
const initializeDatabase = async () => {
  try {
    const db = await getDbInstance();
    console.log('[Index] 正在检查用户数量...');
    const userCount = await new Promise<number>((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM users', (err: Error | null, row: { count: number }) => {
        if (err) {
          console.error('检查 users 表时出错:', err.message);
          return reject(err);
        }
        resolve(row.count);
      });
    });
    console.log(`[Index] 用户数量检查完成。找到 ${userCount} 个用户。`);
  } catch (error) {
    console.error('数据库初始化或检查失败:', error);
    throw error;
  }
};

// 启动服务器
const startServer = async (): Promise<WebSocketServer> => {
    // --- 会话中间件配置 ---
    const FileStore = sessionFileStore(session);
    const sessionsPath = ensureAndGetPathInAppData('sessions');
    const sessionMiddleware = session({
        store: new FileStore({
            path: sessionsPath,
            ttl: 30 * 24 * 60 * 60,
            // logFn: console.log // 可选：启用详细日志
        }),
        // 直接从 process.env 读取，initializeEnvironment 已确保其存在
        secret: process.env.SESSION_SECRET as string,
        resave: false,
        saveUninitialized: false,
        proxy: true, // 信任反向代理设置的 X-Forwarded-Proto 头
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production' && process.env.FANTETIC_APP_MODE !== 'electron',
        }
    });
    app.use(sessionMiddleware);
    app.use(auditContextMiddleware);
    // --- 结束会话中间件配置 ---


    // --- 应用 API 路由 ---
    app.use('/api/v1/auth', authRouter);
    app.use('/api/v1/connections', connectionsRouter);
    app.use('/api/v1/version', versionRouter);
    app.use('/api/v1/sftp', sftpRouter);
    app.use('/api/v1/proxies', proxyRoutes);
    app.use('/api/v1/tags', tagsRouter);
    app.use('/api/v1/settings', settingsRoutes);
    app.use('/api/v1/notifications', notificationRoutes);
    app.use('/api/v1/audit-logs', auditRoutes);
    app.use('/api/v1/command-history', commandHistoryRoutes);
    app.use('/api/v1/quick-commands', quickCommandsRoutes);
    app.use('/api/v1/terminal-themes', terminalThemeRoutes);
    app.use('/api/v1/appearance', appearanceRoutes);
    app.use('/api/v1/ssh-keys', sshKeysRouter); 
    app.use('/api/v1/quick-command-tags', quickCommandTagRoutes);
    app.use('/api/v1/ssh-suspend', sshSuspendRouter); 
    app.use('/api/v1/transfers', transfersRoutes());
    app.use('/api/v1/path-history', pathHistoryRoutes);
    app.use('/api/v1/favorite-paths', favoritePathsRouter);
    app.use('/api/v1/ai', aiRoutes);
    app.use('/api/v1/access-control', accessControlRouter);
    app.use('/api/v1/backups', backupRouter);
    app.use('/api/v1/session-recordings', sessionRecordingRoutes);
    
    // 状态检查接口
    app.get('/api/v1/status', (req: Request, res: Response) => {
      res.json({ status: '后端服务运行中！' });
    });
    app.use('/api/v1', apiErrorHandler);
    // --- 结束 API 路由 ---


    await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once('error', onError);
        server.listen(serverBinding.port, serverBinding.host, () => {
            server.off('error', onError);
            resolve();
        });
    });
    const webSocketServer = await initializeWebSocket(server, sessionMiddleware as RequestHandler, clientIpResolver, allowedCorsOrigins);
    console.log(`后端服务器正在监听 http://${serverBinding.host}:${serverBinding.port}`);
    return webSocketServer;
};

let webSocketServer: WebSocketServer | null = null;
let shutdownPromise: Promise<void> | null = null;

const closeWebSocketServer = async (): Promise<void> => {
    if (!webSocketServer) return;
    const current = webSocketServer;
    webSocketServer = null;
    current.clients.forEach(client => client.terminate());
    await new Promise<void>((resolve, reject) => current.close(error => error ? reject(error) : resolve()));
};

const closeHttpServer = async (): Promise<void> => {
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
};

const shutdown = (reason: string): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
        console.log(`[Lifecycle] 正在关闭服务，原因: ${reason}`);
        await closeWebSocketServer();
        await closeHttpServer();
        await closeDbInstance();
        console.log('[Lifecycle] 服务已安全关闭。');
    })();
    return shutdownPromise;
};

installProcessLifecycle({
    process,
    shutdown,
    logError: error => console.error('[Lifecycle] 致命错误:', error),
});

// --- 主程序启动流程 ---
const main = async () => {
    const secrets = initializeRuntimeSecrets(dataEnvPathGlobal);
    if (secrets.generated) {
        console.warn(`[ENV Init] 已为当前运行模式生成并安全保存缺失密钥到 ${dataEnvPathGlobal}`);
    }
    const restoredBackupId = await applyScheduledRestore(getAppDataPath());
    if (restoredBackupId) console.warn(`[Backup] 已在数据库启动前恢复备份 ${restoredBackupId}。`);
    await initializeDatabase();   // 然后初始化数据库
    const interruptedRecordingCount = await markInterruptedSessionRecordings();
    if (interruptedRecordingCount > 0) {
        logger.warn('检测到异常中断的会话录像', { interruptedRecordingCount });
    }
    webSocketServer = await startServer();
};

main().catch(async error => {
    console.error("启动过程中发生未处理的错误:", error);
    process.exitCode = 1;
    await shutdown('startupFailure').catch(shutdownError => {
        console.error('[Lifecycle] 启动失败后的资源清理也失败:', shutdownError);
    });
});
