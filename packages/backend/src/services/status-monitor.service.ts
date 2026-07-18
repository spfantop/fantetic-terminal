import { Client, type ClientChannel } from 'ssh2';
import { WebSocket } from 'ws';
import type { ClientState } from '../websocket/types';
import { settingsService } from '../settings/settings.service';
import { createConnectionPollingCoordinator } from './status-monitor-polling';

interface ProcessListItem {
  pid: number;
  user: string;
  state: string;
  cpu: number;
  memPercent: number;
  memMb: number;
  startedAt: string;
  command: string;
}

interface ServerStatus {
  cpuPercent?: number;
  cpuCores?: number;
  cpuCorePercents?: number[];
  memPercent?: number;
  memUsed?: number; // MB
  memTotal?: number; // MB
  memFree?: number; // MB
  memCached?: number; // MB
  swapPercent?: number;
  swapUsed?: number; // MB
  swapTotal?: number; // MB
  diskPercent?: number;
  diskUsed?: number; // KB
  diskTotal?: number; // KB
  diskAvailable?: number; // KB
  diskMountPoint?: string;
  diskFsType?: string;
  diskDevice?: string;
  diskReadRate?: number; // Bytes per second
  diskWriteRate?: number; // Bytes per second
  cpuModel?: string;
  netRxRate?: number; // Bytes per second
  netTxRate?: number; // Bytes per second
  netRxTotalBytes?: number;
  netTxTotalBytes?: number;
  netInterface?: string;
  osName?: string;
  loadAvg?: number[];
  timezone?: string;
  uptimeSeconds?: number;
  processTotal?: number;
  processRunning?: number;
  processSleeping?: number;
  topProcesses?: ProcessListItem[];
  timestamp: number;
}

interface NetworkStats {
  [interfaceName: string]: {
    rx_bytes: number;
    tx_bytes: number;
  };
}

interface DiskIoStats {
  [deviceName: string]: {
    readBytes: number;
    writeBytes: number;
  };
}

interface CpuTimesSnapshot {
  total: number;
  idle: number;
}

interface ParsedCpuStatSnapshot {
  overall: CpuTimesSnapshot;
  perCore: CpuTimesSnapshot[];
}

const BATCH_DELIMITERS = {
  OS_RELEASE: '__END_OS_RELEASE__',
  SYSTEM_TIME: '__END_SYSTEM_TIME__',
  CPU_MODEL: '__END_CPU_MODEL__',
  FREE: '__END_FREE__',
  DF: '__END_DF__',
  UPTIME: '__END_UPTIME__',
  PROC_NET_DEV: '__END_PROC_NET_DEV__',
  PROC_STAT: '__END_PROC_STAT__',
  PROC_DISKSTATS: '__END_PROC_DISKSTATS__',
  PROCESS_SUMMARY: '__END_PROCESS_SUMMARY__',
  PROCESS_TOP: '__END_PROCESS_TOP__',
} as const;

const PROCESS_SUMMARY_COMMAND = `ps -eo state= 2>/dev/null | awk 'BEGIN{total=0;running=0;sleeping=0} {state=substr($1,1,1); total++; if(state=="R") running++; if(state=="S" || state=="D" || state=="I") sleeping++;} END{printf "%d\\t%d\\t%d", total, running, sleeping}' || true`;
const PROCESS_TOP_COMMAND = 'ps -eo pid=,user=,state=,pcpu=,pmem=,rss=,lstart=,comm= --sort=-pcpu 2>/dev/null | head -n 5 || true';

const BATCH_STAT_COMMAND = [
  'cat /etc/os-release 2>/dev/null || true',
  `echo "${BATCH_DELIMITERS.OS_RELEASE}"`,
  `(date +"%z %Z" 2>/dev/null || true; cat /proc/uptime 2>/dev/null | awk '{print int($1)}' || true)`,
  `echo "${BATCH_DELIMITERS.SYSTEM_TIME}"`,
  "cat /proc/cpuinfo 2>/dev/null | grep 'model name' | head -n 1 || lscpu 2>/dev/null | grep 'Model name:' || true",
  `echo "${BATCH_DELIMITERS.CPU_MODEL}"`,
  'free 2>/dev/null || echo FREE_FAIL',
  `echo "${BATCH_DELIMITERS.FREE}"`,
  'df -kPT / 2>/dev/null || df -kP / 2>/dev/null || df -k / 2>/dev/null || echo DF_FAIL',
  `echo "${BATCH_DELIMITERS.DF}"`,
  'uptime 2>/dev/null || true',
  `echo "${BATCH_DELIMITERS.UPTIME}"`,
  'cat /proc/net/dev 2>/dev/null || echo NET_FAIL',
  `echo "${BATCH_DELIMITERS.PROC_NET_DEV}"`,
  'cat /proc/stat 2>/dev/null || echo PROC_STAT_FAIL',
  `echo "${BATCH_DELIMITERS.PROC_STAT}"`,
  'cat /proc/diskstats 2>/dev/null || echo DISKSTATS_FAIL',
  `echo "${BATCH_DELIMITERS.PROC_DISKSTATS}"`,
  PROCESS_SUMMARY_COMMAND,
  `echo "${BATCH_DELIMITERS.PROCESS_SUMMARY}"`,
  PROCESS_TOP_COMMAND,
  `echo "${BATCH_DELIMITERS.PROCESS_TOP}"`,
].join('; ');

const COMMAND_TIMEOUT_MS = 5000;
const BATCH_COMMAND_TIMEOUT_MS = 9000;
const STATUS_UPDATE_BUFFERED_AMOUNT_LIMIT = 512 * 1024;
const MONTH_MAP: Record<string, string> = {
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

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
};

class HealthCheckCollector {
  executeSshCommand(
    sshClient: Client,
    command: string,
    timeoutMs = COMMAND_TIMEOUT_MS
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = '';
      let settled = false;
      let streamRef: ClientChannel | null = null;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        streamRef?.destroy();
        reject(new Error(`执行命令 '${command}' 超时`));
      }, timeoutMs);

      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        callback();
      };

      sshClient.exec(command, { env: { LC_ALL: 'C' } }, (err, stream) => {
        if (err) {
          settle(() => reject(new Error(`执行命令 '${command}' 失败: ${err.message}`)));
          return;
        }
        streamRef = stream;
        stream
          .on('close', () => settle(() => resolve(output.trim())))
          .on('error', (streamError: Error) =>
            settle(() => reject(new Error(`执行命令 '${command}' 失败: ${streamError.message}`)))
          )
          .on('data', (data: Buffer) => {
            output += data.toString('utf8');
          })
          .stderr.on('data', () => {});
      });
    });
  }

  executeBatchCollect(sshClient: Client): Promise<string> {
    return this.executeSshCommand(sshClient, BATCH_STAT_COMMAND, BATCH_COMMAND_TIMEOUT_MS);
  }

  splitSections(raw: string): Map<string, string> {
    const sections = new Map<string, string>();
    const delimiterEntries = Object.entries(BATCH_DELIMITERS);
    let start = 0;

    for (const [key, delimiter] of delimiterEntries) {
      const end = raw.indexOf(delimiter, start);
      if (end === -1) {
        console.warn(`[StatusMonitor] 批量采集输出缺少分隔符: ${delimiter}`);
        continue;
      }
      sections.set(key, raw.substring(start, end).trim());
      start = end + delimiter.length;
    }

    return sections;
  }

  parseOsName(raw: string): string | undefined {
    const prettyName = raw.match(/^PRETTY_NAME="?([^"]+)"?/m)?.[1];
    if (prettyName) return prettyName;
    return raw.match(/^NAME="?([^"]+)"?/m)?.[1] ?? 'Unknown';
  }

  parseSystemTime(raw: string): Pick<ServerStatus, 'timezone' | 'uptimeSeconds'> {
    const lines = raw.split('\n').map(line => line.trim()).filter(Boolean);
    const [timezoneLine, uptimeLine] = lines;
    const result: Pick<ServerStatus, 'timezone' | 'uptimeSeconds'> = {};

    if (timezoneLine) {
      const [offset, ...timezoneParts] = timezoneLine.split(/\s+/);
      const timezone = timezoneParts.join(' ');
      result.timezone = `${offset ? `GMT${offset}` : ''}${offset && timezone ? ' ' : ''}${timezone}`.trim();
    }

    const uptimeSeconds = Number.parseInt(uptimeLine ?? '', 10);
    if (Number.isFinite(uptimeSeconds) && uptimeSeconds >= 0) {
      result.uptimeSeconds = uptimeSeconds;
    }

    return result;
  }

  parseCpuModel(raw: string): string {
    const cpuInfoModel = raw.match(/model name\s*:\s*(.*)/i)?.[1]?.trim();
    if (cpuInfoModel) return cpuInfoModel;
    const lscpuModel = raw.match(/Model name:\s+(.*)/)?.[1]?.trim();
    return lscpuModel || 'Unknown';
  }

  parseMemoryStats(
    raw: string
  ): Pick<
    ServerStatus,
    | 'memTotal'
    | 'memUsed'
    | 'memPercent'
    | 'memFree'
    | 'memCached'
    | 'swapTotal'
    | 'swapUsed'
    | 'swapPercent'
  > {
    const result: Pick<
      ServerStatus,
      | 'memTotal'
      | 'memUsed'
      | 'memPercent'
      | 'memFree'
      | 'memCached'
      | 'swapTotal'
      | 'swapUsed'
      | 'swapPercent'
    > = {
      swapTotal: 0,
      swapUsed: 0,
      swapPercent: 0,
    };

    const lines = raw.split('\n');
    const headerLine = lines.find(line => line.toLowerCase().includes('total') && line.toLowerCase().includes('used'));
    const memLine = lines.find((line) => /^\s*(Mem|内存|メモリ|RAM)[:：]/.test(line));
    const swapLine = lines.find((line) => /^\s*(Swap|交换|スワップ)[:：]/.test(line));
    const kbToMb = (value: number) => Math.round(value / 1024);

    if (memLine && headerLine) {
      const headers = headerLine.trim().split(/\s+/).map(header => header.toLowerCase());
      const values = memLine.replace(/^\s*\S+[:：]\s*/, '').trim().split(/\s+/);
      const memoryFields: Record<string, number> = {};

      headers.forEach((header, index) => {
        const rawValue = Number.parseInt(values[index], 10);
        if (Number.isFinite(rawValue)) {
          memoryFields[header] = rawValue;
        }
      });

      const totalKb = memoryFields.total;
      const usedKb = memoryFields.used;
      const freeKb = memoryFields.free;
      const cachedKb = memoryFields['buff/cache'] ?? ((memoryFields.buffers ?? 0) + (memoryFields.cached ?? 0));

      if (Number.isFinite(totalKb) && Number.isFinite(usedKb)) {
        const totalMb = kbToMb(totalKb);
        const usedMb = kbToMb(usedKb);
        result.memTotal = totalMb;
        result.memUsed = usedMb;
        result.memPercent = totalMb > 0 ? parseFloat(((usedMb / totalMb) * 100).toFixed(1)) : 0;
        if (Number.isFinite(freeKb)) result.memFree = kbToMb(freeKb);
        if (Number.isFinite(cachedKb)) result.memCached = kbToMb(cachedKb);
      }
    } else if (memLine) {
      const parts = memLine.trim().split(/\s+/);
      if (parts.length >= 3) {
        const totalKb = parseInt(parts[1], 10);
        const usedKb = parseInt(parts[2], 10);
        const freeKb = parseInt(parts[3], 10);
        if (!Number.isNaN(totalKb) && !Number.isNaN(usedKb)) {
          const totalMb = kbToMb(totalKb);
          const usedMb = kbToMb(usedKb);
          result.memTotal = totalMb;
          result.memUsed = usedMb;
          result.memPercent =
            totalMb > 0 ? parseFloat(((usedMb / totalMb) * 100).toFixed(1)) : 0;
          if (!Number.isNaN(freeKb)) result.memFree = kbToMb(freeKb);
        }
      }
    }

    if (swapLine) {
      const parts = swapLine.trim().split(/\s+/);
      if (parts.length >= 3) {
        const totalKb = parseInt(parts[1], 10);
        const usedKb = parseInt(parts[2], 10);
        if (!Number.isNaN(totalKb) && !Number.isNaN(usedKb)) {
          const totalMb = kbToMb(totalKb);
          const usedMb = kbToMb(usedKb);
          result.swapTotal = totalMb;
          result.swapUsed = usedMb;
          result.swapPercent =
            totalMb > 0 ? parseFloat(((usedMb / totalMb) * 100).toFixed(1)) : 0;
        }
      }
    }

    if (
      result.memFree === undefined
      && result.memTotal !== undefined
      && result.memUsed !== undefined
    ) {
      result.memFree = Math.max(result.memTotal - result.memUsed - (result.memCached ?? 0), 0);
    }

    return result;
  }

  parseDiskStats(
    raw: string
  ): Pick<
    ServerStatus,
    | 'diskTotal'
    | 'diskUsed'
    | 'diskAvailable'
    | 'diskPercent'
    | 'diskMountPoint'
    | 'diskFsType'
    | 'diskDevice'
  > {
    for (const line of raw.split('\n').slice(1)) {
      const trimmed = line.trim();
      if (!trimmed.endsWith(' /')) continue;

      const parts = trimmed.split(/\s+/);
      if (parts.length < 5) continue;

      const hasTypeColumn = parts.length >= 7;
      const totalIndex = hasTypeColumn ? 2 : 1;
      const usedIndex = hasTypeColumn ? 3 : 2;
      const availableIndex = hasTypeColumn ? 4 : 3;
      const percentIndex = hasTypeColumn ? 5 : 4;
      const mountIndex = hasTypeColumn ? 6 : 5;
      const total = parseInt(parts[totalIndex], 10);
      const used = parseInt(parts[usedIndex], 10);
      const available = parseInt(parts[availableIndex], 10);
      const percent = parts[percentIndex]?.match(/(\d+)%/)?.[1];

      if (!Number.isNaN(total) && !Number.isNaN(used) && !Number.isNaN(available) && percent) {
        return {
          diskDevice: this.normalizeDiskDevice(parts[0]),
          diskFsType: hasTypeColumn ? parts[1] : undefined,
          diskTotal: total,
          diskUsed: used,
          diskAvailable: available,
          diskPercent: parseFloat(percent),
          diskMountPoint: parts[mountIndex] || '/',
        };
      }
    }
    return {};
  }

  parseLoadAvg(raw: string): number[] | undefined {
    const match = raw.match(/load average(?:s)?:\s*([\d.]+)[, ]?\s*([\d.]+)[, ]?\s*([\d.]+)/);
    if (!match) return undefined;
    return [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])];
  }

  parseProcNetDevFromString(raw: string): NetworkStats | null {
    const stats: NetworkStats = {};
    for (const line of raw.split('\n').slice(2)) {
      const parts = line.trim().split(/:\s+|\s+/);
      if (parts.length < 17) continue;

      const rxBytes = parseInt(parts[1], 10);
      const txBytes = parseInt(parts[9], 10);
      if (!Number.isNaN(rxBytes) && !Number.isNaN(txBytes)) {
        stats[parts[0]] = { rx_bytes: rxBytes, tx_bytes: txBytes };
      }
    }
    return Object.keys(stats).length > 0 ? stats : null;
  }

  parseProcDiskStatsFromString(raw: string): DiskIoStats | null {
    const stats: DiskIoStats = {};
    for (const line of raw.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;

      const deviceName = parts[2];
      const sectorsRead = parseInt(parts[5], 10);
      const sectorsWritten = parseInt(parts[9], 10);
      if (!Number.isNaN(sectorsRead) && !Number.isNaN(sectorsWritten)) {
        stats[deviceName] = {
          readBytes: sectorsRead * 512,
          writeBytes: sectorsWritten * 512,
        };
      }
    }
    return Object.keys(stats).length > 0 ? stats : null;
  }

  getDefaultInterfaceFromNetDev(netDevRaw: string): string | null {
    for (const line of netDevRaw.split('\n').slice(2)) {
      const iface = line.trim().split(':')[0];
      if (iface && iface !== 'lo') return iface;
    }
    return null;
  }

  parseProcStat(output: string): ParsedCpuStatSnapshot | null {
    const cpuLines = output
      .split('\n')
      .map(line => line.trim())
      .filter(line => /^cpu(?:\d+)?\s+/.test(line));

    if (cpuLines.length === 0) return null;

    let overall: CpuTimesSnapshot | null = null;
    const perCore: CpuTimesSnapshot[] = [];

    for (const cpuLine of cpuLines) {
      const parts = cpuLine.split(/\s+/);
      const label = parts[0];
      const fields = parts.slice(1).map(Number);
      if (fields.length < 4 || fields.slice(0, 4).some(Number.isNaN)) continue;

      const snapshot: CpuTimesSnapshot = {
        idle: fields[3] + (fields[4] ?? 0),
        total: fields.reduce((sum, value) => sum + (Number.isNaN(value) ? 0 : value), 0),
      };

      if (label === 'cpu') {
        overall = snapshot;
      } else {
        perCore.push(snapshot);
      }
    }

    return overall ? { overall, perCore } : null;
  }

  parseProcessSummary(raw: string): Pick<ServerStatus, 'processTotal' | 'processRunning' | 'processSleeping'> {
    const [total, running, sleeping] = raw.trim().split('\t').map(value => parseInt(value, 10));
    return {
      processTotal: Number.isFinite(total) ? total : undefined,
      processRunning: Number.isFinite(running) ? running : undefined,
      processSleeping: Number.isFinite(sleeping) ? sleeping : undefined,
    };
  }

  parseTopProcesses(raw: string): ProcessListItem[] {
    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s+/);
        if (parts.length < 7) return null;

        const pid = parseInt(parts[0], 10);
        const user = parts[1];
        const state = parts[2];
        const cpu = parseFloat(parts[3]);
        const memPercent = parseFloat(parts[4]);
        const rssKb = parseInt(parts[5], 10);

        if (
          !Number.isInteger(pid)
          || !user
          || !state
          || Number.isNaN(cpu)
          || Number.isNaN(memPercent)
          || Number.isNaN(rssKb)
        ) {
          return null;
        }

        const hasLstartColumns = parts.length >= 12;
        const startedAt = hasLstartColumns
          ? `${MONTH_MAP[parts[7]] ?? parts[7]}-${(parts[8] ?? '').padStart(2, '0')} ${parts[9] ?? ''}`.trim()
          : '';
        const command = hasLstartColumns ? parts.slice(11).join(' ') : parts.slice(6).join(' ');

        return {
          pid,
          user,
          state: state.slice(0, 1).toUpperCase(),
          cpu: Number(cpu.toFixed(1)),
          memPercent: Number(memPercent.toFixed(1)),
          memMb: Number((rssKb / 1024).toFixed(1)),
          startedAt,
          command: command || '-',
        };
      })
      .filter((item): item is ProcessListItem => item !== null);
  }

  normalizeDiskDevice(rawDevice?: string): string | undefined {
    if (!rawDevice) return undefined;

    let normalized = rawDevice.trim();
    if (!normalized) return undefined;
    if (normalized.startsWith('/dev/')) normalized = normalized.slice(5);

    if (/^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+)\d+$/.test(normalized)) {
      return normalized.replace(/\d+$/, '');
    }

    if (/^(nvme\d+n\d+|mmcblk\d+)p\d+$/.test(normalized)) {
      return normalized.replace(/p\d+$/, '');
    }

    return normalized;
  }

  async collectOsName(sshClient: Client): Promise<string | undefined> {
    return this.parseOsName(await this.executeSshCommand(sshClient, 'cat /etc/os-release'));
  }

  async collectCpuModel(sshClient: Client): Promise<string> {
    try {
      const cpuInfo = await this.executeSshCommand(
        sshClient,
        "cat /proc/cpuinfo | grep 'model name' | head -n 1"
      );
      const cpuModel = this.parseCpuModel(cpuInfo);
      if (cpuModel !== 'Unknown') return cpuModel;
    } catch {
      // fallback below
    }
    try {
      return this.parseCpuModel(await this.executeSshCommand(sshClient, "lscpu | grep 'Model name:'"));
    } catch {
      return 'Unknown';
    }
  }

  async collectMemoryStats(
    sshClient: Client
  ): Promise<
    Pick<
      ServerStatus,
      | 'memTotal'
      | 'memUsed'
      | 'memPercent'
      | 'memFree'
      | 'memCached'
      | 'swapTotal'
      | 'swapUsed'
      | 'swapPercent'
    >
  > {
    return this.parseMemoryStats(await this.executeSshCommand(sshClient, 'free'));
  }

  async collectDiskStats(
    sshClient: Client
  ): Promise<
    Pick<
      ServerStatus,
      | 'diskTotal'
      | 'diskUsed'
      | 'diskAvailable'
      | 'diskPercent'
      | 'diskMountPoint'
      | 'diskFsType'
      | 'diskDevice'
    >
  > {
    try {
      return this.parseDiskStats(await this.executeSshCommand(sshClient, 'df -kPT /'));
    } catch {
      return this.parseDiskStats(await this.executeSshCommand(sshClient, 'df -kP /'));
    }
  }

  async collectLoadAvg(sshClient: Client): Promise<number[] | undefined> {
    return this.parseLoadAvg(await this.executeSshCommand(sshClient, 'uptime'));
  }

  async parseProcNetDev(sshClient: Client): Promise<NetworkStats | null> {
    return this.parseProcNetDevFromString(await this.executeSshCommand(sshClient, 'cat /proc/net/dev'));
  }

  async parseProcDiskStats(sshClient: Client): Promise<DiskIoStats | null> {
    return this.parseProcDiskStatsFromString(await this.executeSshCommand(sshClient, 'cat /proc/diskstats'));
  }

  async getDefaultInterface(sshClient: Client): Promise<string | null> {
    try {
      const output = await this.executeSshCommand(
        sshClient,
        "ip route get 1.1.1.1 | grep -oP 'dev\\s+\\K\\S+'"
      );
      if (output.trim()) return output.trim();
    } catch {
      // fallback below
    }

    try {
      return this.getDefaultInterfaceFromNetDev(
        await this.executeSshCommand(sshClient, 'cat /proc/net/dev')
      );
    } catch {
      return null;
    }
  }
}

class StatusDataAggregator {
  private cpuStats = new Map<
    string,
    {
      overall: CpuTimesSnapshot;
      perCore: CpuTimesSnapshot[];
      timestamp: number;
      lastPercent: number;
      lastCorePercents: number[];
    }
  >();

  private netStats = new Map<string, { rx: number; tx: number; timestamp: number }>();
  private diskStats = new Map<string, { device: string; readBytes: number; writeBytes: number; timestamp: number }>();

  calculateCpuPercentages(
    sessionId: string,
    currentSnapshot: ParsedCpuStatSnapshot
  ): Pick<ServerStatus, 'cpuPercent' | 'cpuCorePercents' | 'cpuCores'> {
    const now = Date.now();
    const prev = this.cpuStats.get(sessionId);
    const cpuCores = currentSnapshot.perCore.length > 0 ? currentSnapshot.perCore.length : undefined;

    if (prev && prev.timestamp < now) {
      const timeDiffMs = now - prev.timestamp;
      if (timeDiffMs > 100) {
        const cpuPercent = this.calculateCpuPercent(prev.overall, currentSnapshot.overall);
        const cpuCorePercents = currentSnapshot.perCore.map((coreSnapshot, index) => {
          const previousCore = prev.perCore[index];
          return previousCore ? this.calculateCpuPercent(previousCore, coreSnapshot) : 0;
        });
        this.cpuStats.set(sessionId, {
          ...currentSnapshot,
          timestamp: now,
          lastPercent: cpuPercent,
          lastCorePercents: cpuCorePercents,
        });
        return { cpuPercent, cpuCorePercents, cpuCores };
      }
    }

    const lastPercent = prev?.lastPercent ?? 0;
    const lastCorePercents = currentSnapshot.perCore.length > 0
      ? currentSnapshot.perCore.map((_, index) => prev?.lastCorePercents[index] ?? 0)
      : [];
    this.cpuStats.set(sessionId, {
      ...currentSnapshot,
      timestamp: now,
      lastPercent,
      lastCorePercents,
    });
    return { cpuPercent: lastPercent, cpuCorePercents: lastCorePercents, cpuCores };
  }

  calculateNetRates(
    sessionId: string,
    timestamp: number,
    currentRx: number,
    currentTx: number
  ): { netRxRate: number; netTxRate: number } {
    const prev = this.netStats.get(sessionId);
    let netRxRate = 0;
    let netTxRate = 0;

    if (prev && prev.timestamp < timestamp) {
      const timeDiffSeconds = (timestamp - prev.timestamp) / 1000;
      if (timeDiffSeconds > 0.1) {
        netRxRate = Math.max(0, Math.round((currentRx - prev.rx) / timeDiffSeconds));
        netTxRate = Math.max(0, Math.round((currentTx - prev.tx) / timeDiffSeconds));
      }
    }

    this.netStats.set(sessionId, { rx: currentRx, tx: currentTx, timestamp });
    return { netRxRate, netTxRate };
  }

  calculateDiskRates(
    sessionId: string,
    timestamp: number,
    device: string,
    currentReadBytes: number,
    currentWriteBytes: number
  ): Pick<ServerStatus, 'diskReadRate' | 'diskWriteRate'> {
    const prev = this.diskStats.get(sessionId);
    let diskReadRate = 0;
    let diskWriteRate = 0;

    if (prev && prev.device === device && prev.timestamp < timestamp) {
      const timeDiffSeconds = (timestamp - prev.timestamp) / 1000;
      if (timeDiffSeconds > 0.1) {
        diskReadRate = Math.max(0, Math.round((currentReadBytes - prev.readBytes) / timeDiffSeconds));
        diskWriteRate = Math.max(0, Math.round((currentWriteBytes - prev.writeBytes) / timeDiffSeconds));
      }
    }

    this.diskStats.set(sessionId, {
      device,
      readBytes: currentReadBytes,
      writeBytes: currentWriteBytes,
      timestamp,
    });
    return { diskReadRate, diskWriteRate };
  }

  cleanup(sessionId: string): void {
    this.cpuStats.delete(sessionId);
    this.netStats.delete(sessionId);
    this.diskStats.delete(sessionId);
  }

  private calculateCpuPercent(previous: CpuTimesSnapshot, current: CpuTimesSnapshot): number {
    const totalDiff = current.total - previous.total;
    const idleDiff = current.idle - previous.idle;

    if (totalDiff <= 0) return 0;

    const usageRatio = 1 - idleDiff / totalDiff;
    return parseFloat(Math.max(0, Math.min(100, usageRatio * 100)).toFixed(1));
  }
}

export class StatusMonitorService {
  private clientStates: Map<string, ClientState>;
  private healthCollector = new HealthCheckCollector();
  private dataAggregator = new StatusDataAggregator();
  private inFlightConnections = new Set<number>();
  private pollingCoordinator: ReturnType<typeof createConnectionPollingCoordinator>;

  constructor(clientStates: Map<string, ClientState>) {
    this.clientStates = clientStates;
    this.pollingCoordinator = createConnectionPollingCoordinator({
      poll: (connectionId, sessionIdList) => this.fetchAndSendConnectionStatus(connectionId, sessionIdList),
      onConnectionEmpty: connectionId => {
        this.inFlightConnections.delete(connectionId);
        this.dataAggregator.cleanup(String(connectionId));
      },
      onPollError: (connectionId, error) => {
        console.error(`[StatusMonitor connection=${connectionId}] 聚合轮询失败:`, error);
      },
    });
  }

  async startStatusPolling(sessionId: string): Promise<void> {
    const state = this.clientStates.get(sessionId);
    if (!state || !state.sshClient || this.pollingCoordinator.hasSession(sessionId)) return;

    const enabled = await settingsService.isStatusMonitorEnabled();
    if (!enabled) {
      this.stopStatusPolling(sessionId);
      return;
    }

    let intervalMs: number;
    try {
      const intervalSeconds = await settingsService.getStatusMonitorIntervalSeconds();
      intervalMs = intervalSeconds * 1000;
      console.log(`[StatusMonitor ${sessionId}] 使用配置的轮询间隔: ${intervalSeconds} 秒 (${intervalMs}ms)`);
    } catch (error) {
      console.error(`[StatusMonitor ${sessionId}] 获取轮询间隔设置失败，将使用默认值 3000ms:`, error);
      intervalMs = 3000;
    }

    this.pollingCoordinator.join(state.dbConnectionId, sessionId, intervalMs);
  }

  stopStatusPolling(sessionId: string): void {
    this.pollingCoordinator.leave(sessionId);
  }

  dispose(): void {
    this.pollingCoordinator.dispose();
    this.inFlightConnections.clear();
  }

  async syncPollingWithEnabledSetting(): Promise<void> {
    const enabled = await settingsService.isStatusMonitorEnabled();
    for (const [sessionId, state] of this.clientStates.entries()) {
      if (!enabled) {
        this.stopStatusPolling(sessionId);
        continue;
      }

      if (state.sshClient && state.ws.readyState === WebSocket.OPEN
        && !this.pollingCoordinator.hasSession(sessionId)) {
        await this.startStatusPolling(sessionId);
      }
    }
  }

  private async fetchAndSendConnectionStatus(
    connectionId: number,
    sessionIdList: readonly string[],
  ): Promise<void> {
    if (this.inFlightConnections.has(connectionId)) return;

    const receiverList = sessionIdList.flatMap(sessionId => {
      const state = this.clientStates.get(sessionId);
      if (!state || !state.sshClient || state.ws.readyState !== WebSocket.OPEN) {
        this.stopStatusPolling(sessionId);
        return [];
      }
      if (state.ws.bufferedAmount > STATUS_UPDATE_BUFFERED_AMOUNT_LIMIT) return [];
      return [{ sessionId, state }];
    });
    if (receiverList.length === 0) return;

    this.inFlightConnections.add(connectionId);
    try {
      const status = await this.fetchServerStatus(receiverList[0].state.sshClient, String(connectionId));
      for (const { sessionId, state } of receiverList) {
        this.sendPollingMessage(sessionId, state, {
          type: 'status_update',
          payload: { connectionId: state.dbConnectionId, status },
        });
      }
    } catch (error) {
      for (const { sessionId, state } of receiverList) {
        this.sendPollingMessage(sessionId, state, {
          type: 'status:error',
          payload: {
            connectionId: state.dbConnectionId,
            message: `获取状态失败: ${getErrorMessage(error)}`,
          },
        });
      }
    } finally {
      this.inFlightConnections.delete(connectionId);
    }
  }

  private sendPollingMessage(sessionId: string, state: ClientState, message: unknown): void {
    if (state.ws.readyState !== WebSocket.OPEN) {
      this.stopStatusPolling(sessionId);
      return;
    }
    try {
      state.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error(`[StatusMonitor ${sessionId}] 发送聚合状态失败:`, error);
      this.stopStatusPolling(sessionId);
    }
  }

  private async fetchServerStatus(sshClient: Client, sessionId: string): Promise<ServerStatus> {
    const timestamp = Date.now();
    const status: Partial<ServerStatus> = { timestamp };
    const collector = this.healthCollector;

    try {
      const rawOutput = await collector.executeBatchCollect(sshClient);
      const sections = collector.splitSections(rawOutput);

      const osRaw = sections.get('OS_RELEASE');
      if (osRaw) status.osName = collector.parseOsName(osRaw);

      const systemTimeRaw = sections.get('SYSTEM_TIME');
      if (systemTimeRaw) Object.assign(status, collector.parseSystemTime(systemTimeRaw));

      const cpuModelRaw = sections.get('CPU_MODEL');
      if (cpuModelRaw) status.cpuModel = collector.parseCpuModel(cpuModelRaw);

      const freeRaw = sections.get('FREE');
      if (freeRaw && !freeRaw.includes('FREE_FAIL')) {
        Object.assign(status, collector.parseMemoryStats(freeRaw));
      }

      const dfRaw = sections.get('DF');
      if (dfRaw && !dfRaw.includes('DF_FAIL')) {
        Object.assign(status, collector.parseDiskStats(dfRaw));
      }

      const uptimeRaw = sections.get('UPTIME');
      if (uptimeRaw) status.loadAvg = collector.parseLoadAvg(uptimeRaw);

      const procStatRaw = sections.get('PROC_STAT');
      if (procStatRaw && !procStatRaw.includes('PROC_STAT_FAIL')) {
        const cpuSnapshot = collector.parseProcStat(procStatRaw);
        if (cpuSnapshot) {
          Object.assign(status, this.dataAggregator.calculateCpuPercentages(sessionId, cpuSnapshot));
        }
      }

      const netDevRaw = sections.get('PROC_NET_DEV');
      if (netDevRaw && !netDevRaw.includes('NET_FAIL')) {
        const netStats = collector.parseProcNetDevFromString(netDevRaw);
        if (netStats) {
          const defaultIface =
            collector.getDefaultInterfaceFromNetDev(netDevRaw) ||
            Object.keys(netStats).find((iface) => iface !== 'lo');
          if (defaultIface && netStats[defaultIface]) {
            status.netInterface = defaultIface;
            const { rx_bytes, tx_bytes } = netStats[defaultIface];
            status.netRxTotalBytes = rx_bytes;
            status.netTxTotalBytes = tx_bytes;
            Object.assign(
              status,
              this.dataAggregator.calculateNetRates(sessionId, timestamp, rx_bytes, tx_bytes)
            );
          }
        }
      }

      const diskStatsRaw = sections.get('PROC_DISKSTATS');
      if (diskStatsRaw && !diskStatsRaw.includes('DISKSTATS_FAIL') && status.diskDevice) {
        const diskStats = collector.parseProcDiskStatsFromString(diskStatsRaw);
        const deviceStats = diskStats?.[status.diskDevice];
        if (deviceStats) {
          Object.assign(
            status,
            this.dataAggregator.calculateDiskRates(
              sessionId,
              timestamp,
              status.diskDevice,
              deviceStats.readBytes,
              deviceStats.writeBytes
            )
          );
        }
      }

      const processSummaryRaw = sections.get('PROCESS_SUMMARY');
      if (processSummaryRaw) Object.assign(status, collector.parseProcessSummary(processSummaryRaw));

      const processTopRaw = sections.get('PROCESS_TOP');
      if (processTopRaw) status.topProcesses = collector.parseTopProcesses(processTopRaw);
    } catch (error) {
      console.warn('[StatusMonitor] 批量采集失败，降级到逐项采集:', getErrorMessage(error));
      return this.fetchServerStatusLegacy(sshClient, sessionId);
    }

    return status as ServerStatus;
  }

  private async fetchServerStatusLegacy(sshClient: Client, sessionId: string): Promise<ServerStatus> {
    const timestamp = Date.now();
    const status: Partial<ServerStatus> = { timestamp };
    const collector = this.healthCollector;

    const [osName, cpuModel, memStats, diskStats, loadAvg, netDevStats, procDiskStats] = await Promise.allSettled([
      collector.collectOsName(sshClient),
      collector.collectCpuModel(sshClient),
      collector.collectMemoryStats(sshClient),
      collector.collectDiskStats(sshClient),
      collector.collectLoadAvg(sshClient),
      collector.parseProcNetDev(sshClient),
      collector.parseProcDiskStats(sshClient),
    ]);

    if (osName.status === 'fulfilled') status.osName = osName.value;
    if (cpuModel.status === 'fulfilled') status.cpuModel = cpuModel.value;
    if (memStats.status === 'fulfilled') Object.assign(status, memStats.value);
    if (diskStats.status === 'fulfilled') Object.assign(status, diskStats.value);
    if (loadAvg.status === 'fulfilled') status.loadAvg = loadAvg.value;

    try {
      const systemTimeRaw = await collector.executeSshCommand(
        sshClient,
        `(date +"%z %Z" 2>/dev/null || true; cat /proc/uptime 2>/dev/null | awk '{print int($1)}' || true)`
      );
      Object.assign(status, collector.parseSystemTime(systemTimeRaw));
    } catch {
      // Optional Linux-only metadata.
    }

    try {
      const procStatOutput = await collector.executeSshCommand(sshClient, 'cat /proc/stat');
      const cpuSnapshot = collector.parseProcStat(procStatOutput);
      if (cpuSnapshot) {
        Object.assign(status, this.dataAggregator.calculateCpuPercentages(sessionId, cpuSnapshot));
      }
    } catch {
      status.cpuPercent = undefined;
      status.cpuCorePercents = undefined;
    }

    if (netDevStats.status === 'fulfilled' && netDevStats.value) {
      const defaultIface =
        (await collector.getDefaultInterface(sshClient)) ||
        Object.keys(netDevStats.value).find((iface) => iface !== 'lo');
      if (defaultIface && netDevStats.value[defaultIface]) {
        status.netInterface = defaultIface;
        const { rx_bytes, tx_bytes } = netDevStats.value[defaultIface];
        status.netRxTotalBytes = rx_bytes;
        status.netTxTotalBytes = tx_bytes;
        Object.assign(
          status,
          this.dataAggregator.calculateNetRates(sessionId, timestamp, rx_bytes, tx_bytes)
        );
      }
    }

    if (procDiskStats.status === 'fulfilled' && procDiskStats.value && status.diskDevice) {
      const deviceStats = procDiskStats.value[status.diskDevice];
      if (deviceStats) {
        Object.assign(
          status,
          this.dataAggregator.calculateDiskRates(
            sessionId,
            timestamp,
            status.diskDevice,
            deviceStats.readBytes,
            deviceStats.writeBytes
          )
        );
      }
    }

    try {
      const [processSummaryRaw, processTopRaw] = await Promise.all([
        collector.executeSshCommand(sshClient, PROCESS_SUMMARY_COMMAND),
        collector.executeSshCommand(sshClient, PROCESS_TOP_COMMAND),
      ]);
      Object.assign(status, collector.parseProcessSummary(processSummaryRaw));
      status.topProcesses = collector.parseTopProcesses(processTopRaw);
    } catch {
      // Process preview is best-effort and should never block status display.
    }

    return status as ServerStatus;
  }
}
