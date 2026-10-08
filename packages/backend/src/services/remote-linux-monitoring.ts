export const PROCESS_STATISTICS_UNAVAILABLE = 'PROCESS_STATISTICS_UNAVAILABLE';

/** Linux fallback for minimal BusyBox builds; only /proc, awk and optional getconf are needed. */
export const PROC_PROCESS_COMMAND = String.raw`awk -v hz="$(getconf CLK_TCK 2>/dev/null)" 'BEGIN {
  while ((getline line < "/proc/stat") > 0) {
    n=split(line,a," ");
    if(a[1]=="cpu") for(j=2;j<=9 && j<=n;j++) total+=a[j];
    if(a[1] ~ /^cpu[0-9]+$/) cores++;
    if(a[1]=="btime") boot=a[2];
  }
  close("/proc/stat");
  while ((getline line < "/proc/meminfo") > 0) { split(line,a," "); if(a[1]=="MemTotal:") memory=a[2]; }
  close("/proc/meminfo");
  while ((getline line < "/etc/passwd") > 0) { split(line,a,":"); users[a[3]]=a[1]; }
  close("/etc/passwd");
  printf "__PROC__\t%.0f\t%d\t%.0f\t%d\t%.0f\n",total,cores,boot,hz,memory;
  for(i=1;i<ARGC;i++) {
    file=ARGV[i]; if((getline line < file)<=0) { close(file); continue; } close(file);
    count=split(file,path,"/"); pid=path[count-1]; name=line; sub(/^[^(]*\(/,"",name); sub(/\) [^)]*$/,"",name);
    sub(/^.*\) /,"",line); split(line,a," "); state=a[1]; ticks=a[12]+a[13]; start=a[20];
    file="/proc/" pid "/status"; uid=""; rss=0;
    while((getline line < file)>0) { split(line,b," "); if(b[1]=="Uid:") uid=b[2]; if(b[1]=="VmRSS:") rss=b[2]; } close(file);
    if(uid=="") continue;
    user=(uid in users)?users[uid]:uid;
    gsub(/[\t\r\n]/," ",name);
    printf "%d\t%s\t%s\t%.0f\t%.0f\t%.0f\t%s\n",pid,user,state,ticks,start,rss,name;
  }
  exit;
}' /proc/[0-9]*/stat`;

// Callers supply fixed commands only; evaluate ps before a pipeline can mask its failure.
export function withProcProcessFallback(command: string, formatter: string): string {
  return `if process_output=$(${command} 2>/dev/null); then printf '%s\\n' "$process_output" | ${formatter}; else ${PROC_PROCESS_COMMAND}; fi`;
}

interface ProcSample { total: number; processes: Map<number, { ticks: number; start: number }> }
const samples = new WeakMap<object, ProcSample>();

export function parseProcProcesses(raw: string, owner: object) {
  const [header, ...lines] = raw.trim().split('\n');
  const [marker, totalText, coresText, bootText, hzText, memoryText] = header.split('\t');
  const total = Number(totalText);
  const cores = Number(coresText);
  const hz = Number(hzText);
  const memory = Number(memoryText);
  const boot = Number(bootText);
  if (marker !== '__PROC__' || ![total, cores, hz, boot, memory].every(Number.isFinite)
    || total < 0 || !Number.isInteger(cores) || cores <= 0 || hz < 0 || boot < 0 || memory <= 0) {
    throw new Error(PROCESS_STATISTICS_UNAVAILABLE);
  }
  const previous = samples.get(owner);
  const next: ProcSample = { total, processes: new Map() };
  const processes = lines.flatMap(line => {
    const [pidText, user, state, ticksText, startText, rssText, ...name] = line.split('\t');
    const pid = Number(pidText), ticks = Number(ticksText), start = Number(startText), rss = Number(rssText);
    if (!Number.isInteger(pid) || pid <= 0 || !user || !/^[A-Z]$/.test(state) || ![ticks, start, rss].every(value => Number.isFinite(value) && value >= 0)) return [];
    next.processes.set(pid, { ticks, start });
    const old = previous?.processes.get(pid);
    // Tick ratios avoid architecture-dependent CLK_TCK and page-size assumptions.
    const cpu = old?.start === start && previous && total > previous.total && ticks >= old.ticks
      ? Math.min(cores * 100, (ticks - old.ticks) / (total - previous.total) * cores * 100) : 0;
    const started = hz > 0 && boot > 0 ? new Date((boot + start / hz) * 1000) : undefined;
    const startedAt = started && Number.isFinite(started.getTime())
      ? started.toISOString().replace('T', ' ').slice(5, 19) + ' UTC' : '-';
    return [{ pid, user, state, cpu: Number(cpu.toFixed(1)), memPercent: memory > 0 ? Number((rss / memory * 100).toFixed(1)) : 0,
      memMb: Number((rss / 1024).toFixed(1)), startedAt, command: name.join(' ').trim() || '-' }];
  });
  if (processes.length === 0) throw new Error(PROCESS_STATISTICS_UNAVAILABLE);
  samples.set(owner, next);
  return { processes: processes.sort((a, b) => b.cpu - a.cpu || a.pid - b.pid), summary: {
    total: processes.length, running: processes.filter(p => p.state === 'R').length,
    sleeping: processes.filter(p => ['S', 'D', 'I'].includes(p.state)).length,
  } };
}

const decodeMountField = (value: string) => value.replace(/\\(040|011|012|134)/g, (_, code: string) => String.fromCharCode(parseInt(code, 8)));

export function resolveDiskMount(raw: string): { diskDevice?: string; diskIoUnsupported?: boolean } {
  const mounts = raw.split('\n').map(line => {
    const [device = '', mount = '', type = '', options = ''] = line.trim().split(/\s+/);
    return { device: decodeMountField(device), mount: decodeMountField(mount), type, options };
  });
  let current = mounts.find(entry => entry.mount === '/');
  const visited = new Set<string>();
  while (current && !visited.has(current.mount)) {
    visited.add(current.mount);
    if (current.type !== 'overlay') {
      const diskIoUnsupported = ['jffs2', 'ubifs'].includes(current.type) || /^\/dev\/mtd/.test(current.device);
      return { ...(current.device.startsWith('/dev/') && current.device !== '/dev/root' ? { diskDevice: current.device.slice(5) } : {}), diskIoUnsupported };
    }
    const upper = current.options.split(',').find(option => option.startsWith('upperdir='));
    if (!upper) return {};
    const path = decodeMountField(upper.slice('upperdir='.length));
    current = mounts.filter(entry => entry.mount !== '/' && (path === entry.mount || path.startsWith(entry.mount + '/')))
      .sort((a, b) => b.mount.length - a.mount.length)[0];
  }
  return {};
}
