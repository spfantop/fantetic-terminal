import WebSocket from 'ws';
import type { ClientChannel } from 'ssh2';
import type { AuthenticatedWebSocket } from '../types';
import { clientStates } from '../state';

export interface RemoteProcessInfo {
  pid: number;
  user: string;
  state: string;
  cpu: number;
  memPercent: number;
  memMb: number;
  startedAt: string;
  command: string;
}

export interface RemoteProcessSummary {
  total: number;
  running: number;
  sleeping: number;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

const PROCESS_LIST_LIMIT_DEFAULT = 200;

const buildProcessListCommand = (limit = PROCESS_LIST_LIMIT_DEFAULT): string => {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(500, Math.floor(limit)) : PROCESS_LIST_LIMIT_DEFAULT;
  return `ps -eo pid=,user=,state=,pcpu=,pmem=,rss=,lstart=,args= --sort=-pcpu | awk 'NR<=${safeLimit}{cmd=""; for(i=12;i<=NF;i++) cmd=cmd (i==12?"":" ") $i; print $1 "\\t" $2 "\\t" $3 "\\t" $4 "\\t" $5 "\\t" $6 "\\t" $7 " " $8 " " $9 " " $10 " " $11 "\\t" cmd}'`;
};

const PROCESS_SUMMARY_COMMAND = `ps -eo state= | awk 'BEGIN{total=0; running=0; sleeping=0} {state=substr($1,1,1); total++; if(state=="R") running++; if(state=="S" || state=="D" || state=="I") sleeping++;} END {printf "%d\\t%d\\t%d", total, running, sleeping}'`;

const monthMap: Record<string, string> = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};

const formatStartedAt = (raw: string): string => {
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 5) {
    return raw.trim();
  }

  const [, month, day, time] = parts;
  const monthValue = monthMap[month] ?? month;
  const dayValue = day.padStart(2, '0');
  return `${monthValue}-${dayValue} ${time}`;
};

export const parseRemoteProcessList = (output: string): RemoteProcessInfo[] => {
  return output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [pidText, user, state, cpuText, memPercentText, rssKbText, startedAtRaw, command] = line.split('\t');
      const pid = parseInt(pidText, 10);
      const cpu = parseFloat(cpuText);
      const memPercent = parseFloat(memPercentText);
      const rssKb = parseInt(rssKbText, 10);

      if (!Number.isInteger(pid) || !user || !state || Number.isNaN(cpu) || Number.isNaN(memPercent) || Number.isNaN(rssKb)) {
        return null;
      }

      return {
        pid,
        user,
        state: state.slice(0, 1).toUpperCase(),
        cpu: Number(cpu.toFixed(1)),
        memPercent: Number(memPercent.toFixed(1)),
        memMb: Number((rssKb / 1024).toFixed(1)),
        startedAt: formatStartedAt(startedAtRaw),
        command: command?.trim() || '-',
      };
    })
    .filter((item): item is RemoteProcessInfo => item !== null);
};

export const parseRemoteProcessSummary = (output: string): RemoteProcessSummary => {
  const [totalText, runningText, sleepingText] = output.trim().split('\t');
  return {
    total: Number.parseInt(totalText, 10) || 0,
    running: Number.parseInt(runningText, 10) || 0,
    sleeping: Number.parseInt(sleepingText, 10) || 0,
  };
};

const executeSshCommand = (channelOwner: AuthenticatedWebSocket, command: string): Promise<ExecResult> => {
  const sessionId = channelOwner.sessionId;
  if (!sessionId) {
    throw new Error('缺少会话 ID');
  }

  const state = clientStates.get(sessionId);
  if (!state?.sshClient) {
    throw new Error('SSH 连接未就绪');
  }

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    state.sshClient.exec(command, (err, stream: ClientChannel) => {
      if (err) {
        reject(err);
        return;
      }

      stream.on('close', (code?: number) => {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          code: typeof code === 'number' ? code : exitCode,
        });
      });

      stream.on('exit', (code?: number) => {
        if (typeof code === 'number') {
          exitCode = code;
        }
      });

      stream.on('data', (data: Buffer) => {
        stdout += data.toString('utf8');
      });

      stream.stderr.on('data', (data: Buffer) => {
        stderr += data.toString('utf8');
      });
    });
  });
};

export const fetchRemoteProcessSnapshot = async (
  ws: AuthenticatedWebSocket,
  limit = PROCESS_LIST_LIMIT_DEFAULT,
): Promise<{ processes: RemoteProcessInfo[]; summary: RemoteProcessSummary }> => {
  const [listResult, summaryResult] = await Promise.all([
    executeSshCommand(ws, buildProcessListCommand(limit)),
    executeSshCommand(ws, PROCESS_SUMMARY_COMMAND),
  ]);

  if (listResult.code !== 0 && listResult.stderr) {
    throw new Error(listResult.stderr);
  }

  if (summaryResult.code !== 0 && summaryResult.stderr) {
    throw new Error(summaryResult.stderr);
  }

  return {
    processes: parseRemoteProcessList(listResult.stdout),
    summary: parseRemoteProcessSummary(summaryResult.stdout),
  };
};

export const handleProcessList = async (ws: AuthenticatedWebSocket, sessionId: string | undefined, payload?: { limit?: number }) => {
  try {
    if (!sessionId) {
      throw new Error('缺少活动会话');
    }

    const { processes, summary } = await fetchRemoteProcessSnapshot(ws, payload?.limit);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'process:list:response',
        sessionId,
        payload: {
          processes,
          total: summary.total,
          running: summary.running,
          sleeping: summary.sleeping,
          requestedAt: Date.now(),
        },
      }));
    }
  } catch (error: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'process:list:error',
        sessionId,
        payload: {
          message: error.message || '获取进程列表失败',
        },
      }));
    }
  }
};

export const handleProcessSignal = async (
  ws: AuthenticatedWebSocket,
  sessionId: string | undefined,
  payload?: { pid?: number; signal?: 'TERM' | 'KILL' },
) => {
  const pid = Number(payload?.pid);
  const signal = payload?.signal === 'KILL' ? 'KILL' : 'TERM';

  if (!sessionId || !Number.isInteger(pid) || pid <= 0) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'process:signal:response',
        sessionId,
        payload: {
          pid,
          signal,
          success: false,
          error: '无效的 PID 或会话',
        },
      }));
    }
    return;
  }

  try {
    const result = await executeSshCommand(ws, `kill -${signal} ${pid}`);
    const success = result.code === 0 && !result.stderr;

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'process:signal:response',
        sessionId,
        payload: {
          pid,
          signal,
          success,
          error: success ? undefined : (result.stderr || `发送 ${signal} 信号失败`),
        },
      }));
    }
  } catch (error: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'process:signal:response',
        sessionId,
        payload: {
          pid,
          signal,
          success: false,
          error: error.message || `发送 ${signal} 信号失败`,
        },
      }));
    }
  }
};
