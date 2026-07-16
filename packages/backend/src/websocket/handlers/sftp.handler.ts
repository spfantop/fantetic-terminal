import { AuthenticatedWebSocket } from '../types';
import { clientStates, sftpService } from '../state';
import WebSocket from 'ws';
import { createLogger } from '../../logging/logger';

const logger = createLogger('SftpWebSocketHandler');

export async function handleSftpOperation(
    ws: AuthenticatedWebSocket,
    type: string,
    payload: any,
    requestId?: string
): Promise<void> {
    const sessionId = ws.sessionId;
    const state = sessionId ? clientStates.get(sessionId) : undefined;

    if (!sessionId || !state) {
        logger.warn('收到 SFTP 请求但无活动会话', { userId: ws.userId, operation: type, requestId });
        const errPayload: { message: string; requestId?: string } = { message: '无效的会话' };
        if (requestId) errPayload.requestId = requestId;
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sftp_error', payload: errPayload }));
        return;
    }
    if (!requestId) {
        logger.warn('收到 SFTP 请求但缺少请求标识', { userId: ws.userId, sessionId, operation: type });
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sftp_error', payload: { message: `SFTP 操作 ${type} 缺少 requestId` } }));
        return;
    }

    try {
        switch (type) {
            case 'sftp:readdir':
                if (payload?.path) sftpService.readdir(sessionId, payload.path, requestId);
                else throw new Error("Missing 'path' in payload for readdir");
                break;
            case 'sftp:stat':
                if (payload?.path) sftpService.stat(sessionId, payload.path, requestId);
                else throw new Error("Missing 'path' in payload for stat");
                break;
            case 'sftp:readfile':
                if (payload?.path) {
                    const requestedEncoding = payload?.encoding;
                    sftpService.readFile(sessionId, payload.path, requestId, requestedEncoding);
                } else {
                    throw new Error("Missing 'path' in payload for readfile");
                }
                break;
            case 'sftp:writefile':
                const fileContent = payload?.content ?? payload?.data ?? '';
                const encoding = payload?.encoding;
                if (payload?.path) {
                    let dataToSend = (typeof fileContent === 'string') ? fileContent : '';
                    // Convert only true line endings (CRLF and standalone CR not followed by LF) to LF to ensure Unix-compatible line endings
                    dataToSend = dataToSend.replace(/\r\n/g, '\n').replace(/\r(?!\n)/g, '\n');
                    sftpService.writefile(sessionId, payload.path, dataToSend, requestId, encoding);
                } else throw new Error("Missing 'path' in payload for writefile");
                break;
            case 'sftp:mkdir':
                 if (payload?.path) sftpService.mkdir(sessionId, payload.path, requestId);
                 else throw new Error("Missing 'path' in payload for mkdir");
                 break;
            case 'sftp:rmdir':
                 if (payload?.path) sftpService.rmdir(sessionId, payload.path, requestId);
                 else throw new Error("Missing 'path' in payload for rmdir");
                 break;
            case 'sftp:unlink':
                 if (payload?.path) sftpService.unlink(sessionId, payload.path, requestId);
                 else throw new Error("Missing 'path' in payload for unlink");
                 break;
            case 'sftp:rename':
                 if (payload?.oldPath && payload?.newPath) sftpService.rename(sessionId, payload.oldPath, payload.newPath, requestId);
                 else throw new Error("Missing 'oldPath' or 'newPath' in payload for rename");
                 break;
            case 'sftp:chmod':
                 if (payload?.path && typeof payload?.mode === 'number') sftpService.chmod(sessionId, payload.path, payload.mode, requestId);
                 else throw new Error("Missing 'path' or invalid 'mode' in payload for chmod");
                 break;
            case 'sftp:realpath':
                if (payload?.path) sftpService.realpath(sessionId, payload.path, requestId);
                else throw new Error("Missing 'path' in payload for realpath");
                break;
            case 'sftp:copy':
                if (Array.isArray(payload?.sources) && payload?.destination) {
                    sftpService.copy(sessionId, payload.sources, payload.destination, requestId);
                } else throw new Error("Missing 'sources' (array) or 'destination' in payload for copy");
                break;
            case 'sftp:move':
                 if (Array.isArray(payload?.sources) && payload?.destination) {
                    sftpService.move(sessionId, payload.sources, payload.destination, requestId);
                } else throw new Error("Missing 'sources' (array) or 'destination' in payload for move");
                break;
            case 'sftp:compress':
                if (Array.isArray(payload?.sources) && payload?.destination && payload?.format && requestId) {
                    const destinationPath = payload.destination as string;
                    // 从 destinationPath 中提取 targetDirectory 和 destinationArchiveName
                    // pathModule.posix 总是使用 / 作为分隔符
                    const pathModule = await import('path'); // 动态导入 path 模块
                    const targetDirectory = pathModule.posix.dirname(destinationPath);
                    const destinationArchiveName = pathModule.posix.basename(destinationPath);

                    const compressPayload = {
                        sources: payload.sources as string[],
                        destinationArchiveName: destinationArchiveName,
                        format: payload.format as 'zip' | 'targz' | 'tarbz2',
                        targetDirectory: targetDirectory,
                        requestId: requestId
                    };
                    sftpService.compress(sessionId, compressPayload);
                } else throw new Error("Missing 'sources' (array), 'destination', 'format', or 'requestId' in payload for compress");
                break;
            case 'sftp:decompress':
                if (payload?.source && requestId) {
                    const decompressPayload = {
                        archivePath: payload.source as string,
                        // destinationDirectory: payload.destination as string, // sftpService.decompress 目前不使用此参数
                        requestId: requestId
                    };
                    sftpService.decompress(sessionId, decompressPayload);
                } else throw new Error("Missing 'source' or 'requestId' in payload for decompress");
                break;
            default:
                logger.warn('收到未处理的 SFTP 操作', { userId: ws.userId, sessionId, operation: type, requestId });
                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sftp_error', payload: { message: `内部未处理的 SFTP 类型: ${type}`, requestId } }));
                throw new Error(`Unhandled SFTP type: ${type}`);
        }
    } catch (sftpCallError: any) {
         logger.error('调用 SFTP 服务失败', { userId: ws.userId, sessionId, operation: type, requestId, error: sftpCallError });
         if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sftp_error', payload: { message: `处理 SFTP 请求 ${type} 时出错: ${sftpCallError.message}`, requestId } }));
    }
}

export function handleSftpUploadStart(ws: AuthenticatedWebSocket, payload: any): void {
    const sessionId = ws.sessionId;
    const state = sessionId ? clientStates.get(sessionId) : undefined;

    if (!sessionId || !state) {
        logger.warn('收到 SFTP 上传开始请求但无活动会话', { userId: ws.userId, uploadId: payload?.uploadId });
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId: payload?.uploadId, message: '无效的会话' } }));
        return;
    }
    if (!payload?.uploadId || !payload?.remotePath || typeof payload?.size !== 'number') {
        logger.warn('SFTP 上传开始请求参数不完整', { userId: ws.userId, sessionId, uploadId: payload?.uploadId });
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId: payload?.uploadId, message: '缺少 uploadId, remotePath 或 size' } }));
        return;
    }
    const relativePath = payload?.relativePath;
    logger.info('已开始 SFTP 上传', { userId: ws.userId, sessionId, uploadId: payload.uploadId, byteLength: payload.size });
    sftpService.startUpload(sessionId, payload.uploadId, payload.remotePath, payload.size, relativePath);
}

export async function handleSftpUploadChunk(ws: AuthenticatedWebSocket, payload: any): Promise<void> {
    const sessionId = ws.sessionId;
    const state = sessionId ? clientStates.get(sessionId) : undefined;
    if (!sessionId || !state) return; // Silently ignore if session is gone

     if (!payload?.uploadId || typeof payload?.chunkIndex !== 'number' || typeof payload?.data !== 'string') {
        logger.warn('SFTP 上传分片参数不完整', { userId: ws.userId, sessionId, uploadId: payload?.uploadId, chunkIndex: payload?.chunkIndex });
        // Optionally send error to client, but be mindful of flooding for many chunks
        return;
    }
    await sftpService.handleUploadChunk(sessionId, payload.uploadId, payload.chunkIndex, payload.data, payload.byteLength, payload.isLast);
}

export function handleSftpUploadCancel(ws: AuthenticatedWebSocket, payload: any): void {
    const sessionId = ws.sessionId;
    const state = sessionId ? clientStates.get(sessionId) : undefined;
    if (!sessionId || !state) return; // Silently ignore

     if (!payload?.uploadId) {
        logger.warn('SFTP 上传取消请求缺少上传标识', { userId: ws.userId, sessionId });
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId: payload?.uploadId, message: '缺少 uploadId' } }));
        return;
    }
    sftpService.cancelUpload(sessionId, payload.uploadId);
}
