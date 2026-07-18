'use strict';

const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const dataPath = process.env.APP_BACKEND_DATA_PATH || '/app/data';
const nodeUser = process.getuid?.() === 0 ? { uid: 1000, gid: 1000 } : {};
const children = new Map();
let stopping = false;

const emit = (level, processName, message, context) => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    process: processName,
    message,
    ...(context ? { context } : {}),
  };
  process.stdout.write(`${JSON.stringify(entry)}\n`);
};

const normalizeLogLine = (processName, line, stream) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      process.stdout.write(`${JSON.stringify({ ...parsed, process: parsed.process || processName })}\n`);
      return;
    }
  } catch {
    // Child processes that do not write JSON are wrapped below.
  }
  emit(stream === 'stderr' ? 'error' : 'info', processName, trimmed);
};

const forwardOutput = (child, processName) => {
  for (const [streamName, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) {
    let buffered = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop();
      lines.forEach(line => normalizeLogLine(processName, line, streamName));
    });
    stream.on('end', () => normalizeLogLine(processName, buffered, streamName));
  }
};

const startChild = (name, command, args, options = {}) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  children.set(name, child);
  forwardOutput(child, name);
  child.once('error', error => emit('error', name, '进程无法启动', { error: error.message }));
  child.once('exit', (code, signal) => {
    children.delete(name);
    emit(code === 0 && !signal ? 'info' : 'error', name, '进程已退出', { code, signal });
    if (!stopping) shutdown(`childExit:${name}`, 1);
  });
  return child;
};

const waitFor = async (description, check, timeoutMs = 45_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${description} 未在 ${timeoutMs / 1000} 秒内就绪`);
};

const canConnect = (port) => new Promise(resolve => {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  let settled = false;
  const finish = value => {
    if (settled) return;
    settled = true;
    socket.destroy();
    resolve(value);
  };
  socket.setTimeout(1_000);
  socket.once('connect', () => finish(true));
  socket.once('timeout', () => finish(false));
  socket.once('error', () => finish(false));
});

const isHealthy = (port, requestPath) => new Promise(resolve => {
  const request = http.get({ host: '127.0.0.1', port, path: requestPath, timeout: 1_000 }, response => {
    response.resume();
    resolve(response.statusCode >= 200 && response.statusCode < 300);
  });
  request.once('timeout', () => request.destroy());
  request.once('error', () => resolve(false));
});

const readGatewaySecret = () => {
  try {
    const contents = fs.readFileSync(path.join(dataPath, '.env'), 'utf8');
    const match = contents.match(/^REMOTE_GATEWAY_SHARED_SECRET=(.+)$/m);
    const secret = match?.[1]?.trim();
    return secret && secret.length >= 32 ? secret : undefined;
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
};

const prepareGuacdRuntime = () => {
  const resolvConf = '/opt/guacd-runtime/etc/resolv.conf';
  fs.mkdirSync(path.dirname(resolvConf), { recursive: true });
  fs.copyFileSync('/etc/resolv.conf', resolvConf);
};

const shutdown = (reason, exitCode = 0) => {
  if (stopping) return;
  stopping = true;
  emit(exitCode === 0 ? 'info' : 'error', 'supervisor', '正在停止单镜像服务', { reason });
  const childList = [...children.values()];
  for (const child of childList) child.kill('SIGTERM');
  const forceTimer = setTimeout(() => {
    for (const child of children.values()) child.kill('SIGKILL');
    process.exit(exitCode || 1);
  }, 10_000);
  Promise.all(childList.map(child => new Promise(resolve => child.once('exit', resolve))))
    .then(() => {
      clearTimeout(forceTimer);
      process.exit(exitCode);
    });
};

const start = async () => {
  if (process.getuid?.() === 0) {
    // Only the mount root needs ownership on a fresh named volume. Recursing here
    // would make restarts proportional to the size of recordings and backups.
    const result = spawnSync('chown', ['node:node', dataPath]);
    if (result.status !== 0) throw new Error('无法初始化 /app/data 的写入权限');
  }

  emit('info', 'supervisor', '正在启动后端服务');
  startChild('backend', '/usr/local/bin/node', ['packages/backend/dist/index.js'], {
    cwd: '/app',
    env: process.env,
    ...nodeUser,
  });
  await waitFor('后端服务', () => isHealthy(3001, '/api/v1/health/ready'));

  const gatewaySecret = readGatewaySecret();
  if (!gatewaySecret) throw new Error('后端未生成 REMOTE_GATEWAY_SHARED_SECRET');

  prepareGuacdRuntime();
  emit('info', 'supervisor', '正在启动 guacd');
  startChild('guacd', 'chroot', ['/opt/guacd-runtime', '/opt/guacamole/sbin/guacd', '-b', '127.0.0.1', '-l', '4822', '-f']);
  await waitFor('guacd', () => canConnect(4822));

  emit('info', 'supervisor', '正在启动远程桌面网关');
  startChild('remote-gateway', '/usr/local/bin/node', ['packages/remote-gateway/dist/server.js'], {
    cwd: '/app',
    env: { ...process.env, REMOTE_GATEWAY_SHARED_SECRET: gatewaySecret },
    ...nodeUser,
  });
  await waitFor('远程桌面网关', () => isHealthy(9090, '/health/ready'));

  emit('info', 'supervisor', '正在启动前端服务');
  startChild('frontend', 'nginx', ['-g', 'daemon off;']);
  await waitFor('前端服务', () => isHealthy(80, '/'));
  emit('info', 'supervisor', '单镜像服务已就绪');
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (require.main === module) {
  start().catch(error => {
    emit('error', 'supervisor', '启动失败', { error: error.message });
    shutdown('startupFailure', 1);
  });
}

module.exports = { normalizeLogLine, readGatewaySecret };
