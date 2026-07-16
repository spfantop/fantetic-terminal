import WebSocket, { RawData } from 'ws';
import { Request } from 'express';
import { AuthenticatedWebSocket } from '../types';
import { startSessionRecording } from '../../session-recording/session-recording.service';
import { createRemoteDesktopRecordingBridge } from '../remote-desktop-recording';
import { createLogger } from '../../logging/logger';
import { runWithAuditContext } from '../../audit/audit-context';

const logger = createLogger('RemoteDesktopProxy');

type RemoteDesktopRecordingMetadata = {
    connectionId: number;
    protocol?: 'RDP' | 'VNC';
    connectionName?: string;
    requestId?: string;
};

type PendingClientFrame = { data: RawData; isBinary: boolean };

const MAX_PENDING_CLIENT_FRAME_BYTES = 1024 * 1024;

const toBuffer = (data: RawData): Buffer => {
    if (Buffer.isBuffer(data)) return Buffer.from(data);
    if (Array.isArray(data)) return Buffer.concat(data.map(part => Buffer.from(part)));
    return Buffer.from(data);
};

/**
 * The backend proxy is the only in-repository point that sees both directions
 * of the Guacamole protocol. Capture those exact frames; do not label them as
 * browser-playable video because no Guacamole playback adapter is bundled.
 */
export async function handleRdpProxyConnection(
    ws: AuthenticatedWebSocket,
    request: Request,
): Promise<void> {
    const recordingMetadata = (request as any).remoteDesktopRecording as RemoteDesktopRecordingMetadata | undefined;
    if (recordingMetadata?.requestId) {
        return runWithAuditContext({
            requestId: recordingMetadata.requestId,
            sourceIp: (request as any).clientIpAddress || 'unknown',
            ...(ws.userId === undefined ? {} : { actorUserId: ws.userId }),
            ...(ws.username === undefined ? {} : { actorUsername: ws.username }),
            ...(ws.authorization?.systemRole === undefined ? {} : { actorRole: ws.authorization.systemRole }),
        }, () => handleRdpProxyConnectionWithAuditContext(ws, request, recordingMetadata));
    }
    return handleRdpProxyConnectionWithAuditContext(ws, request, recordingMetadata);
}

async function handleRdpProxyConnectionWithAuditContext(
    ws: AuthenticatedWebSocket,
    request: Request,
    recordingMetadata: RemoteDesktopRecordingMetadata | undefined,
): Promise<void> {
    const rdpToken = (request as any).rdpToken as string | undefined;
    const widthValue = (request as any).rdpWidth as string | undefined;
    const heightValue = (request as any).rdpHeight as string | undefined;

    if (!rdpToken || !widthValue || !heightValue || !recordingMetadata?.protocol || !recordingMetadata.connectionName || !ws.userId) {
        ws.close(1008, 'Missing remote desktop recording metadata');
        return;
    }

    const width = Number.parseInt(widthValue, 10);
    const height = Number.parseInt(heightValue, 10);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        ws.close(1008, 'Invalid RDP dimensions');
        return;
    }

    const gatewaySharedSecret = process.env.REMOTE_GATEWAY_SHARED_SECRET;
    if (!gatewaySharedSecret || gatewaySharedSecret.length < 32) {
        ws.close(1011, 'Remote desktop gateway authentication is not configured.');
        return;
    }

    const recording = createRemoteDesktopRecordingBridge({
        start: () => startSessionRecording({
            userId: ws.userId,
            username: ws.username,
            connectionId: recordingMetadata.connectionId,
            connectionName: recordingMetadata.connectionName!,
            protocol: recordingMetadata.protocol!,
        }),
    });
    const pendingClientFrameList: PendingClientFrame[] = [];
    let pendingClientFrameBytes = 0;
    let gatewaySocket: WebSocket | undefined;
    let clientClosed = false;
    let gatewayClosed = false;
    let finalized = false;

    const finishRecording = (incomplete = false): void => {
        if (finalized) return;
        finalized = true;
        void recording.finish({ incomplete }).catch(error => {
            logger.error('远程桌面录屏收尾失败', { connectionId: recordingMetadata.connectionId, error });
        });
    };

    const sendOrQueueClientFrame = (data: RawData, isBinary: boolean): void => {
        recording.recordClient(toBuffer(data));
        if (gatewaySocket?.readyState === WebSocket.OPEN) {
            gatewaySocket.send(data, { binary: isBinary });
            return;
        }
        const size = toBuffer(data).byteLength;
        if (pendingClientFrameBytes + size > MAX_PENDING_CLIENT_FRAME_BYTES) {
            finishRecording(true);
            ws.close(1013, 'Remote desktop recording buffer exceeded');
            return;
        }
        pendingClientFrameList.push({ data, isBinary });
        pendingClientFrameBytes += size;
    };

    // Register before awaiting the SQLite row so no early browser instruction is lost.
    ws.on('message', sendOrQueueClientFrame);
    ws.on('close', () => {
        clientClosed = true;
        finishRecording(false);
        if (!gatewayClosed && gatewaySocket && gatewaySocket.readyState < WebSocket.CLOSING) {
            gatewaySocket.close(1000, 'Client WS Closed');
        }
    });
    ws.on('error', () => {
        clientClosed = true;
        finishRecording(true);
        if (!gatewayClosed && gatewaySocket && gatewaySocket.readyState < WebSocket.CLOSING) {
            gatewaySocket.close(1011, 'Client WS Error');
        }
    });

    try {
        await recording.ready;
    } catch (error) {
        logger.error('无法创建远程桌面录屏索引', { connectionId: recordingMetadata.connectionId, error });
        finishRecording(true);
        ws.close(1011, 'Remote desktop recording unavailable');
        return;
    }
    if (clientClosed || ws.readyState !== WebSocket.OPEN) {
        finishRecording(false);
        return;
    }

    const deploymentMode = process.env.DEPLOYMENT_MODE;
    const gatewayBaseUrl = deploymentMode === 'docker'
        ? (process.env.REMOTE_GATEWAY_WS_URL_DOCKER || 'ws://remote-gateway:8080')
        : (process.env.REMOTE_GATEWAY_WS_URL_LOCAL || 'ws://localhost:8080');
    const cleanGatewayBaseUrl = gatewayBaseUrl.endsWith('/') ? gatewayBaseUrl.slice(0, -1) : gatewayBaseUrl;
    const dpi = width > 1920 ? 120 : 96;
    const targetUrl = `${cleanGatewayBaseUrl}/?token=${encodeURIComponent(rdpToken)}&width=${encodeURIComponent(width)}&height=${encodeURIComponent(height)}&dpi=${dpi}`;
    const requestId = recordingMetadata.requestId;
    logger.info('正在连接远程桌面网关', {
        connectionId: recordingMetadata.connectionId,
        protocol: recordingMetadata.protocol,
        width,
        height,
    });

    gatewaySocket = new WebSocket(targetUrl, {
        headers: {
            'x-fantetic-gateway-secret': gatewaySharedSecret,
            ...(requestId ? { 'x-request-id': requestId } : {}),
        },
    });
    gatewaySocket.on('open', () => {
        for (const frame of pendingClientFrameList.splice(0)) {
            gatewaySocket?.send(frame.data, { binary: frame.isBinary });
        }
        pendingClientFrameBytes = 0;
    });
    gatewaySocket.on('message', (data: RawData, isBinary: boolean) => {
        recording.recordServer(toBuffer(data));
        if (ws.readyState === WebSocket.OPEN) ws.send(data, { binary: isBinary });
    });
    gatewaySocket.on('error', error => {
        gatewayClosed = true;
        logger.error('远程桌面网关连接失败', { connectionId: recordingMetadata.connectionId, error });
        finishRecording(true);
        if (!clientClosed && ws.readyState < WebSocket.CLOSING) ws.close(1011, 'Remote desktop gateway error');
    });
    gatewaySocket.on('close', () => {
        gatewayClosed = true;
        finishRecording(false);
        if (!clientClosed && ws.readyState < WebSocket.CLOSING) ws.close(1000, 'Remote desktop gateway closed');
    });
}
