import { Client, SFTPWrapper, Stats, WriteStream } from 'ssh2';
import { WebSocket } from 'ws';
import { ClientState, AuthenticatedWebSocket } from '../websocket/types';
import * as pathModule from 'path'; 
import * as jschardet from 'jschardet'; 
import * as iconv from 'iconv-lite';
import { createLogger } from '../logging/logger';
import { quotePosixShellArgument } from '../utils/posix-shell-quote';
import { SftpRemoteFileOperations } from './sftp-remote-file-operations.service';
// +++ 导入新类型 +++
import {
    SftpCompressRequestPayload,
    SftpCompressSuccessPayload,
    SftpCompressErrorPayload,
    SftpDecompressRequestPayload,
    SftpDecompressSuccessPayload,
    SftpDecompressErrorPayload
} from '../websocket/types';

// Interface for tracking active uploads
interface ActiveUpload {
    remotePath: string;
    totalSize: number;
    bytesWritten: number;
    stream: WriteStream;
    sessionId: string; // Link back to the session for cleanup
    relativePath?: string;
    drainPromise?: Promise<void> | null; // +++ For managing drain event listeners +++
    chunkQueue: Promise<void>;
    expectedChunkIndex: number;
    lastProgressSentAt: number;
}

const UPLOAD_PROGRESS_THROTTLE_MS = 150;
const MAX_SFTP_COMMAND_STDERR_LENGTH = 16 * 1024;
const logger = createLogger('SftpService');

const appendSftpCommandStderr = (output: string, data: Buffer): string => {
    if (output.length >= MAX_SFTP_COMMAND_STDERR_LENGTH) return output;
    return output + data.subarray(0, MAX_SFTP_COMMAND_STDERR_LENGTH - output.length).toString();
};

export class SftpService {
    private clientStates: Map<string, ClientState>; // 使用导入的 ClientState
    private activeUploads: Map<string, ActiveUpload>; // Map<uploadId, ActiveUpload>
    private readonly remoteFileOperations: SftpRemoteFileOperations;

    constructor(clientStates: Map<string, ClientState>) {
        this.clientStates = clientStates;
        this.activeUploads = new Map(); // Initialize the map
        this.remoteFileOperations = new SftpRemoteFileOperations();
    }

    /**
     * 初始化 SFTP 会话
     * @param sessionId 会话 ID
     */
    async initializeSftpSession(sessionId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sshClient || state.sftp) {
            console.warn(`[SFTP] 无法为会话 ${sessionId} 初始化 SFTP：状态无效、SSH客户端不存在或 SFTP 已初始化。`);
            return;
        }
        if (!state.sshClient) {
             console.error(`[SFTP] 会话 ${sessionId} 的 SSH 客户端不存在，无法初始化 SFTP。`);
             return;
        }
        return new Promise((resolve, reject) => {
            state.sshClient.sftp((err, sftpInstance) => {
                if (err) {
                    console.error(`[SFTP] 为会话 ${sessionId} 初始化 SFTP 会话失败:`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp_error', payload: { connectionId: state.dbConnectionId, message: 'SFTP 初始化失败' } }));
                    reject(err);
                } else {
                    console.log(`[SFTP] 为会话 ${sessionId} 初始化 SFTP 会话成功。`);
                    state.sftp = sftpInstance;
                    state.ws.send(JSON.stringify({ type: 'sftp_ready', payload: { connectionId: state.dbConnectionId } }));
                    sftpInstance.on('end', () => {
                        console.log(`[SFTP] 会话 ${sessionId} 的 SFTP 会话已结束。`);
                        if (state) state.sftp = undefined;
                    });
                    sftpInstance.on('close', () => {
                        console.log(`[SFTP] 会话 ${sessionId} 的 SFTP 会话已关闭。`);
                         if (state) state.sftp = undefined;
                    });
                    sftpInstance.on('error', (sftpErr: Error) => {
                         console.error(`[SFTP] 会话 ${sessionId} 的 SFTP 会话出错:`, sftpErr);
                         if (state) state.sftp = undefined;
                         state?.ws.send(JSON.stringify({ type: 'sftp_error', payload: { connectionId: state.dbConnectionId, message: 'SFTP 会话错误' } }));
                    });
                    resolve();
                }
            });
        });
    }

    /**
     * 清理 SFTP 会话
     * @param sessionId 会话 ID
     */
    cleanupSftpSession(sessionId: string): void {
        const state = this.clientStates.get(sessionId);
        if (state?.sftp) {
            console.log(`[SFTP] 正在清理 ${sessionId} 的 SFTP 会话...`);
            state.sftp.end();
            state.sftp = undefined;
        }
        // Also clean up any active uploads associated with this session
        this.activeUploads.forEach((upload, uploadId) => {
            if (upload.sessionId === sessionId) {
                console.warn(`[SFTP] Cleaning up active upload ${uploadId} for session ${sessionId} due to SFTP session cleanup.`);
                this.cancelUploadInternal(uploadId, 'SFTP session ended'); // Internal cancel without sending message
            }
        });
    }

    // --- SFTP 操作方法 ---

    /** 读取目录内容 */
    async readdir(sessionId: string, path: string, requestId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sftp) {
             console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 readdir (ID: ${requestId})`);
             state?.ws.send(JSON.stringify({ type: 'sftp:readdir:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId }));
             return;
        }
        console.debug(`[SFTP ${sessionId}] Received readdir request for ${path} (ID: ${requestId})`);
        try {
            state.sftp.readdir(path, (err, list) => {
                 if (err) {
                    console.error(`[SFTP ${sessionId}] readdir ${path} failed (ID: ${requestId}):`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp:readdir:error', path: path, payload: `读取目录失败: ${err.message}`, requestId: requestId }));
                 } else {
                    const files = list.map((item) => ({
                        filename: item.filename,
                        longname: item.longname,
                        attrs: {
                            size: item.attrs.size, uid: item.attrs.uid, gid: item.attrs.gid, mode: item.attrs.mode,
                            atime: item.attrs.atime * 1000, mtime: item.attrs.mtime * 1000,
                            isDirectory: item.attrs.isDirectory(), isFile: item.attrs.isFile(), isSymbolicLink: item.attrs.isSymbolicLink(),
                         }
                     }));
                    state.ws.send(JSON.stringify({ type: 'sftp:readdir:success', path: path, payload: files, requestId: requestId }));
                 }
            });
        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] readdir ${path} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:readdir:error', path: path, payload: `读取目录时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    /** 获取文件/目录状态信息 */
    async stat(sessionId: string, path: string, requestId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
         if (!state || !state.sftp) {
             console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 stat (ID: ${requestId})`);
             state?.ws.send(JSON.stringify({ type: 'sftp:stat:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId })); // Use specific error type
             return;
         }
        console.debug(`[SFTP ${sessionId}] Received stat request for ${path} (ID: ${requestId})`);
        try {
            state.sftp.lstat(path, (err, stats: Stats) => {
                if (err) {
                    console.error(`[SFTP ${sessionId}] stat ${path} failed (ID: ${requestId}):`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp:stat:error', path: path, payload: `获取状态失败: ${err.message}`, requestId: requestId }));
                } else {
                     const fileStats = {
                         size: stats.size, uid: stats.uid, gid: stats.gid, mode: stats.mode,
                         atime: stats.atime * 1000, mtime: stats.mtime * 1000,
                         isDirectory: stats.isDirectory(), isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink(),
                     };
                    // Send specific success type
                    state.ws.send(JSON.stringify({ type: 'sftp:stat:success', path: path, payload: fileStats, requestId: requestId }));
                }
            });
        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] stat ${path} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:stat:error', path: path, payload: `获取状态时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    /** 读取文件内容 (支持指定编码) */
    async readFile(sessionId: string, path: string, requestId: string, requestedEncoding?: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sftp) {
            console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 readFile (ID: ${requestId})`);
            state?.ws.send(JSON.stringify({ type: 'sftp:readfile:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId }));
            return;
        }
        console.debug(`[SFTP ${sessionId}] Received readFile request for ${path} (ID: ${requestId}, Requested Encoding: ${requestedEncoding ?? 'auto'})`);
        try {
            const readStream = state.sftp.createReadStream(path);
            let fileData = Buffer.alloc(0);
            let errorOccurred = false;

            readStream.on('data', (chunk: Buffer) => { fileData = Buffer.concat([fileData, chunk]); });
            readStream.on('error', (err: Error) => {
                if (errorOccurred) return; errorOccurred = true;
                console.error(`[SFTP ${sessionId}] readFile ${path} stream error (ID: ${requestId}):`, err);
                state.ws.send(JSON.stringify({ type: 'sftp:readfile:error', path: path, payload: `读取文件流错误: ${err.message}`, requestId: requestId }));
            });
            readStream.on('end', () => {
                if (errorOccurred) return;

                console.log(`[SFTP ${sessionId}] readFile ${path} success, size: ${fileData.length} bytes (ID: ${requestId}). Processing content...`);
                let encodingUsed: string = 'utf-8'; // Default encoding
                let decodedContent: string = '';
                let decodeError: string | null = null;

                try {
                    if (requestedEncoding) {
                        // 用户指定了编码
                        encodingUsed = requestedEncoding;
                        console.log(`[SFTP ${sessionId}] Using requested encoding: ${encodingUsed} (ID: ${requestId})`);
                        const normalizedEncoding = encodingUsed.toLowerCase().replace(/[^a-z0-9]/g, ''); // Normalize more aggressively
                        if (iconv.encodingExists(normalizedEncoding)) {
                            decodedContent = iconv.decode(fileData, normalizedEncoding);
                            encodingUsed = normalizedEncoding; // Use the normalized name if valid
                        } else {
                            console.warn(`[SFTP ${sessionId}] Requested encoding "${requestedEncoding}" is not supported by iconv-lite. Falling back to UTF-8. (ID: ${requestId})`);
                            encodingUsed = 'utf-8'; // Fallback
                            decodedContent = iconv.decode(fileData, encodingUsed);
                            // Optionally add a warning?
                        }
                    } else {
                        // 自动检测编码
                        console.log(`[SFTP ${sessionId}] Detecting encoding for ${path} (ID: ${requestId})`);
                        const detection = jschardet.detect(fileData);
                        const detectedEncodingRaw = detection.encoding ? detection.encoding.toLowerCase() : 'utf-8'; // Default to utf-8 if detection fails
                        const confidence = detection.confidence || 0;
                        console.log(`[SFTP ${sessionId}] Detected encoding: ${detectedEncodingRaw} (confidence: ${confidence})`);

                        const chineseEncodings = ['gbk', 'gb2312', 'gb18030', 'big5', 'euc-tw'];
                        let normalizedDetected = detectedEncodingRaw.replace(/[^a-z0-9]/g, '');
                        if (normalizedDetected === 'windows1252') normalizedDetected = 'cp1252';
                        else if (normalizedDetected === 'gb2312') normalizedDetected = 'gbk'; // Prefer gbk

                        if (normalizedDetected === 'utf8' || normalizedDetected === 'ascii') {
                            encodingUsed = 'utf-8';
                            decodedContent = fileData.toString('utf8');
                            console.log(`[SFTP ${sessionId}] Decoded ${path} as UTF-8/ASCII.`);
                        } else if (chineseEncodings.includes(normalizedDetected)) {
                            // If detected as a common Chinese encoding, trust it and use gb18030 for broader compatibility
                            encodingUsed = 'gb18030'; // Report gb18030 as used
                            decodedContent = iconv.decode(fileData, encodingUsed);
                            console.log(`[SFTP ${sessionId}] Decoded ${path} from detected Chinese encoding (${normalizedDetected}) as ${encodingUsed}.`);
                        } else if (confidence < 0.90) { // Low confidence threshold
                            console.warn(`[SFTP ${sessionId}] Low confidence detection (${normalizedDetected}, ${confidence}) for ${path}. Attempting GB18030 decode first.`);
                            try {
                                // Try decoding as GB18030 first
                                const tempContent = iconv.decode(fileData, 'gb18030');
                                // Basic check for Mojibake
                                if (tempContent.includes('\uFFFD')) {
                                     console.warn(`[SFTP ${sessionId}] GB18030 decoding resulted in replacement characters. Falling back to original detection (${normalizedDetected}) or UTF-8.`);
                                     // Fallback: Try the originally detected encoding if supported, otherwise UTF-8
                                     if (iconv.encodingExists(normalizedDetected)) {
                                         encodingUsed = normalizedDetected;
                                         decodedContent = iconv.decode(fileData, encodingUsed);
                                         console.log(`[SFTP ${sessionId}] Falling back to decoding ${path} as originally detected ${encodingUsed}.`);
                                     } else {
                                         encodingUsed = 'utf-8';
                                         decodedContent = fileData.toString('utf8');
                                         console.log(`[SFTP ${sessionId}] Falling back to decoding ${path} as UTF-8.`);
                                     }
                                } else {
                                     encodingUsed = 'gb18030'; // Success with GB18030
                                     decodedContent = tempContent;
                                     console.log(`[SFTP ${sessionId}] Decoded ${path} as ${encodingUsed} due to low confidence detection.`);
                                }
                            } catch (gbkError) {
                                console.warn(`[SFTP ${sessionId}] Error decoding as GB18030, falling back to original detection (${normalizedDetected}) or UTF-8:`, gbkError);
                                // Fallback: Try the originally detected encoding if supported, otherwise UTF-8
                                if (iconv.encodingExists(normalizedDetected)) {
                                    encodingUsed = normalizedDetected;
                                    decodedContent = iconv.decode(fileData, encodingUsed);
                                    console.log(`[SFTP ${sessionId}] Falling back to decoding ${path} as originally detected ${encodingUsed}.`);
                                } else {
                                    encodingUsed = 'utf-8';
                                    decodedContent = fileData.toString('utf8');
                                    console.log(`[SFTP ${sessionId}] Falling back to decoding ${path} as UTF-8.`);
                                }
                            }
                        } else if (iconv.encodingExists(normalizedDetected)) {
                            // Higher confidence, non-Chinese, supported encoding
                            encodingUsed = normalizedDetected;
                            decodedContent = iconv.decode(fileData, encodingUsed);
                            console.log(`[SFTP ${sessionId}] Decoded ${path} from ${encodingUsed} using iconv-lite (high confidence).`);
                        } else {
                            console.warn(`[SFTP ${sessionId}] Unsupported or unknown encoding detected for ${path}: ${normalizedDetected}. Falling back to UTF-8.`);
                            encodingUsed = 'utf-8'; // Final fallback
                            decodedContent = fileData.toString('utf8');
                        }
                    }

                    // Final check for replacement characters after deciding the encoding
                    if (decodedContent.includes('\uFFFD')) {
                         console.warn(`[SFTP ${sessionId}] Final decoded content for ${path} (using ${encodingUsed}) contains replacement characters (U+FFFD). Decoding might be incorrect. (ID: ${requestId})`);
                         // decodeError = `解码内容可能不正确 (使用 ${encodingUsed})，检测到无效字符。`; // Optionally set error
                    }

                } catch (err: any) {
                    console.error(`[SFTP ${sessionId}] Error detecting/decoding file content for ${path} (ID: ${requestId}):`, err);
                    decodeError = `文件编码检测或转换失败: ${err.message}`;
                    state.ws.send(JSON.stringify({ type: 'sftp:readfile:error', path: path, payload: decodeError, requestId: requestId }));
                    return; // Stop processing
                }

                // 发送 Base64 编码的原始数据和实际使用的编码
                console.log(`[SFTP ${sessionId}] Sending raw content (Base64) and encoding used (${encodingUsed}) for ${path} (ID: ${requestId})`);
                state.ws.send(JSON.stringify({
                    type: 'sftp:readfile:success',
                    path: path,
                    payload: {
                        rawContentBase64: fileData.toString('base64'), // 发送 Base64 字符串
                        encodingUsed: encodingUsed // 发送实际使用的编码
                    },
                    requestId: requestId
                }));
            });
        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] readFile ${path} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:readfile:error', path: path, payload: `读取文件时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    /** 写入文件内容 (支持指定编码) */
    // --- 修改：添加 encoding 参数 ---
    async writefile(sessionId: string, path: string, data: string, requestId: string, encoding?: string): Promise<void> {
         const state = this.clientStates.get(sessionId);
         if (!state || !state.sftp) {
             console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 writefile (ID: ${requestId})`);
             state?.ws.send(JSON.stringify({ type: 'sftp:writefile:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId }));
             return;
         }
        // --- 修改：使用传入的 encoding 或默认 utf-8 ---
        const targetEncoding = encoding || 'utf-8';
        console.debug(`[SFTP ${sessionId}] Received writefile request for ${path} (ID: ${requestId}, Encoding: ${targetEncoding})`);
        try {
            // --- 修改：使用 iconv-lite 根据指定编码创建 Buffer ---
            let buffer: Buffer;
            try {
                buffer = iconv.encode(data, targetEncoding);
                console.log(`[SFTP ${sessionId}] Encoded content for ${path} using ${targetEncoding} (Buffer size: ${buffer.length})`);
            } catch (encodeError: any) {
                 console.error(`[SFTP ${sessionId}] Failed to encode content for ${path} with encoding ${targetEncoding} (ID: ${requestId}):`, encodeError);
                 state.ws.send(JSON.stringify({ type: 'sftp:writefile:error', path: path, payload: `无效的编码或编码失败: ${targetEncoding}`, requestId: requestId }));
                 return;
            }

            // 获取文件当前权限
            let originalMode: number | undefined;
            try {
                const stats = await new Promise<Stats>((resolve, reject) => {
                    state.sftp!.lstat(path, (err, stats) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(stats);
                        }
                    });
                });
                originalMode = stats.mode;
                console.log(`[SFTP ${sessionId}] Retrieved original file mode for ${path}: ${originalMode.toString(8)} (ID: ${requestId})`);
            } catch (statError: any) {
                console.warn(`[SFTP ${sessionId}] Could not retrieve original file mode for ${path} (ID: ${requestId}):`, statError);
                // 如果文件不存在或其他错误，继续写入操作，不设置权限
            }

            console.debug(`[SFTP ${sessionId}] Creating write stream for ${path} (ID: ${requestId})`);
            // 在创建写入流时设置文件权限
            const writeStreamOptions = originalMode !== undefined ? { mode: originalMode } : {};
            const writeStream = state.sftp.createWriteStream(path, writeStreamOptions);
            let errorOccurred = false;

            writeStream.on('error', (err: Error) => {
                if (errorOccurred) return; // Prevent sending multiple errors
                errorOccurred = true;
                console.error(`[SFTP ${sessionId}] writefile ${path} stream error (ID: ${requestId}):`, err);
                state.ws.send(JSON.stringify({ type: 'sftp:writefile:error', path: path, payload: `写入文件流错误: ${err.message}`, requestId: requestId }));
            });

            // Listen for the 'close' event which indicates the stream has finished writing and the file descriptor is closed.
            writeStream.on('close', () => {
                if (!errorOccurred) {
                    console.log(`[SFTP ${sessionId}] writefile ${path} stream closed successfully (ID: ${requestId}). Fetching updated stats...`);
                    if (originalMode !== undefined) {
                        console.log(`[SFTP ${sessionId}] Set file mode for ${path} during creation: ${originalMode.toString(8)} (ID: ${requestId})`);
                    }
                    // Get updated stats after writing
                    state.sftp!.lstat(path, (statErr, stats) => {
                        if (statErr) {
                            console.error(`[SFTP ${sessionId}] lstat after writefile ${path} failed (ID: ${requestId}):`, statErr);
                            state.ws.send(JSON.stringify({ type: 'sftp:writefile:success', path: path, payload: null, requestId: requestId }));
                        } else {
                            const updatedItem = {
                                filename: path.substring(path.lastIndexOf('/') + 1),
                                longname: '',
                                attrs: {
                                    size: stats.size, uid: stats.uid, gid: stats.gid, mode: stats.mode,
                                    atime: stats.atime * 1000, mtime: stats.mtime * 1000,
                                    isDirectory: stats.isDirectory(), isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink(),
                                }
                            };
                            console.log(`[SFTP ${sessionId}] Sending writefile success with updated item for ${path} (ID: ${requestId})`);
                            state.ws.send(JSON.stringify({ type: 'sftp:writefile:success', path: path, payload: updatedItem, requestId: requestId }));
                        }
                    });
                }
            });

            console.debug(`[SFTP ${sessionId}] Writing ${buffer.length} bytes to ${path} (ID: ${requestId})`);
            writeStream.end(buffer); // Start writing and close the stream afterwards
            console.debug(`[SFTP ${sessionId}] writefile ${path} end() called (ID: ${requestId})`);

            // Success message is now sent in the 'close' event handler

        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] writefile ${path} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:writefile:error', path: path, payload: `写入文件时发生意外错误: ${error.message}`, requestId: requestId }));
         }
    }

    /** 创建目录 */
    async mkdir(sessionId: string, path: string, requestId: string): Promise<void> {
         const state = this.clientStates.get(sessionId);
         if (!state || !state.sftp) {
             console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 mkdir (ID: ${requestId})`);
             state?.ws.send(JSON.stringify({ type: 'sftp:mkdir:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId })); // Use specific error type
             return;
         }
        console.debug(`[SFTP ${sessionId}] Received mkdir request for ${path} (ID: ${requestId})`);
        try {
            state.sftp.mkdir(path, (err) => {
                if (err) {
                    console.error(`[SFTP ${sessionId}] mkdir ${path} failed (ID: ${requestId}):`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp:mkdir:error', path: path, payload: `创建目录失败: ${err.message}`, requestId: requestId }));
                } else {
                    console.log(`[SFTP ${sessionId}] mkdir ${path} success (ID: ${requestId}). Fetching stats...`);
                    // Get stats for the new directory
                    state.sftp!.lstat(path, (statErr, stats) => {
                         if (statErr) {
                            console.error(`[SFTP ${sessionId}] lstat after mkdir ${path} failed (ID: ${requestId}):`, statErr);
                            // Send success anyway, but without item details
                            state.ws.send(JSON.stringify({ type: 'sftp:mkdir:success', path: path, payload: null, requestId: requestId }));
                         } else {
                            const newItem = {
                                filename: path.substring(path.lastIndexOf('/') + 1),
                                longname: '', // lstat doesn't provide longname
                                attrs: {
                                    size: stats.size, uid: stats.uid, gid: stats.gid, mode: stats.mode,
                                    atime: stats.atime * 1000, mtime: stats.mtime * 1000,
                                    isDirectory: stats.isDirectory(), isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink(),
                                }
                            };
                            console.log(`[SFTP ${sessionId}] Sending mkdir success with new item for ${path} (ID: ${requestId})`);
                            state.ws.send(JSON.stringify({ type: 'sftp:mkdir:success', path: path, payload: newItem, requestId: requestId }));
                         }
                    });
                }
            });
        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] mkdir ${path} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:mkdir:error', path: path, payload: `创建目录时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    /** 删除目录 (强制递归) */
    async rmdir(sessionId: string, path: string, requestId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sshClient) { 
            console.warn(`[SSH Exec] SSH 客户端未准备好，无法在 ${sessionId} 上执行 rmdir (ID: ${requestId})`);
            state?.ws.send(JSON.stringify({ type: 'sftp:rmdir:error', path: path, payload: 'SSH 会话未就绪', requestId: requestId }));
            return;
        }
        console.debug(`[SSH Exec ${sessionId}] Received rmdir request for ${path} (ID: ${requestId})`);

        const command = `rm -rf -- ${quotePosixShellArgument(path)}`;
        try {
            state.sshClient.exec(command, (err, stream) => {
                if (err) {
                    state.ws.send(JSON.stringify({ type: 'sftp:rmdir:error', path: path, payload: `删除目录失败: ${err.message}`, requestId: requestId }));
                    return;
                }

                let stderrOutput = '';
                stream.stderr.on('data', (data: Buffer) => {
                    stderrOutput += data.toString();
                });

                stream.on('close', (code: number | null, signal: string | null) => {
                    if (code === 0) {
                        state.ws.send(JSON.stringify({ type: 'sftp:rmdir:success', path: path, requestId: requestId }));
                        return;
                    }

                    const errorMessage = stderrOutput.trim() || `命令退出，代码: ${code ?? 'N/A'}${signal ? `, 信号: ${signal}` : ''}`;
                    state.ws.send(JSON.stringify({ type: 'sftp:rmdir:error', path: path, payload: `删除目录失败: ${errorMessage}`, requestId: requestId }));
                });
            });
        } catch (error: any) {
            state.ws.send(JSON.stringify({ type: 'sftp:rmdir:error', path: path, payload: `删除目录时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    /** 删除文件 */
     async unlink(sessionId: string, path: string, requestId: string): Promise<void> {
         const state = this.clientStates.get(sessionId);
         if (!state || !state.sftp) {
             console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 unlink (ID: ${requestId})`);
             state?.ws.send(JSON.stringify({ type: 'sftp:unlink:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId })); // Use specific error type
             return;
         }
        console.debug(`[SFTP ${sessionId}] Received unlink request for ${path} (ID: ${requestId})`);
        try {
            state.sftp.unlink(path, (err) => {
                if (err) {
                    console.error(`[SFTP ${sessionId}] unlink ${path} failed (ID: ${requestId}):`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp:unlink:error', path: path, payload: `删除文件失败: ${err.message}`, requestId: requestId }));
                } else {
                    console.log(`[SFTP ${sessionId}] unlink ${path} success (ID: ${requestId})`);
                    state.ws.send(JSON.stringify({ type: 'sftp:unlink:success', path: path, requestId: requestId })); // Send specific success type
                }
            });
        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] unlink ${path} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:unlink:error', path: path, payload: `删除文件时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    /** 重命名/移动文件或目录 */
     async rename(sessionId: string, oldPath: string, newPath: string, requestId: string): Promise<void> {
         const state = this.clientStates.get(sessionId);
         if (!state || !state.sftp) {
             console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 rename (ID: ${requestId})`);
             state?.ws.send(JSON.stringify({ type: 'sftp:rename:error', oldPath: oldPath, newPath: newPath, payload: 'SFTP 会话未就绪', requestId: requestId })); // Use specific error type
             return;
         }
        console.debug(`[SFTP ${sessionId}] Received rename request ${oldPath} -> ${newPath} (ID: ${requestId})`);
        try {
            state.sftp.rename(oldPath, newPath, (err) => {
                if (err) {
                    console.error(`[SFTP ${sessionId}] rename ${oldPath} -> ${newPath} failed (ID: ${requestId}):`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp:rename:error', oldPath: oldPath, newPath: newPath, payload: `重命名/移动失败: ${err.message}`, requestId: requestId }));
                } else {
                    console.log(`[SFTP ${sessionId}] rename ${oldPath} -> ${newPath} success (ID: ${requestId}). Fetching stats for new path...`);
                    // Get stats for the new path
                    state.sftp!.lstat(newPath, (statErr, stats) => {
                        if (statErr) {
                            console.error(`[SFTP ${sessionId}] lstat after rename ${newPath} failed (ID: ${requestId}):`, statErr);
                            // Send success anyway, but without item details
                            state.ws.send(JSON.stringify({ type: 'sftp:rename:success', payload: { oldPath: oldPath, newPath: newPath, newItem: null }, requestId: requestId }));
                        } else {
                            const newItem = {
                                filename: newPath.substring(newPath.lastIndexOf('/') + 1),
                                longname: '', // lstat doesn't provide longname
                                attrs: {
                                    size: stats.size, uid: stats.uid, gid: stats.gid, mode: stats.mode,
                                    atime: stats.atime * 1000, mtime: stats.mtime * 1000,
                                    isDirectory: stats.isDirectory(), isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink(),
                                }
                            };
                            console.log(`[SFTP ${sessionId}] Sending rename success with new item for ${newPath} (ID: ${requestId})`);
                            state.ws.send(JSON.stringify({ type: 'sftp:rename:success', payload: { oldPath: oldPath, newPath: newPath, newItem: newItem }, requestId: requestId }));
                        }
                    });
                }
            });
        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] rename ${oldPath} -> ${newPath} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:rename:error', oldPath: oldPath, newPath: newPath, payload: `重命名/移动时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    /** 修改文件/目录权限 */
     async chmod(sessionId: string, path: string, mode: number, requestId: string): Promise<void> {
         const state = this.clientStates.get(sessionId);
         if (!state || !state.sftp) {
             console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 chmod (ID: ${requestId})`);
             state?.ws.send(JSON.stringify({ type: 'sftp:chmod:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId })); // Use specific error type
             return;
         }
        console.debug(`[SFTP ${sessionId}] Received chmod request for ${path} to ${mode.toString(8)} (ID: ${requestId})`);
        try {
            state.sftp.chmod(path, mode, (err) => {
                if (err) {
                    console.error(`[SFTP ${sessionId}] chmod ${path} to ${mode.toString(8)} failed (ID: ${requestId}):`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp:chmod:error', path: path, payload: `修改权限失败: ${err.message}`, requestId: requestId }));
                } else {
                    console.log(`[SFTP ${sessionId}] chmod ${path} to ${mode.toString(8)} success (ID: ${requestId}). Fetching updated stats...`);
                    // Get updated stats after chmod
                    state.sftp!.lstat(path, (statErr, stats) => {
                        if (statErr) {
                            console.error(`[SFTP ${sessionId}] lstat after chmod ${path} failed (ID: ${requestId}):`, statErr);
                            // Send success anyway, but without updated item details
                            state.ws.send(JSON.stringify({ type: 'sftp:chmod:success', path: path, payload: null, requestId: requestId }));
                        } else {
                            const updatedItem = {
                                filename: path.substring(path.lastIndexOf('/') + 1),
                                longname: '', // lstat doesn't provide longname
                                attrs: {
                                    size: stats.size, uid: stats.uid, gid: stats.gid, mode: stats.mode,
                                    atime: stats.atime * 1000, mtime: stats.mtime * 1000,
                                    isDirectory: stats.isDirectory(), isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink(),
                                }
                            };
                            console.log(`[SFTP ${sessionId}] Sending chmod success with updated item for ${path} (ID: ${requestId})`);
                            state.ws.send(JSON.stringify({ type: 'sftp:chmod:success', path: path, payload: updatedItem, requestId: requestId }));
                        }
                    });
                }
            });
        } catch (error: any) {
             console.error(`[SFTP ${sessionId}] chmod ${path} caught unexpected error (ID: ${requestId}):`, error);
             state.ws.send(JSON.stringify({ type: 'sftp:chmod:error', path: path, payload: `修改权限时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }


    /** 获取路径的绝对表示 */
    async realpath(sessionId: string, path: string, requestId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sftp) {
            console.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 realpath (ID: ${requestId})`);
            state?.ws.send(JSON.stringify({ type: 'sftp:realpath:error', path: path, payload: 'SFTP 会话未就绪', requestId: requestId }));
            return;
        }
        console.debug(`[SFTP ${sessionId}] Received realpath request for ${path} (ID: ${requestId})`);
        try {
            state.sftp.realpath(path, (err, absPath) => {
                if (err) {
                    console.error(`[SFTP ${sessionId}] realpath ${path} failed (ID: ${requestId}):`, err);
                    state.ws.send(JSON.stringify({ type: 'sftp:realpath:error', path: path, payload: { requestedPath: path, error: `获取绝对路径失败: ${err.message}` }, requestId: requestId }));
                } else {
                    console.log(`[SFTP ${sessionId}] realpath ${path} -> ${absPath} success (ID: ${requestId}). Fetching target type...`);
                    // 再次检查 state 和 state.sftp 是否仍然有效，因为回调是异步的
                    const currentState = this.clientStates.get(sessionId);
                    if (!currentState || !currentState.sftp) {
                        console.warn(`[SFTP ${sessionId}] SFTP session for ${absPath} became invalid before stat call (ID: ${requestId}).`);
                        // 即使 SFTP 会话失效，也尝试发送已解析的路径，但标记错误
                        state.ws.send(JSON.stringify({
                            type: 'sftp:realpath:error',
                            path: path, // 原始请求路径
                            payload: {
                                requestedPath: path,
                                absolutePath: absPath,
                                error: 'SFTP 会话在获取目标类型前已失效'
                            },
                            requestId: requestId
                        }));
                        return;
                    }
                    // 对 absPath 执行 stat 操作以获取其真实类型
                    currentState.sftp.stat(absPath, (statErr, stats) => { // 使用 sftp.stat()
                        if (statErr) {
                            console.error(`[SFTP ${sessionId}] stat on realpath target ${absPath} failed (ID: ${requestId}):`, statErr);
                            // 如果 stat 失败，发送带有错误信息的 realpath:error，但仍包含已解析的路径
                            state.ws.send(JSON.stringify({
                                type: 'sftp:realpath:error',
                                path: path, // 原始请求路径
                                payload: {
                                    requestedPath: path,
                                    absolutePath: absPath, // 仍然发送已解析的路径
                                    error: `获取目标类型失败: ${statErr.message}`
                                },
                                requestId: requestId
                            }));
                        } else {
                            let targetType: 'file' | 'directory' | 'unknown' = 'unknown';
                            if (stats.isFile()) {
                                targetType = 'file';
                            } else if (stats.isDirectory()) {
                                targetType = 'directory';
                            }
                            console.log(`[SFTP ${sessionId}] Target type for ${absPath} is ${targetType} (ID: ${requestId})`);
                            state.ws.send(JSON.stringify({
                                type: 'sftp:realpath:success',
                                path: path, // 原始请求路径
                                payload: {
                                    requestedPath: path,
                                    absolutePath: absPath,
                                    targetType: targetType // 新增字段
                                },
                                requestId: requestId
                            }));
                        }
                    });
                }
            });
        } catch (error: any) {
            console.error(`[SFTP ${sessionId}] realpath ${path} caught unexpected error (ID: ${requestId}):`, error);
            state.ws.send(JSON.stringify({ type: 'sftp:realpath:error', path: path, payload: `获取绝对路径时发生意外错误: ${error.message}`, requestId: requestId }));
        }
    }

    // +++ 复制文件或目录 +++
    async copy(sessionId: string, sources: string[], destinationDir: string, requestId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sftp) {
            console.warn(`[SFTP Copy] SFTP 未准备好，无法在 ${sessionId} 上执行 copy (ID: ${requestId})`);
            state?.ws.send(JSON.stringify({ type: 'sftp:copy:error', payload: 'SFTP 会话未就绪', requestId: requestId }));
            return;
        }
        const sftp = state.sftp;
        console.debug(`[SFTP ${sessionId}] Received copy request (ID: ${requestId}) Sources: ${sources.join(', ')}, Dest: ${destinationDir}`);

        const copiedItemsDetails: any[] = []; // Store details of successfully copied items
        let firstError: Error | null = null;

        try {
            // Ensure destination directory exists
            try {
                await this.remoteFileOperations.ensureDirectoryExists(sftp, destinationDir);
            } catch (ensureErr: any) {
                 console.error(`[SFTP ${sessionId}] Failed to ensure destination directory ${destinationDir} exists (ID: ${requestId}):`, ensureErr);
                 throw new Error(`无法创建或访问目标目录: ${ensureErr.message}`);
            }

            for (const sourcePath of sources) {
                const sourceName = pathModule.basename(sourcePath);
                const destPath = pathModule.join(destinationDir, sourceName).replace(/\\/g, '/'); // Ensure forward slashes

                if (sourcePath === destPath) {
                     console.warn(`[SFTP ${sessionId}] Skipping copy: source and destination are the same (${sourcePath}) (ID: ${requestId})`);
                     continue; // Skip if source and destination are identical
                }

                try {
                    const stats = await this.remoteFileOperations.readStats(sftp, sourcePath);
                    if (stats.isDirectory()) {
                        console.log(`[SFTP ${sessionId}] Copying directory ${sourcePath} to ${destPath} (ID: ${requestId})`);
                        await this.remoteFileOperations.copyDirectoryRecursively(sftp, sourcePath, destPath);
                    } else if (stats.isFile()) {
                        console.log(`[SFTP ${sessionId}] Copying file ${sourcePath} to ${destPath} (ID: ${requestId})`);
                        await this.remoteFileOperations.copyFile(sftp, sourcePath, destPath);
                    } else {
                        // Handle symlinks or other types if necessary, for now just skip/warn
                        console.warn(`[SFTP ${sessionId}] Skipping copy of unsupported file type: ${sourcePath} (ID: ${requestId})`);
                        continue;
                    }
                    // Get stats of the *newly copied* item
                    const copiedStats = await this.remoteFileOperations.readStats(sftp, destPath);
                    copiedItemsDetails.push(this.formatStatsToFileListItem(destPath, copiedStats));

                } catch (copyErr: any) {
                    console.error(`[SFTP ${sessionId}] Error copying ${sourcePath} to ${destPath} (ID: ${requestId}):`, copyErr);
                    firstError = copyErr; // Store the first error encountered
                    break; // Stop processing further sources on error
                }
            }

            if (firstError) {
                throw firstError; // Throw the first error to be caught below
            }

            // Send success message with details of copied items
            console.log(`[SFTP ${sessionId}] Copy operation completed successfully (ID: ${requestId}). Copied items: ${copiedItemsDetails.length}`);
            state.ws.send(JSON.stringify({
                type: 'sftp:copy:success',
                payload: { destination: destinationDir, items: copiedItemsDetails },
                requestId: requestId
            }));

        } catch (error: any) {
            console.error(`[SFTP ${sessionId}] Copy operation failed (ID: ${requestId}):`, error);
            state.ws.send(JSON.stringify({ type: 'sftp:copy:error', payload: `复制操作失败: ${error.message}`, requestId: requestId }));
        }
    }

    // +++ 移动文件或目录 +++
    async move(sessionId: string, sources: string[], destinationDir: string, requestId: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sftp) {
            console.warn(`[SFTP Move] SFTP 未准备好，无法在 ${sessionId} 上执行 move (ID: ${requestId})`);
            state?.ws.send(JSON.stringify({ type: 'sftp:move:error', payload: 'SFTP 会话未就绪', requestId: requestId }));
            return;
        }
        const sftp = state.sftp;
        console.debug(`[SFTP ${sessionId}] Received move request (ID: ${requestId}) Sources: ${sources.join(', ')}, Dest: ${destinationDir}`);

        const movedItemsDetails: any[] = [];
        let firstError: Error | null = null;

        try {
             // Ensure destination directory exists (important for move)
            try {
                await this.remoteFileOperations.ensureDirectoryExists(sftp, destinationDir);
            } catch (ensureErr: any) {
                 console.error(`[SFTP ${sessionId}] Failed to ensure destination directory ${destinationDir} exists for move (ID: ${requestId}):`, ensureErr);
                 throw new Error(`无法创建或访问目标目录: ${ensureErr.message}`);
            }

            for (const oldPath of sources) {
                const sourceName = pathModule.basename(oldPath);
                const newPath = pathModule.join(destinationDir, sourceName).replace(/\\/g, '/'); // Ensure forward slashes

                 if (oldPath === newPath) {
                     console.warn(`[SFTP ${sessionId}] Skipping move: source and destination are the same (${oldPath}) (ID: ${requestId})`);
                     continue; // Skip if source and destination are identical
                 }

                try {
                    // --- 移动前检查目标是否存在 ---
                    let targetExists = false;
                    try {
                        await this.remoteFileOperations.readStats(sftp, newPath);
                        targetExists = true;
                    } catch (statErr: any) {
                        if (!(statErr.code === 'ENOENT' || (statErr.message && statErr.message.includes('No such file')))) {
                            // 如果 stat 失败不是因为 "No such file"，则抛出未知错误
                            throw new Error(`检查目标路径 ${newPath} 状态时出错: ${statErr.message}`);
                        }
                        // 如果是 "No such file"，则 targetExists 保持 false，可以继续移动
                    }

                    if (targetExists) {
                        console.error(`[SFTP ${sessionId}] Move failed: Target path ${newPath} already exists (ID: ${requestId})`);
                        throw new Error(`目标路径 ${pathModule.basename(newPath)} 已存在`);
                    }
                    
                    console.log(`[SFTP ${sessionId}] Moving ${oldPath} to ${newPath} (ID: ${requestId})`);
                    await this.remoteFileOperations.rename(sftp, oldPath, newPath);

                    // Get stats of the *moved* item at the new location
                    const movedStats = await this.remoteFileOperations.readStats(sftp, newPath);
                    movedItemsDetails.push(this.formatStatsToFileListItem(newPath, movedStats));

                } catch (moveErr: any) {
                    console.error(`[SFTP ${sessionId}] Error moving ${oldPath} to ${newPath} (ID: ${requestId}):`, moveErr);
                    firstError = moveErr;
                    break; // Stop on first error for move
                }
            }

            if (firstError) {
                throw firstError;
            }

            console.log(`[SFTP ${sessionId}] Move operation completed successfully (ID: ${requestId}). Moved items: ${movedItemsDetails.length}`);
            state.ws.send(JSON.stringify({
                type: 'sftp:move:success',
                payload: { sources: sources, destination: destinationDir, items: movedItemsDetails },
                requestId: requestId
            }));

        } catch (error: any) {
            console.error(`[SFTP ${sessionId}] Move operation failed (ID: ${requestId}):`, error);
            state.ws.send(JSON.stringify({ type: 'sftp:move:error', payload: `移动操作失败: ${error.message}`, requestId: requestId }));
        }
    }

    // +++ 辅助方法 - 格式化 Stats 为 FileListItem +++
    private formatStatsToFileListItem(itemPath: string, stats: Stats): any {
         return {
            filename: pathModule.basename(itemPath),
            longname: '', // stat doesn't provide longname, maybe generate a basic one?
            attrs: {
                size: stats.size, uid: stats.uid, gid: stats.gid, mode: stats.mode,
                atime: stats.atime * 1000, mtime: stats.mtime * 1000,
                isDirectory: stats.isDirectory(), isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink(),
            }
        };
    }


    // --- Compress/Decompress Methods ---
/**
     * 压缩远程服务器上的文件/目录
     * @param sessionId 会话 ID
     * @param payload 压缩请求的 payload
     */
    async compress(sessionId: string, payload: SftpCompressRequestPayload): Promise<void> {
        const state = this.clientStates.get(sessionId);
        const { sources, destinationArchiveName, format, targetDirectory, requestId } = payload;

        if (!state || !state.sshClient) {
            logger.warn('SFTP compression unavailable');
            this.sendCompressError(state?.ws, 'SSH 会话未就绪', requestId);
            return;
        }

        // 命令检查
        const requiredCommand = format === 'zip' ? 'zip' : 'tar';
        try {
            const commandExists = await this.checkCommandExists(state, sessionId, requiredCommand); // 传递 sessionId
            if (!commandExists) {
                this.sendCompressError(state.ws, `命令 '${requiredCommand}' 在服务器上未找到`, requestId, `Command '${requiredCommand}' not found on server.`);
                return;
            }
        } catch (checkError: any) {
            this.sendCompressError(state.ws, `检查命令 '${requiredCommand}' 时出错`, requestId, checkError.message);
            return;
        }

        logger.debug('Received SFTP compression request', { format });

        // 构建目标压缩包的完整路径
        const destinationArchivePath = pathModule.posix.join(targetDirectory, destinationArchiveName);

        // --- 构建 Shell 命令 ---
        let command: string;
        // --- 修改：计算相对路径并引用 ---
        const relativeSources = sources.map((s: string) => {
            // 计算相对于 targetDirectory 的路径
            const relativePath = pathModule.posix.relative(targetDirectory, s);
            // 如果计算出的相对路径为空或'.', 表示源文件就在目标目录下，直接使用文件名
            // 否则使用计算出的相对路径
            return (relativePath === '' || relativePath === '.') ? pathModule.posix.basename(s) : relativePath;
        });
        const quotedRelativeSources = relativeSources.map(quotePosixShellArgument).join(' ');
        
        // 确保目标目录和压缩包路径被正确引用
        const quotedTargetDir = quotePosixShellArgument(targetDirectory);
        // const quotedDestPath = `"${destinationArchivePath.replace(/"/g, '\\"')}"`; // 目标路径在命令中不直接使用，使用相对名称
        const quotedDestName = quotePosixShellArgument(destinationArchiveName);

        const cdCommand = `cd ${quotedTargetDir}`;

        switch (format) {
            case 'zip':
                // zip -r [归档名] [源文件/目录列表]
                // 需要在目标目录执行
                command = `${cdCommand} && zip -r -- ${quotedDestName} ${quotedRelativeSources}`; // 使用相对路径
                break;
            case 'targz':
                // tar -czvf [归档名] [源文件/目录列表]
                // 需要在目标目录执行
                command = `${cdCommand} && tar -czvf -- ${quotedDestName} ${quotedRelativeSources}`; // 使用相对路径
                break;
            case 'tarbz2':
                // tar -cjvf [归档名] [源文件/目录列表]
                // 需要在目标目录执行
                command = `${cdCommand} && tar -cjvf -- ${quotedDestName} ${quotedRelativeSources}`; // 使用相对路径
                break;
            default:
                this.sendCompressError(state.ws, `不支持的压缩格式: ${format}`, requestId);
                return;
        }

        logger.info('Executing SFTP compression command', { format });

        // --- 执行命令 ---
        try {
            state.sshClient.exec(command, (err, stream) => {
                if (err) {
                    logger.error('Failed to start SFTP compression command', { errorName: err.name });
                    this.sendCompressError(state.ws, `执行压缩命令失败: ${err.message}`, requestId);
                    return;
                }

                let stderrData = '';
                let code: number | null = null; // Track exit code

                stream.on('data', () => undefined);
                stream.stderr.on('data', (data: Buffer) => {
                    stderrData = appendSftpCommandStderr(stderrData, data);
                });

                stream.on('close', (exitCode: number | null) => {
                    code = exitCode; // Store exit code
                    logger.info('SFTP compression command finished', { format, exitCode: code });
                    if (code === 0 && !this.isErrorInStdErr(stderrData)) { // 检查退出码和 stderr
                        logger.info('SFTP compression succeeded', { format });
                        const successPayload: SftpCompressSuccessPayload = {
                            message: '压缩成功',
                            requestId: requestId
                        };
                        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                             state.ws.send(JSON.stringify({ type: 'sftp:compress:success', requestId: requestId, payload: successPayload })); // Ensure requestId is included
                        }
                    } else {
                        const errorDetails = stderrData.trim() || `压缩命令退出，代码: ${code ?? 'N/A'}`;
                        logger.error('SFTP compression failed', { format, exitCode: code });
                        this.sendCompressError(state.ws, '压缩失败', requestId, errorDetails);
                    }
                });
                 stream.on('error', (streamErr: Error) => { 
                     logger.error('SFTP compression command stream error', { errorName: streamErr.name });
                     // 避免重复发送错误
                     if (!stderrData && code === undefined) { // 仅当 close 事件未触发且 stderr 为空时发送
                          this.sendCompressError(state.ws, '压缩命令流错误', requestId, streamErr.message);
                     }
                 });
            });
        } catch (execError: any) {
            logger.error('SFTP compression command setup failed', { errorName: execError.name });
            this.sendCompressError(state.ws, `执行压缩时发生意外错误: ${execError.message}`, requestId);
        }
    }

    /**
     * 解压远程服务器上的压缩文件
     * @param sessionId 会话 ID
     * @param payload 解压请求的 payload
     */
    async decompress(sessionId: string, payload: SftpDecompressRequestPayload): Promise<void> {
        const state = this.clientStates.get(sessionId);
        const { archivePath, requestId } = payload;

        if (!state || !state.sshClient) {
            logger.warn('SFTP decompression unavailable');
            this.sendDecompressError(state?.ws, 'SSH 会话未就绪', requestId);
            return;
        }

        const lowerArchivePath = archivePath.toLowerCase(); // 在此声明一次

        // 命令检查
        let requiredCommand = '';
        // 使用已经声明的 lowerArchivePath
        if (lowerArchivePath.endsWith('.zip')) {
            requiredCommand = 'unzip';
        } else if (lowerArchivePath.endsWith('.tar.gz') || lowerArchivePath.endsWith('.tgz') || lowerArchivePath.endsWith('.tar.bz2') || lowerArchivePath.endsWith('.tbz2')) {
            requiredCommand = 'tar';
        } else {
            this.sendDecompressError(state.ws, `不支持的压缩文件格式: ${archivePath}`, requestId);
            return;
        }

        try {
            const commandExists = await this.checkCommandExists(state, sessionId, requiredCommand); // 传递 sessionId
            if (!commandExists) {
                this.sendDecompressError(state.ws, `命令 '${requiredCommand}' 在服务器上未找到`, requestId, `Command '${requiredCommand}' not found on server.`);
                return;
            }
        } catch (checkError: any) {
            this.sendDecompressError(state.ws, `检查命令 '${requiredCommand}' 时出错`, requestId, checkError.message);
            return;
        }

        logger.debug('Received SFTP decompression request');

        const extractDir = pathModule.posix.dirname(archivePath);
        const archiveBasename = pathModule.posix.basename(archivePath);

        // --- 构建 Shell 命令 ---
        let command: string;
        // 确保路径被正确引用
        const quotedExtractDir = quotePosixShellArgument(extractDir);
        const quotedArchiveBasename = quotePosixShellArgument(archiveBasename);

        const cdCommand = `cd ${quotedExtractDir}`;

        // 使用在方法开始处声明的 lowerArchivePath
        if (lowerArchivePath.endsWith('.zip')) {
            // unzip -o [压缩包名]
            // 需要在目标目录执行
            command = `${cdCommand} && unzip -o -- ${quotedArchiveBasename}`;
        } else if (lowerArchivePath.endsWith('.tar.gz') || lowerArchivePath.endsWith('.tgz')) {
            // tar -xzvf [压缩包名]
            // 需要在目标目录执行
            command = `${cdCommand} && tar -xzvf -- ${quotedArchiveBasename}`;
        } else if (lowerArchivePath.endsWith('.tar.bz2') || lowerArchivePath.endsWith('.tbz2')) {
            // tar -xjvf [压缩包名]
            // 需要在目标目录执行
            command = `${cdCommand} && tar -xjvf -- ${quotedArchiveBasename}`;
        } else {
            this.sendDecompressError(state.ws, `不支持的压缩文件格式: ${archivePath}`, requestId);
            return;
        }

        logger.info('Executing SFTP decompression command');

        // --- 执行命令 ---
        try {
            state.sshClient.exec(command, (err, stream) => {
                if (err) {
                    logger.error('Failed to start SFTP decompression command', { errorName: err.name });
                    this.sendDecompressError(state.ws, `执行解压命令失败: ${err.message}`, requestId);
                    return;
                }

                let stderrData = '';
                let code: number | null = null; // Track exit code

                stream.on('data', () => undefined);
                stream.stderr.on('data', (data: Buffer) => {
                    stderrData = appendSftpCommandStderr(stderrData, data);
                });

                stream.on('close', (exitCode: number | null) => {
                     code = exitCode; // Store exit code
                    logger.info('SFTP decompression command finished', { exitCode: code });
                    if (code === 0 && !this.isErrorInStdErr(stderrData)) { // 检查退出码和 stderr
                        logger.info('SFTP decompression succeeded');
                        const successPayload: SftpDecompressSuccessPayload = {
                            message: '解压成功',
                            requestId: requestId
                        };
                         if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                            state.ws.send(JSON.stringify({ type: 'sftp:decompress:success', requestId: requestId, payload: successPayload })); // Ensure requestId is included
                         }
                    } else {
                        const errorDetails = stderrData.trim() || `解压命令退出，代码: ${code ?? 'N/A'}`;
                        logger.error('SFTP decompression failed', { exitCode: code });
                        this.sendDecompressError(state.ws, '解压失败', requestId, errorDetails);
                    }
                });
                 stream.on('error', (streamErr: Error) => {
                     logger.error('SFTP decompression command stream error', { errorName: streamErr.name });
                     // 避免重复发送错误
                     if (!stderrData && code === undefined) { // 仅当 close 事件未触发且 stderr 为空时发送
                         this.sendDecompressError(state.ws, '解压命令流错误', requestId, streamErr.message);
                     }
                 });
            });
        } catch (execError: any) {
            logger.error('SFTP decompression command setup failed', { errorName: execError.name });
            this.sendDecompressError(state.ws, `执行解压时发生意外错误: ${execError.message}`, requestId);
        }
    }

    // --- 辅助方法 ---

    /** 检查远程服务器上是否存在指定的命令 */
    private checkCommandExists(state: ClientState, sessionId: string, commandName: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            if (!state.sshClient) {
                return reject(new Error('SSH client is not available.'));
            }
            // 优先使用 command -v, 其次 which
            const checkCommands = [`command -v ${commandName}`, `which ${commandName}`];
            let currentCheckIndex = 0;

            const tryCommand = () => {
                if (currentCheckIndex >= checkCommands.length) {
                    resolve(false); // 所有检查命令都尝试过了，未找到
                    return;
                }
                const checkCmd = checkCommands[currentCheckIndex];
                console.log(`[SFTP Command Check ${sessionId}] Executing: ${checkCmd}`);
                state.sshClient.exec(checkCmd, (err, stream) => {
                    if (err) {
                        console.error(`[SFTP Command Check ${sessionId}] Failed to start exec for "${checkCmd}":`, err);
                        currentCheckIndex++;
                        tryCommand(); // 尝试下一个检查命令
                        return;
                    }
                    let output = '';
                    stream.on('data', (data: Buffer) => {
                        output += data.toString();
                    });
                    stream.on('close', (code: number | null) => {
                        if (code === 0 && output.trim() !== '') {
                            console.log(`[SFTP Command Check ${sessionId}] Command '${commandName}' found using "${checkCmd}". Output: ${output.trim()}`);
                            resolve(true);
                        } else {
                            console.log(`[SFTP Command Check ${sessionId}] Command '${commandName}' not found with "${checkCmd}" (code: ${code}, output: "${output.trim()}").`);
                            currentCheckIndex++;
                            tryCommand(); // 尝试下一个检查命令
                        }
                    });
                    stream.stderr.on('data', (data: Buffer) => {
                        // console.debug(`[SFTP Command Check ${sessionId}] stderr for "${checkCmd}": ${data.toString()}`);
                    });
                    stream.on('error', (streamErr: Error) => {
                        console.error(`[SFTP Command Check ${sessionId}] Stream error for "${checkCmd}":`, streamErr);
                        currentCheckIndex++;
                        tryCommand(); // 尝试下一个检查命令
                    });
                });
            };
            tryCommand();
        });
    }


    /** 发送压缩错误消息 */
    private sendCompressError(ws: AuthenticatedWebSocket | undefined, error: string, requestId: string, details?: string): void {
         if (ws && ws.readyState === WebSocket.OPEN) {
            const payload: SftpCompressErrorPayload = { error, requestId };
            if (details) payload.details = details;
            // 检查是否是命令未找到的特定错误
            if (error.includes('在服务器上未找到')) {
                 ws.send(JSON.stringify({ type: 'sftp:command_not_found', payload: { operation: 'compress', command: error.match(/'([^']+)'/)?.[1] || 'unknown', message: details || error }, requestId }));
            } else {
                 ws.send(JSON.stringify({ type: 'sftp:compress:error', payload }));
            }
         } else {
             logger.warn('Unable to send SFTP compression error because WebSocket is unavailable');
         }
    }

    /** 发送解压错误消息 */
    private sendDecompressError(ws: AuthenticatedWebSocket | undefined, error: string, requestId: string, details?: string): void {
         if (ws && ws.readyState === WebSocket.OPEN) {
            const payload: SftpDecompressErrorPayload = { error, requestId };
            if (details) payload.details = details;
            // 检查是否是命令未找到的特定错误
            if (error.includes('在服务器上未找到')) {
                ws.send(JSON.stringify({ type: 'sftp:command_not_found', payload: { operation: 'decompress', command: error.match(/'([^']+)'/)?.[1] || 'unknown', message: details || error }, requestId }));
            } else {
                ws.send(JSON.stringify({ type: 'sftp:decompress:error', payload }));
            }
        } else {
             logger.warn('Unable to send SFTP decompression error because WebSocket is unavailable');
         }
    }

    /** 检查 stderr 输出是否包含表示错误的常见模式 */
    private isErrorInStdErr(stderr: string): boolean {
        if (!stderr || stderr.trim().length === 0) {
            return false; // 空 stderr 不是错误
        }
        const lowerStderr = stderr.toLowerCase();
        // 常见的错误关键词或模式
        const errorPatterns = [
            'error', 'fail', 'cannot', 'not found', 'no such file', 'permission denied', 'invalid', '不支持'
        ];
        // tar/zip 进度信息通常包含百分比或文件名，不应视为错误
        if (/[\d.]+%/.test(stderr) || /adding:/.test(lowerStderr) || /inflating:/.test(lowerStderr) || /extracting:/.test(lowerStderr)) {
            // 忽略一些明确的非错误输出
            if (errorPatterns.some(pattern => lowerStderr.includes(pattern))) {
                 // 如果进度信息中包含错误关键词，则可能真的是错误
                 return true;
            }
            return false;
        }

        return errorPatterns.some(pattern => lowerStderr.includes(pattern));
    }


    // --- File Upload Methods ---

    /** Start a new file upload */
    async startUpload(sessionId: string, uploadId: string, remotePath: string, totalSize: number, relativePath?: string): Promise<void> {
        const state = this.clientStates.get(sessionId);
        if (!state || !state.sftp) {
            console.warn(`[SFTP Upload ${uploadId}] SFTP not ready for session ${sessionId}.`);
            state?.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: 'SFTP 会话未就绪' } }));
            return;
        }
        if (this.activeUploads.has(uploadId)) {
            console.warn(`[SFTP Upload ${uploadId}] Upload already in progress for session ${sessionId}.`);
            state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: 'Upload already started' } }));
            return;
        }


        try {
            // --- 在创建流之前确保目录存在 ---
            if (relativePath) {
                const targetDirectory = pathModule.dirname(remotePath).replace(/\\/g, '/');
                // console.log(`[SFTP Upload ${uploadId}] Ensuring directory exists: ${targetDirectory}`);
                try {
                    // 确保 state.sftp 存在
                    if (!state.sftp) throw new Error('SFTP session is not available.');
                    await this.remoteFileOperations.ensureDirectoryExists(state.sftp, targetDirectory);
                    // console.log(`[SFTP Upload ${uploadId}] Directory ensured: ${targetDirectory}`);
                } catch (dirError: any) {
                    console.error(`[SFTP Upload ${uploadId}] Failed to create/ensure directory ${targetDirectory}:`, dirError);
                    state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: `创建目录失败: ${dirError.message}` } }));
                    // 不再删除 activeUploads，因为可能还没有创建
                    return; 
                }
            }
            
            // --- 预检查文件是否可写 ---
            try {
                // 确保 state.sftp 存在
                if (!state.sftp) throw new Error('SFTP session is not available.');
                await new Promise<void>((resolve, reject) => {
                    // 'w' flag: Open file for writing. The file is created (if it does not exist) or truncated (if it exists).
                    state.sftp!.open(remotePath, 'w', (openErr, handle) => {
                        if (openErr) {
                            // console.error(`[SFTP Upload ${uploadId}] Pre-check failed (sftp.open 'w') for ${remotePath}:`, openErr);
                            return reject(openErr); // Reject if cannot open for writing
                        }
                        // Immediately close the handle, we just wanted to check writability
                        state.sftp!.close(handle, (closeErr) => {
                            if (closeErr) {
                                // Log warning but don't fail the pre-check if closing fails
                                // console.warn(`[SFTP Upload ${uploadId}] Error closing handle during pre-check for ${remotePath}:`, closeErr);
                            }
                            resolve();
                        });
                    });
                });
            } catch (preCheckError: any) {
                 console.error(`[SFTP Upload ${uploadId}] Writability pre-check failed for ${remotePath}:`, preCheckError);
                 state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: `文件不可写或创建失败: ${preCheckError.message}` } }));
                 return; // Stop if pre-check fails
            }
            

            // 确保 state.sftp 存在
            if (!state.sftp) throw new Error('SFTP session is not available after pre-check.');
            const stream = state.sftp.createWriteStream(remotePath);
            const uploadState: ActiveUpload = {
                remotePath,
                totalSize,
                bytesWritten: 0,
                stream,
                sessionId,
                relativePath, // +++ 存储 relativePath +++
                drainPromise: null, // +++ Initialize drainPromise +++
                chunkQueue: Promise.resolve(),
                expectedChunkIndex: 0,
                lastProgressSentAt: 0,
            };
            this.activeUploads.set(uploadId, uploadState);

            stream.on('error', (err: Error) => {
                console.error(`[SFTP Upload ${uploadId}] WriteStream 'error' event for ${remotePath}:`, err);
                state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: `写入流错误: ${err.message}` } }));
                this.activeUploads.delete(uploadId);
                // console.log(`[SFTP Upload ${uploadId}] Upload state removed due to stream 'error' event.`);
            });

            stream.on('close', () => {
                const finalState = this.activeUploads.get(uploadId);

                if (finalState) {
                    if (finalState.bytesWritten >= finalState.totalSize) {
                        state.sftp!.lstat(finalState.remotePath, (statErr, stats) => {
                            if (statErr) {
                                console.error(`[SFTP Upload ${uploadId}] lstat after stream close ${finalState.remotePath} failed:`, statErr);
                                state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: `获取最终文件状态失败: ${statErr.message}` } }));
                            } else {
                                if (stats.size < finalState.totalSize) {
                                     console.error(`[SFTP Upload ${uploadId}] Final file size (${stats.size}) is less than expected total size (${finalState.totalSize}) after stream close.`);
                                     state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: `最终文件大小 (${stats.size}) 小于预期 (${finalState.totalSize})` } }));
                                } else {
                                    const finalStatsPayload = {
                                        filename: finalState.remotePath.substring(finalState.remotePath.lastIndexOf('/') + 1),
                                        longname: '',
                                        attrs: {
                                            size: stats.size, uid: stats.uid, gid: stats.gid, mode: stats.mode,
                                            atime: stats.atime * 1000, mtime: stats.mtime * 1000,
                                            isDirectory: stats.isDirectory(), isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink(),
                                        }
                                    };
                                    state.ws.send(JSON.stringify({ type: 'sftp:upload:success', payload: finalStatsPayload, uploadId: uploadId, path: finalState.remotePath }));
                                }
                            }
                            this.activeUploads.delete(uploadId);
                        });
                    } else {
                         state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: `上传未完成: 已写入 ${finalState.bytesWritten}, 预期 ${finalState.totalSize}` } }));
                         this.activeUploads.delete(uploadId);
                    }
                }
            });



            // Notify client that we are ready for chunks
            state.ws.send(JSON.stringify({ type: 'sftp:upload:ready', payload: { uploadId } }));

        } catch (error: any) {
            console.error(`[SFTP Upload ${uploadId}] Error starting upload for ${remotePath}:`, error);
            state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: `开始上传时出错: ${error.message}` } }));
            this.activeUploads.delete(uploadId); // Clean up if start failed
        }
    }

    /** Handle an incoming file chunk */
    async handleUploadChunk(sessionId: string, uploadId: string, chunkIndex: number, dataBase64: string, byteLength?: number, isLast?: boolean): Promise<void> {
        const state = this.clientStates.get(sessionId);
        const uploadState = this.activeUploads.get(uploadId);

        if (!state || !state.sftp) {
            console.warn(`[SFTP Upload ${uploadId}] Received chunk ${chunkIndex}, but session ${sessionId} or SFTP is invalid.`);
            if (uploadState?.sessionId === sessionId) {
                this.cancelUploadInternal(uploadId, 'Session or SFTP invalid');
            }
            return;
        }
        if (!uploadState) {
            console.warn(`[SFTP Upload ${uploadId}] Received chunk ${chunkIndex}, but no active upload found.`);
            return;
        }
        if (uploadState.sessionId !== sessionId) {
            this.sendUploadError(state, uploadId, '无权操作其他会话的上传任务');
            return;
        }

        // 同一上传的块必须严格串行写入，避免 WebSocket 消息并发处理时打乱 SFTP 写流背压。
        uploadState.chunkQueue = uploadState.chunkQueue.then(() => this.processUploadChunk(sessionId, uploadId, chunkIndex, dataBase64, byteLength, isLast));
        try {
            await uploadState.chunkQueue;
        } catch (error: any) {
            console.error(`[SFTP Upload ${uploadId}] Error handling chunk ${chunkIndex}:`, error);
            this.sendUploadError(state, uploadId, `处理块 ${chunkIndex} 时出错: ${error.message}`);
            this.cancelUploadInternal(uploadId, `Error handling chunk ${chunkIndex}`, error);
        }
    }

    private async processUploadChunk(sessionId: string, uploadId: string, chunkIndex: number, dataBase64: string, byteLength?: number, isLast?: boolean): Promise<void> {
        const state = this.clientStates.get(sessionId);
        const uploadState = this.activeUploads.get(uploadId);

        if (!state || !state.sftp) {
            console.warn(`[SFTP Upload ${uploadId}] Skipping chunk ${chunkIndex}; session ${sessionId} or SFTP is invalid.`);
            if (uploadState?.sessionId === sessionId) {
                this.cancelUploadInternal(uploadId, 'Session or SFTP invalid');
            }
            return;
        }
        if (!uploadState) {
            console.warn(`[SFTP Upload ${uploadId}] Skipping chunk ${chunkIndex}; no active upload found.`);
            return;
        }
        if (uploadState.sessionId !== sessionId) {
            this.sendUploadError(state, uploadId, '无权操作其他会话的上传任务');
            return;
        }
        if (chunkIndex !== uploadState.expectedChunkIndex) {
            this.sendUploadError(state, uploadId, `上传块顺序错误: 期望 ${uploadState.expectedChunkIndex}, 实际 ${chunkIndex}`);
            this.cancelUploadInternal(uploadId, `Unexpected chunk index ${chunkIndex}`);
            return;
        }

        const chunkBuffer = Buffer.from(dataBase64, 'base64');
        if (typeof byteLength === 'number' && chunkBuffer.length !== byteLength) {
            this.sendUploadError(state, uploadId, `上传块大小不匹配: 期望 ${byteLength}, 实际 ${chunkBuffer.length}`);
            this.cancelUploadInternal(uploadId, `Chunk ${chunkIndex} byte length mismatch`);
            return;
        }

        try {
            if (chunkBuffer.length > 0) {
                await this.writeUploadChunk(uploadId, uploadState, chunkIndex, chunkBuffer);
            }

            uploadState.bytesWritten += chunkBuffer.length;
            uploadState.expectedChunkIndex += 1;

            const finalChunk = isLast === true || uploadState.bytesWritten >= uploadState.totalSize;
            this.sendUploadProgress(state, uploadId, uploadState, finalChunk);
            this.sendUploadChunkAck(state, uploadId, chunkIndex, chunkBuffer.length, uploadState, finalChunk);

            if (finalChunk && !uploadState.stream.writableEnded) {
                uploadState.stream.end((endErr: Error & { code?: string } | undefined) => {
                    if (!endErr) return;
                    if (endErr.code === 'ERR_STREAM_DESTROYED' && uploadState.bytesWritten >= uploadState.totalSize) {
                        console.warn(`[SFTP Upload ${uploadId}] stream.end() reported ERR_STREAM_DESTROYED after all bytes were written.`);
                        return;
                    }
                    this.sendUploadError(state, uploadId, `结束写入流时出错: ${endErr.message}`);
                    this.cancelUploadInternal(uploadId, `Stream end error: ${endErr.message}`, endErr);
                });
            }
        } catch (error: any) {
            console.error(`[SFTP Upload ${uploadId}] Error writing chunk ${chunkIndex} to ${uploadState.remotePath}:`, error);
            this.sendUploadError(state, uploadId, `写入块 ${chunkIndex} 失败: ${error.message}`);
            this.cancelUploadInternal(uploadId, `Write error on chunk ${chunkIndex}`, error);
        }
    }

    private async writeUploadChunk(uploadId: string, uploadState: ActiveUpload, chunkIndex: number, chunkBuffer: Buffer): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const writeSuccess = uploadState.stream.write(chunkBuffer, (err) => {
                if (err) reject(err);
                else resolve();
            });

            if (!writeSuccess && !uploadState.drainPromise) {
                uploadState.drainPromise = new Promise<void>(drainResolve => {
                    uploadState.stream.once('drain', () => {
                        uploadState.drainPromise = null;
                        drainResolve();
                    });
                });
            }
        });

        if (uploadState.drainPromise) {
            try {
                await uploadState.drainPromise;
            } catch (drainError) {
                console.error(`[SFTP Upload ${uploadId}] Error awaiting drain promise for chunk ${chunkIndex}:`, drainError);
                throw drainError;
            }
        }
    }

    private sendUploadMessage(state: ClientState, message: unknown): void {
        if (state.ws?.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify(message));
        }
    }

    private sendUploadError(state: ClientState, uploadId: string, message: string): void {
        this.sendUploadMessage(state, { type: 'sftp:upload:error', payload: { uploadId, message } });
    }

    private sendUploadProgress(state: ClientState, uploadId: string, uploadState: ActiveUpload, force = false): void {
        const now = Date.now();
        if (!force && now - uploadState.lastProgressSentAt < UPLOAD_PROGRESS_THROTTLE_MS) return;
        uploadState.lastProgressSentAt = now;

        const progressPercent = uploadState.totalSize > 0
            ? Math.round((uploadState.bytesWritten / uploadState.totalSize) * 100)
            : 100;
        this.sendUploadMessage(state, {
            type: 'sftp:upload:progress',
            uploadId,
            payload: {
                bytesWritten: uploadState.bytesWritten,
                totalSize: uploadState.totalSize,
                progress: Math.min(100, progressPercent),
            },
        });
    }

    private sendUploadChunkAck(state: ClientState, uploadId: string, chunkIndex: number, byteLength: number, uploadState: ActiveUpload, isLast: boolean): void {
        this.sendUploadMessage(state, {
            type: 'sftp:upload:chunk:ack',
            uploadId,
            payload: {
                uploadId,
                chunkIndex,
                byteLength,
                bytesWritten: uploadState.bytesWritten,
                totalSize: uploadState.totalSize,
                isLast,
            },
        });
    }

    /** Cancel an ongoing upload */
    cancelUpload(sessionId: string, uploadId: string): void {
        const state = this.clientStates.get(sessionId);
        const uploadState = this.activeUploads.get(uploadId);

        if (!state) {
            console.warn(`[SFTP Upload ${uploadId}] Request to cancel, but session ${sessionId} not found.`);
            if (uploadState?.sessionId === sessionId) {
                this.cancelUploadInternal(uploadId, 'Session not found');
            }
            return;
        }
        if (!uploadState) {
            console.warn(`[SFTP Upload ${uploadId}] Request to cancel, but no active upload found.`);
            state.ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId, message: '无效的上传 ID 或上传已取消/完成' } }));
            return;
        }
        if (uploadState.sessionId !== sessionId) {
            this.sendUploadError(state, uploadId, '无权取消其他会话的上传任务');
            return;
        }

        console.log(`[SFTP Upload ${uploadId}] Cancelling upload for ${uploadState.remotePath}`);
        this.cancelUploadInternal(uploadId, 'User cancelled');
        state.ws.send(JSON.stringify({ type: 'sftp:upload:cancelled', payload: { uploadId } }));
    }

    /** Internal helper to clean up an upload */
    private cancelUploadInternal(uploadId: string, reason: string, triggeringError?: any): void {
        const uploadState = this.activeUploads.get(uploadId);
        const callTimestamp = Date.now(); // Keep timestamp for potential future use if needed

        if (uploadState) {
            const currentStream = uploadState.stream;

            if (currentStream && !currentStream.destroyed) {
                if (!currentStream.writableEnded) {
                    currentStream.end((endErr: Error | undefined) => {
                        if (endErr) {
                            console.error(`[SFTP Upload ${uploadId}] cancelUploadInternal: Error from stream.end() in cancel:`, endErr, `Original reason for cancel: ${reason}`);
                            if (!currentStream.destroyed) {
                                currentStream.destroy(); // Removed error argument
                            }
                        }
                    });
                } else {
                     currentStream.destroy(); // Removed error argument
                }
            }
            this.activeUploads.delete(uploadId);
        }
    }
}
