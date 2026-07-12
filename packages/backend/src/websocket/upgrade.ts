import http from 'http';
import url from 'url';
import { Request, RequestHandler } from 'express';
import { WebSocketServer } from 'ws';
import { AuthenticatedWebSocket } from './types';
import {
    ELECTRON_APP_USERNAME,
    ELECTRON_APP_USER_ID,
    isElectronAppMode,
    resolveRuntimeCapabilities,
} from '../config/app-mode';
import { ClientIpResolver } from '../config/client-ip';
import { createAuthorizationSubject } from '../access-control/authorization-subject';
import { userRepository } from '../user/user.repository';
import { sessionMatchesAuthenticationEpoch } from '../auth/auth.middleware';

export function initializeUpgradeHandler(
    server: http.Server,
    wss: WebSocketServer,
    sessionParser: RequestHandler,
    clientIpResolver: ClientIpResolver,
): void {
    server.on('upgrade', (request: Request, socket, head) => {
        const parsedUrl = url.parse(request.url || '', true); // Parse URL and query string
        const pathname = parsedUrl.pathname;
        const ipAddress = clientIpResolver.resolve({
            remoteAddress: request.socket.remoteAddress,
            forwardedFor: request.headers['x-forwarded-for'],
        });
        

        console.log(`WebSocket: 升级请求来自 IP: ${ipAddress}, Path: ${pathname}`); // 使用新获取的 ipAddress

        // @ts-ignore Express-session 类型问题
        sessionParser(request, {} as any, async () => {
            let authorization;
            if (isElectronAppMode()) {
                if (!request.session) {
                    request.session = {} as any;
                }
                request.session.userId = ELECTRON_APP_USER_ID;
                request.session.username = ELECTRON_APP_USERNAME;
                request.session.requiresTwoFactor = false;
                authorization = createAuthorizationSubject({ runtime: 'desktop' });
            } else if (request.session?.userId) {
                const user = await userRepository.findUserById(request.session.userId);
                authorization = user && sessionMatchesAuthenticationEpoch(request.session.authEpoch, user.auth_epoch)
                  ? createAuthorizationSubject({
                    runtime: 'web',
                    userId: user.id,
                    username: user.username,
                    systemRole: user.system_role,
                    status: user.status,
                  }) : null;
            }

            // --- 认证检查 ---
            if (!request.session || !request.session.userId || !authorization) {
                console.log(`WebSocket 认证失败 (Path: ${pathname})：未找到会话或用户未登录。`);
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }
            console.log(`WebSocket 认证成功 (Path: ${pathname})：用户 ${request.session.username} (ID: ${request.session.userId})`);

            // --- 根据路径处理升级 ---
            // 本地调试用/rdp-proxy，nginx反代用/ws/rdp-proxy
            if (pathname === '/rdp-proxy' || pathname === '/ws/rdp-proxy') {
                if (!resolveRuntimeCapabilities().remoteDesktop) {
                    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
                    socket.destroy();
                    return;
                }
                // RDP 代理路径 - 直接处理升级，连接逻辑在 'connection' 事件中处理
                console.log(`WebSocket: Handling RDP proxy upgrade for user ${request.session.username}`);
                wss.handleUpgrade(request, socket, head, (ws) => {
                    const extWs = ws as AuthenticatedWebSocket;
                    extWs.userId = request.session.userId;
                    extWs.username = request.session.username;
                    extWs.authorization = authorization;
                    request.authorization = authorization;
                    // 传递必要信息给 connection 事件
                    (request as any).clientIpAddress = ipAddress;
                    (request as any).isRdpProxy = true; // 标记为 RDP 代理连接
                    // 传递 RDP token 和其他参数
                    (request as any).rdpToken = parsedUrl.query.token;
                    (request as any).rdpWidth = parsedUrl.query.width;
                    (request as any).rdpHeight = parsedUrl.query.height;
                    (request as any).rdpDpi = parsedUrl.query.dpi;
                    wss.emit('connection', extWs, request);
                });
            } else {
                // 默认路径 (SSH, SFTP, Docker etc.) - 按原逻辑处理
                console.log(`WebSocket: Handling standard upgrade for user ${request.session.username}`);
                wss.handleUpgrade(request, socket, head, (ws) => {
                    const extWs = ws as AuthenticatedWebSocket;
                    extWs.userId = request.session.userId;
                    extWs.username = request.session.username;
                    extWs.authorization = authorization;
                    request.authorization = authorization;
                    (request as any).clientIpAddress = ipAddress;
                    (request as any).isRdpProxy = false; // 标记为非 RDP 代理连接
                    wss.emit('connection', extWs, request);
                });
            }
        });
    });
    console.log('WebSocket upgrade handler initialized.');
}
