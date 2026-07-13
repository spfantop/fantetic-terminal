interface BoundedTaskQueueOptions {
  maxTasks: number;
  maxBytes: number;
}

interface QueuedTask {
  byteLength: number;
  run: () => Promise<void>;
}

export class BoundedTaskQueue {
  private readonly taskList: QueuedTask[] = [];
  private running = false;
  private idleResolverList: Array<() => void> = [];
  pendingBytes = 0;
  pendingTasks = 0;

  constructor(private readonly options: BoundedTaskQueueOptions) {}

  enqueue(byteLength: number, task: () => Promise<void>): boolean {
    if (byteLength < 0
      || this.pendingTasks >= this.options.maxTasks
      || this.pendingBytes + byteLength > this.options.maxBytes) return false;
    this.taskList.push({ byteLength, run: task });
    this.pendingBytes += byteLength;
    this.pendingTasks += 1;
    void this.drain();
    return true;
  }

  onIdle(): Promise<void> {
    if (!this.running && this.pendingTasks === 0) return Promise.resolve();
    return new Promise(resolve => this.idleResolverList.push(resolve));
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.taskList.length > 0) {
        const task = this.taskList.shift()!;
        try {
          await task.run();
        } finally {
          this.pendingBytes -= task.byteLength;
          this.pendingTasks -= 1;
        }
      }
    } finally {
      this.running = false;
      const resolverList = this.idleResolverList.splice(0);
      resolverList.forEach(resolve => resolve());
    }
  }
}
