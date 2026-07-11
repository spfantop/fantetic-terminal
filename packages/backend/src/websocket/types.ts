import WebSocket from 'ws';
import { Client, ClientChannel, SFTPWrapper } from 'ssh2';
import type { TelnetService } from '../telnet/telnet.service';
import type { AuthorizationSubject } from '../access-control/authorization-subject';

// 扩展 WebSocket 类型以包含会话 ID
export interface AuthenticatedWebSocket extends WebSocket {
    isAlive?: boolean;
    userId?: number;
    username?: string;
    sessionId?: string; 
    missedHeartbeatCount?: number;
    authorization?: AuthorizationSubject;
}

// 中心化的客户端状态接口 (统一版本)
export interface ClientState { // 导出以便 Service 可以导入
    ws: AuthenticatedWebSocket;
    sshClient: Client;
    sshShellStream?: ClientChannel;
    dbConnectionId: number;
    connectionName?: string; // 连接名称字段
    sftp?: SFTPWrapper; //  sftp 实例 (由 SftpService 管理)
    statusIntervalId?: NodeJS.Timeout; // 状态轮询 ID (由 StatusMonitorService 管理)
    dockerStatusIntervalId?: NodeJS.Timeout; //  Docker 状态轮询 ID
    ipAddress?: string; //  IP 地址字段
    isShellReady?: boolean; // 标记 Shell 是否已准备好处理输入和调整大小
    isSuspendedByService?: boolean; // 标记此会话是否已被 SshSuspendService 接管
    isMarkedForSuspend?: boolean; // 标记此会话是否已被用户请求挂起（等待断开连接）
    suspendLogPath?: string;      // 如果标记挂起，则存储日志路径 (基于原始 sessionId)
    pendingSshOutputBuffer?: Buffer[]; // SSH 输出短窗口聚合缓冲
    pendingSshOutputBytes?: number; // SSH 输出聚合缓冲字节数
    sshOutputFlushTimer?: NodeJS.Timeout; // WebSocket 背压下的延迟输出任务
    isSshOutputMicrotaskScheduled?: boolean; // 小输出低延迟刷新任务是否已排队
    isSshOutputPaused?: boolean; // WebSocket 输出背压时暂停 SSH 读取
    pendingSshInputBuffer?: (string | Buffer)[]; // SSH 输入背压缓冲
    pendingSshInputByteCount?: number; // SSH 输入背压缓冲字节数
    isSshInputBackpressured?: boolean; // 标记 SSH 输入流是否处于背压状态
    sshInputDrainHandler?: () => void; // SSH 输入流 drain 监听器
    supportsSshBinaryOutput?: boolean; // 前端支持 SSH 输出二进制帧，避免 base64/JSON 热路径开销
    supportsSshBinaryInput?: boolean; // 前端支持 SSH 输入二进制帧，避免 JSON 字符串热路径开销
    lastSshInputOverflowWarnAt?: number; // 输入缓冲溢出日志节流时间
    telnetService?: TelnetService;
    telnetSessionId?: string;
    connectedAt?: number;
    // suspendLogWritableStream?: NodeJS.WritableStream; // 移除，将直接使用 temporaryLogStorageService.writeToLog
}

export interface PortInfo {
  IP?: string;
  PrivatePort: number;
  PublicPort?: number;
  Type: 'tcp' | 'udp' | string;
}

// --- Docker Interfaces (Ensure this matches frontend and DockerService) ---
// Stats 接口
export interface DockerStats {
    ID: string;       
    Name: string;     
    CPUPerc: string;  
    MemUsage: string; 
    MemPerc: string;  
    NetIO: string;    
    BlockIO: string;  
    PIDs: string;     
}

// Container 接口 (包含 stats)
export interface DockerContainer {
    id: string; // 使用小写 id 以匹配前端期望
    Names: string[];
    Image: string;
    ImageID: string;
    Command: string;
    Created: number;
    State: string;
    Status: string;
    Ports: PortInfo[];
    Labels: Record<string, string>;
    stats?: DockerStats | null; // 可选的 stats 字段
}

export interface ProcessListRequest {
  type: 'process:list';
  payload?: {
    limit?: number;
  };
}

export interface ProcessSignalRequest {
  type: 'process:signal';
  payload: {
    pid: number;
    signal: 'TERM' | 'KILL';
  };
}
// --- SSH Suspend Mode WebSocket Message Types ---

// Client -> Server
export interface SshSuspendStartRequest {
  type: "SSH_SUSPEND_START";
  payload: {
    sessionId: string; // The ID of the active SSH session to be suspended
    initialBuffer?: string; // Optional: content of the terminal buffer at the time of suspend
  };
}

export interface SshSuspendListRequest {
  type: "SSH_SUSPEND_LIST_REQUEST";
}

export interface SshSuspendResumeRequest {
  type: "SSH_SUSPEND_RESUME_REQUEST";
  payload: {
    suspendSessionId: string; // The ID of the suspended session to resume
    newFrontendSessionId: string; // The new frontend session ID for the resumed connection
    clientCapabilities?: {
      sshBinaryOutput?: boolean;
      sshBinaryInput?: boolean;
    };
  };
}

export interface SshSuspendTerminateRequest {
  type: "SSH_SUSPEND_TERMINATE_REQUEST";
  payload: {
    suspendSessionId: string; // The ID of the active suspended session to terminate
  };
}

export interface SshSuspendRemoveEntryRequest {
  type: "SSH_SUSPEND_REMOVE_ENTRY";
  payload: {
    suspendSessionId: string; // The ID of the disconnected session entry to remove
  };
}

export interface SshSuspendEditNameRequest {
  type: "SSH_SUSPEND_EDIT_NAME";
  payload: {
    suspendSessionId: string;
    customName: string;
  };
}

export interface SshMarkForSuspendRequest {
  type: "SSH_MARK_FOR_SUSPEND";
  payload: {
    sessionId: string; // The ID of the active SSH session to be marked
    initialBuffer?: string; // +++ 可选的初始屏幕缓冲区内容 +++
  };
}

export interface SshUnmarkForSuspendRequest {
  type: "SSH_UNMARK_FOR_SUSPEND";
  payload: {
    sessionId: string; // The ID of the active SSH session to be unmarked
  };
}

// Server -> Client
export interface SshSuspendStartedResponse {
  type: "SSH_SUSPEND_STARTED";
  payload: {
    frontendSessionId: string; // The original frontend session ID
    suspendSessionId: string;  // The new ID for the suspended session
    success: boolean;
    error?: string;
  };
}

export interface SuspendedSessionInfo {
  suspendSessionId: string;
  connectionName: string; // Original connection name
  connectionId: string; // Original connection ID
  suspendStartTime: string; // ISO string
  customSuspendName?: string;
  backendSshStatus: 'hanging' | 'disconnected_by_backend';
  disconnectionTimestamp?: string; // ISO string, if applicable
}

export interface SshSuspendListResponse {
  type: "SSH_SUSPEND_LIST_RESPONSE";
  payload: {
    suspendSessions: SuspendedSessionInfo[];
  };
}

export interface SshSuspendResumedNotification {
  type: "SSH_SUSPEND_RESUMED_NOTIF"; // 统一为带 _NOTIF 后缀
  payload: {
    suspendSessionId: string;
    newFrontendSessionId: string; // The frontend session ID this resumed session is now associated with
    success: boolean;
    error?: string;
  };
}

export interface SshOutputCachedChunk {
  type: "SSH_OUTPUT_CACHED_CHUNK";
  payload: {
    frontendSessionId: string; // The frontend session ID to send the chunk to
    data: string;
    isLastChunk: boolean;
  };
}

export interface SshSuspendTerminatedResponse {
  type: "SSH_SUSPEND_TERMINATED";
  payload: {
    suspendSessionId: string;
    success: boolean;
    error?: string;
  };
}

export interface SshSuspendEntryRemovedResponse {
  type: "SSH_SUSPEND_ENTRY_REMOVED";
  payload: {
    suspendSessionId: string;
    success: boolean;
    error?: string;
  };
}

export interface SshSuspendNameEditedResponse {
  type: "SSH_SUSPEND_NAME_EDITED";
  payload: {
    suspendSessionId: string;
    success: boolean;
    customName?: string;
    error?: string;
  };
}

export interface SshMarkedForSuspendAck {
  type: "SSH_MARKED_FOR_SUSPEND_ACK";
  payload: {
    sessionId: string; // The ID of the session that was marked
    success: boolean;
    error?: string;
  };
}

export interface SshUnmarkedForSuspendAck { // +++  S2C 类型 +++
  type: "SSH_UNMARKED_FOR_SUSPEND_ACK";
  payload: {
    sessionId: string; // The ID of the session that was unmarked
    success: boolean;
    error?: string;
  };
}

export interface SshSuspendAutoTerminatedNotification {
  type: "SSH_SUSPEND_AUTO_TERMINATED";
  payload: {
    suspendSessionId: string;
    reason: string;
  };
}

// Union type for all client-to-server messages for SSH Suspend
export type SshSuspendClientToServerMessages =
  | SshSuspendStartRequest
  | SshSuspendListRequest
  | SshSuspendResumeRequest
  | SshSuspendTerminateRequest
  | SshSuspendRemoveEntryRequest
  | SshSuspendEditNameRequest
  | SshMarkForSuspendRequest
  | SshUnmarkForSuspendRequest; 

// Union type for all server-to-client messages for SSH Suspend
export type SshSuspendServerToClientMessages =
  | SshSuspendStartedResponse
  | SshSuspendListResponse
  | SshSuspendResumedNotification
  | SshOutputCachedChunk
  | SshSuspendTerminatedResponse
  | SshSuspendEntryRemovedResponse
  | SshSuspendNameEditedResponse
  | SshSuspendAutoTerminatedNotification
  | SshMarkedForSuspendAck
  | SshUnmarkedForSuspendAck; 



// C -> S: Request to compress files/directories
export interface SftpCompressRequestPayload {
    sources: string[]; // Array of source paths (relative to targetDirectory)
    destinationArchiveName: string; // Desired name for the archive file
    format: 'zip' | 'targz' | 'tarbz2'; // Archive format
    targetDirectory: string; // The directory where sources are located and where the archive will be created
    requestId: string;
}

// S -> C: Compression success
export interface SftpCompressSuccessPayload {
    message: string;
    requestId: string;
}

// S -> C: Compression error
export interface SftpCompressErrorPayload {
    error: string;
    details?: string; // Stderr output or specific error details
    requestId: string;
}

// C -> S: Request to decompress an archive
export interface SftpDecompressRequestPayload {
    archivePath: string; // Full path to the archive file
    requestId: string;
}

// S -> C: Decompression success
export interface SftpDecompressSuccessPayload {
    message: string;
    requestId: string;
}

// S -> C: Decompression error
export interface SftpDecompressErrorPayload {
    error: string;
    details?: string; // Stderr output or specific error details
    requestId: string;
}
// S -> C: SFTP Upload Progress (New)
export interface SftpUploadProgressPayload {
    uploadId: string; // To correlate with the specific upload
    bytesWritten: number;
    totalSize: number;
    progress: number; // Calculated percentage (0-100)
}
