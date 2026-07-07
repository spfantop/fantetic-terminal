export type ParsedConnectionImportItem = {
  lineNumber: number;
  type: 'SSH' | 'RDP' | 'VNC';
  name: string;
  host: string;
  port: number;
  username: string;
  auth_method: 'password' | 'key';
  password?: string;
  ssh_key_name?: string;
  passphrase?: string;
  tags: string[];
  notes?: string;
};

type ScriptLineParseResult = ParsedConnectionImportItem | {
  lineNumber: number;
  error: string;
};

const DEFAULT_PORT_BY_TYPE: Record<'SSH' | 'RDP' | 'VNC', number> = {
  SSH: 22,
  RDP: 3389,
  VNC: 5900,
};

const tokenizeScriptLine = (line: string): string[] => {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const char of line) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaping) current += '\\';
  if (quote) {
    throw new Error('存在未闭合的引号。');
  }
  if (current) tokens.push(current);
  return tokens;
};

const readOptionValue = (tokens: string[], index: number, option: string): string => {
  const value = tokens[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${option} 缺少参数值。`);
  }
  return value;
};

const parseLine = (line: string, lineNumber: number): ScriptLineParseResult => {
  try {
    const tokens = tokenizeScriptLine(line);
    if (tokens.length === 0) {
      return { lineNumber, error: '空行不能导入。' };
    }

    const userHostPort = tokens[0];
    const atIndex = userHostPort.indexOf('@');
    const portSeparatorIndex = userHostPort.lastIndexOf(':');
    if (atIndex <= 0 || portSeparatorIndex <= atIndex + 1) {
      return { lineNumber, error: '连接地址格式必须为 username@host:port。' };
    }

    const username = userHostPort.slice(0, atIndex);
    const host = userHostPort.slice(atIndex + 1, portSeparatorIndex);
    const rawPort = userHostPort.slice(portSeparatorIndex + 1);
    let type: 'SSH' | 'RDP' | 'VNC' = 'SSH';
    let name = '';
    let password: string | undefined;
    let sshKeyName: string | undefined;
    let passphrase: string | undefined;
    const tags: string[] = [];
    let notes: string | undefined;

    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (!token.startsWith('-')) {
        return { lineNumber, error: `无法识别的参数：${token}` };
      }

      switch (token) {
      case '-type': {
        const value = readOptionValue(tokens, index, token).toUpperCase();
        if (!['SSH', 'RDP', 'VNC'].includes(value)) {
          return { lineNumber, error: `无效的连接类型：${value}` };
        }
        type = value as 'SSH' | 'RDP' | 'VNC';
        index += 1;
        break;
      }
      case '-name':
        name = readOptionValue(tokens, index, token);
        index += 1;
        break;
      case '-p':
        password = readOptionValue(tokens, index, token);
        index += 1;
        break;
      case '-k':
        sshKeyName = readOptionValue(tokens, index, token);
        index += 1;
        break;
      case '-passphrase':
        passphrase = readOptionValue(tokens, index, token);
        index += 1;
        break;
      case '-proxy':
        index += 1;
        break;
      case '-note':
        notes = readOptionValue(tokens, index, token);
        index += 1;
        break;
      case '-tags':
        while (tokens[index + 1] && !tokens[index + 1].startsWith('-')) {
          tags.push(tokens[index + 1]);
          index += 1;
        }
        break;
      default:
        return { lineNumber, error: `未知参数：${token}` };
      }
    }

    const port = rawPort ? Number.parseInt(rawPort, 10) : DEFAULT_PORT_BY_TYPE[type];
    if (!username || !host) {
      return { lineNumber, error: '用户名和主机不能为空。' };
    }
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      return { lineNumber, error: `端口无效：${rawPort}` };
    }
    if (type === 'SSH' && !password && !sshKeyName) {
      return { lineNumber, error: 'SSH 连接必须包含密码或 SSH 密钥名称。' };
    }
    if ((type === 'RDP' || type === 'VNC') && !password) {
      return { lineNumber, error: `${type} 连接必须包含密码。` };
    }
    if ((type === 'RDP' || type === 'VNC') && sshKeyName) {
      return { lineNumber, error: `${type} 连接不支持 SSH 密钥。` };
    }

    return {
      lineNumber,
      type,
      name: name || `${username}@${host}`,
      host,
      port,
      username,
      auth_method: sshKeyName ? 'key' : 'password',
      ...(password ? { password } : {}),
      ...(sshKeyName ? { ssh_key_name: sshKeyName } : {}),
      ...(passphrase ? { passphrase } : {}),
      tags,
      ...(notes ? { notes } : {}),
    };
  } catch (error: any) {
    return { lineNumber, error: error.message || '解析失败。' };
  }
};

export function parseConnectionImportScript(script: string): {
  connections: ParsedConnectionImportItem[];
  errors: { lineNumber: number; message: string }[];
} {
  const connections: ParsedConnectionImportItem[] = [];
  const errors: { lineNumber: number; message: string }[] = [];

  script.split(/\r?\n/).forEach((line, index) => {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) return;

    const parsed = parseLine(trimmedLine, index + 1);
    if ('error' in parsed) {
      errors.push({ lineNumber: parsed.lineNumber, message: parsed.error });
    } else {
      connections.push(parsed);
    }
  });

  return { connections, errors };
}
