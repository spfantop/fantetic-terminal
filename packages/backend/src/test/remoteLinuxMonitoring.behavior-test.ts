import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROCESS_STATISTICS_UNAVAILABLE, withProcProcessFallback, parseProcProcesses, resolveDiskMount } from '../services/remote-linux-monitoring';

const sample = (total: number, ticks: number, start = 50) => `__PROC__\t${total}\t2\t1000\t0\t10000\n42\t0\tS\t${ticks}\t${start}\t2048\tworker (child)\n43\t1000\tR\t10\t100\t1024\tjob`;
const owner = {};
const first = parseProcProcesses(sample(1000, 100), owner);
assert.equal(first.processes.length, 2);
assert.equal(first.processes[0].memMb, 2);
assert.equal(first.processes[0].memPercent, 20.5);
assert.equal(first.processes[0].startedAt, '-');
assert.deepEqual(first.summary, { total: 2, running: 1, sleeping: 1 });
const second = parseProcProcesses(sample(1200, 150), owner);
assert.equal(second.processes[0].cpu, 50);
assert.equal(parseProcProcesses(sample(1400, 900, 200), owner).processes[0].cpu, 0, 'PID reuse must not inherit CPU counters');
assert.equal(parseProcProcesses(sample(1500, 950), {}).processes[0].cpu, 0, 'connections must not share samples');
const mounts = '/dev/mtdblock6 /overlay jffs2 rw 0 0\noverlayfs:/overlay / overlay rw,lowerdir=/,upperdir=/overlay/upper,workdir=/overlay/work 0 0';
assert.deepEqual(resolveDiskMount(mounts), { diskDevice: 'mtdblock6', diskIoUnsupported: true });
assert.deepEqual(resolveDiskMount('/dev/sda2 / ext4 rw 0 0'), { diskDevice: 'sda2', diskIoUnsupported: false });
assert.deepEqual(resolveDiskMount('/dev/sda3 /backing ext4 rw 0 0\noverlay / overlay rw,upperdir=/backing/upper 0 0'), { diskDevice: 'sda3', diskIoUnsupported: false });
assert.deepEqual(resolveDiskMount('overlay / overlay rw,lowerdir=/ 0 0'), {});
assert.deepEqual(resolveDiskMount('/dev/root / ext4 rw 0 0'), { diskIoUnsupported: false }, 'unresolved aliases must not overwrite a valid df device');
assert.throws(() => parseProcProcesses('__PROC__\tNaN\t2\t1000\t0\t10000', {}), { name: 'Error', message: PROCESS_STATISTICS_UNAVAILABLE });
assert.throws(() => parseProcProcesses('__PROC__\t100\t0\t1000\t0\t10000', {}), { name: 'Error', message: PROCESS_STATISTICS_UNAVAILABLE });
assert.throws(() => parseProcProcesses('__PROC__\t100\t2\t1000\t0\t10000', {}), { name: 'Error', message: PROCESS_STATISTICS_UNAVAILABLE });
assert.throws(() => parseProcProcesses(sample(100, 1).replace('__PROC__', '__INVALID__'), {}), { name: 'Error', message: PROCESS_STATISTICS_UNAVAILABLE });

// Run the actual collector against a procfs fixture, including names containing parentheses.
const shell = process.platform === 'win32' ? process.env.PROC_TEST_SHELL : '/bin/sh';
if (shell) {
  const root = mkdtempSync(join(tmpdir(), 'monitor-proc-'));
  try {
    const proc = join(root, 'proc');
    mkdirSync(join(proc, '42'), { recursive: true });
    mkdirSync(join(proc, '43'));
    writeFileSync(join(proc, 'stat'), 'cpu 100 0 20 880 0 0 0 0 0 0\ncpu0 50 0 10 440\ncpu1 50 0 10 440\nbtime 1000\n');
    writeFileSync(join(proc, 'meminfo'), 'MemTotal: 10000 kB\n');
    const fields = Array(22).fill('0');
    fields[0] = 'S'; fields[11] = '80'; fields[12] = '20'; fields[19] = '50';
    writeFileSync(join(proc, '42', 'stat'), '42 (worker (child)) ' + fields.join(' ') + '\n');
    writeFileSync(join(proc, '42', 'status'), 'Uid: 0 0 0 0\nVmRSS: 2048 kB\n');
    writeFileSync(join(proc, '43', 'stat'), '43 (exited) ' + fields.join(' ') + '\n');
    writeFileSync(join(root, 'passwd'), 'root:x:0:0:root:/root:/bin/sh\n');
    const procPath = proc.replace(/\\/g, '/');
    const passwdPath = join(root, 'passwd').replace(/\\/g, '/');
    const wrapped = withProcProcessFallback('ps -eo pid= --sort=-pcpu', 'head -n 5');
    assert.equal(execFileSync(shell, ['-c', "ps() { printf 'gnu-result\\n'; }; " + wrapped], { encoding: 'utf8' }).trim(), 'gnu-result');
    const command = ('ps() { return 1; }; ' + wrapped).replaceAll('/proc', procPath).replace('/etc/passwd', passwdPath)
      .replace('$(getconf CLK_TCK 2>/dev/null)', '100');
    const output = execFileSync(shell, ['-c', command], { encoding: 'utf8' });
    const snapshot = parseProcProcesses(output, {});
    assert.equal(snapshot.processes.length, 1, 'processes that exit while sampling are skipped');
    assert.equal(snapshot.processes[0].pid, 42);
    assert.equal(snapshot.processes[0].command, 'worker (child)');
    assert.equal(snapshot.processes[0].user, 'root');
    assert.equal(snapshot.processes[0].memMb, 2);
    assert.equal(snapshot.processes[0].startedAt, '01-01 00:16:40 UTC');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('remote Linux monitoring behavior tests passed');
