import { NL2CMD_CONFIG } from './nl2cmd.constants';
import type { NL2CMDRequest } from './nl2cmd.types';
import net from 'net';

export function sanitizeUserInput(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/```[\w-]*\s*/g, '')
    .replace(/```/g, '')
    .replace(/\$\{/g, '')
    .replace(/[{}]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, NL2CMD_CONFIG.MAX_QUERY_LENGTH);
}

export function cleanCommandOutput(output: string): string {
  if (isHtmlResponse(output)) {
    return '';
  }

  const fencedCommand = output.match(/```(?:bash|sh|zsh|fish|powershell|pwsh|cmd|shell)?\s*\n?([\s\S]*?)```/i)?.[1]?.trim();
  let cleaned = (fencedCommand || output)
    .replace(/```[\w-]*\n?/g, '')
    .replace(/```/g, '')
    .trim();

  try {
    const parsedCommand = readCommandFromProviderJson(JSON.parse(cleaned));
    if (parsedCommand !== null) return parsedCommand;
  } catch {
    // Non-JSON provider output is cleaned below.
  }

  const embeddedJson = cleaned.match(/\{[\s\S]*\}/)?.[0];
  if (embeddedJson && embeddedJson !== cleaned) {
    try {
      const parsedCommand = readCommandFromProviderJson(JSON.parse(embeddedJson));
      if (parsedCommand) return parsedCommand;
    } catch {
      // Continue with plain text cleanup when embedded JSON is incomplete.
    }
  }

  cleaned = cleaned.replace(/`([^`]+)`/g, '$1').replace(/^\$\s+/, '').replace(/^>\s+/, '').trim();
  const lines = cleaned.split('\n');
  if (lines.length > 1) {
    const commandLine = lines.find((line) => {
      const trimmed = line.trim();
      return trimmed
        && !trimmed.startsWith('#')
        && !trimmed.startsWith('//')
        && !/^(可以|请|以下|下面|here|use|run|command)/i.test(trimmed);
    });
    return commandLine?.trim() || cleaned;
  }
  return cleaned;
}

export function isHtmlResponse(output: unknown): boolean {
  if (typeof output !== 'string') return false;
  const trimmed = output.trim().slice(0, 500).toLowerCase();
  return trimmed.startsWith('<!doctype html')
    || trimmed.startsWith('<html')
    || /<title>\s*one api\s*<\/title>/i.test(trimmed)
    || /<div\s+id=["']root["']\s*><\/div>/i.test(trimmed);
}

export function readProviderText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value.map(readProviderText).filter(Boolean).join('\n').trim();
  }
  if (!value || typeof value !== 'object') return '';

  const record = value as Record<string, unknown>;
  const candidates = [
    record.text,
    record.output_text,
    record.response,
    record.command,
    record.cmd,
    record.arguments,
    record.content,
    record.message,
    record.function,
    record.function_call,
    record.tool_calls,
    record.choices,
    record.output,
    record.result,
    record.data,
    record.value,
  ];
  for (const candidate of candidates) {
    const text = readProviderText(candidate);
    if (text) return text;
  }
  return '';
}

function readCommandFromProviderJson(value: unknown): string | null {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const candidates = [
    record.command,
    record.cmd,
    record.command_line,
    record.commandLine,
    record.code,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  if (typeof record.result === 'object') {
    return readCommandFromProviderJson(record.result);
  }
  if (typeof record.data === 'object') {
    return readCommandFromProviderJson(record.data);
  }
  return '';
}

export function detectDangerousCommand(command: string): string | undefined {
  const normalized = command.trim().toLowerCase();
  const dangerousPatterns: Array<{ pattern: RegExp; warning: string }> = [
    {
      pattern: /\brm\s+(-[a-z]*[rf][a-z]*|-.*\s+-.*)\s+(\/|~|\$home)(\s|$)/i,
      warning: '检测到删除根目录或用户目录的高危命令，请确认路径后再执行',
    },
    {
      pattern: /\brm\s+(-[a-z]*[rf][a-z]*)\s+\/\*/i,
      warning: '检测到可能删除根目录内容的命令，请确认路径后再执行',
    },
    {
      pattern: /\bdd\s+.*\bof=\/dev\/(sd|hd|nvme|vd)/i,
      warning: '检测到直接写入磁盘设备的命令，可能破坏数据',
    },
    {
      pattern: /\bmkfs(\.| |$)/i,
      warning: '检测到格式化文件系统命令，可能清空磁盘数据',
    },
    {
      pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/,
      warning: '检测到 fork bomb 命令，会耗尽系统资源',
    },
    {
      pattern: /\bchmod\s+(-r\s+)?777\s+(\/|~|\$home)/i,
      warning: '检测到对敏感目录开放全部权限的命令',
    },
  ];

  return dangerousPatterns.find(({ pattern }) => pattern.test(normalized))?.warning;
}

export function buildNL2CMDPrompt(request: NL2CMDRequest): string {
  const query = sanitizeUserInput(request.query);
  const osType = request.osType || 'Linux';
  const shellType = request.shellType || 'bash';
  const currentPath = request.currentPath || '~';

  return [
    '你是一个专业的命令行助手。请把用户的自然语言需求转换为一条可在终端中执行的命令。',
    '只返回 JSON，不要返回 Markdown，不要解释。',
    'JSON 格式必须是：{"command":"..."}',
    '如果命令可能修改或删除数据，优先使用交互式参数或更保守的参数。',
    `目标系统：${osType}`,
    `Shell：${shellType}`,
    `当前目录：${currentPath}`,
    `用户需求：${query}`,
  ].join('\n');
}

export function validateBaseUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('ai.baseUrlProtocolInvalid');
  }

  const hostname = url.hostname.toLowerCase();
  const blockedHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
  const ipv4PrivatePattern =
    /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|0\.)/;
  const ipv6PrivatePattern = /^(::1|fc|fd|fe80)/;
  if (
    blockedHosts.has(hostname) ||
    hostname.endsWith('.local') ||
    (net.isIPv4(hostname) && ipv4PrivatePattern.test(hostname)) ||
    (net.isIPv6(hostname) && ipv6PrivatePattern.test(hostname))
  ) {
    throw new Error('ai.baseUrlLocalBlocked');
  }

  return url;
}
