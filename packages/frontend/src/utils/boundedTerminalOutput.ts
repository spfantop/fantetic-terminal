export interface BoundedQueueOptions<T> {
  maxBytes: number;
  measure: (value: T) => number;
}

export interface BoundedQueueAppendResult {
  pendingBytes: number;
  droppedBytes: number;
  accepted: boolean;
}

/**
 * 保留最新输出并丢弃最早输出，避免消费者落后时队列无限增长。
 * 单个条目超过上限时直接拒绝，避免保留不完整的 Base64 或 VT 序列。
 */
export function appendToBoundedQueue<T>(
  queue: T[],
  value: T,
  pendingBytes: number,
  options: BoundedQueueOptions<T>,
): BoundedQueueAppendResult {
  const valueBytes = Math.max(0, options.measure(value));
  let nextPendingBytes = Math.max(0, pendingBytes);
  let droppedBytes = 0;

  if (valueBytes > options.maxBytes) {
    droppedBytes = nextPendingBytes + valueBytes;
    queue.length = 0;
    return { pendingBytes: 0, droppedBytes, accepted: false };
  }

  while (queue.length > 0 && nextPendingBytes + valueBytes > options.maxBytes) {
    const dropped = queue.shift();
    if (dropped === undefined) break;
    const droppedSize = Math.max(0, options.measure(dropped));
    nextPendingBytes = Math.max(0, nextPendingBytes - droppedSize);
    droppedBytes += droppedSize;
  }

  queue.push(value);
  nextPendingBytes += valueBytes;
  return { pendingBytes: nextPendingBytes, droppedBytes, accepted: true };
}
