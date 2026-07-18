import crypto from 'node:crypto';
import type { Request, Response } from 'express';

export type LoginOutcome = 'success' | 'failure';

export type MetricsRegistry = {
  recordLoginAttempt: (outcome: LoginOutcome) => void;
  recordHttpRequest: (method: string, status: number, durationMilliseconds: number) => void;
  setActiveWebSocketCount: (count: number) => void;
  recordSqliteBusyError: () => void;
  setDataFreeBytes: (bytes: number) => void;
  recordRecordingCapacityOutcome: (outcome: 'started' | 'pruned' | 'skipped_low_disk') => void;
  recordRecordingQueueRejected: () => void;
  recordWebSocketQueueRejected: () => void;
  render: () => string;
};

export const createMetricsRegistry = (): MetricsRegistry => {
  let loginSuccessTotal = 0;
  let loginFailureTotal = 0;
  let activeWebSocketCount = 0;
  let sqliteBusyErrorTotal = 0;
  let dataFreeBytes = 0;
  let recordingQueueRejectionTotal = 0;
  let websocketQueueRejectionTotal = 0;
  const recordingCapacityOutcomeMap = new Map<'started' | 'pruned' | 'skipped_low_disk', number>();
  const httpRequestMetricMap = new Map<string, { method: string; status: number; count: number; durationMilliseconds: number }>();
  return {
    recordLoginAttempt: outcome => {
      if (outcome === 'success') loginSuccessTotal += 1;
      else loginFailureTotal += 1;
    },
    recordHttpRequest: (method, status, durationMilliseconds) => {
      const normalizedMethod = ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'].includes(method.toUpperCase())
        ? method.toUpperCase()
        : 'OTHER';
      const normalizedStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
      const key = `${normalizedMethod}:${normalizedStatus}`;
      const current = httpRequestMetricMap.get(key) ?? {
        method: normalizedMethod,
        status: normalizedStatus,
        count: 0,
        durationMilliseconds: 0,
      };
      current.count += 1;
      current.durationMilliseconds += Math.max(0, Number.isFinite(durationMilliseconds) ? durationMilliseconds : 0);
      httpRequestMetricMap.set(key, current);
    },
    setActiveWebSocketCount: count => { activeWebSocketCount = Math.max(0, Math.floor(count)); },
    recordSqliteBusyError: () => { sqliteBusyErrorTotal += 1; },
    setDataFreeBytes: bytes => { dataFreeBytes = Math.max(0, Math.floor(Number.isFinite(bytes) ? bytes : 0)); },
    recordRecordingCapacityOutcome: outcome => {
      recordingCapacityOutcomeMap.set(outcome, (recordingCapacityOutcomeMap.get(outcome) ?? 0) + 1);
    },
    recordRecordingQueueRejected: () => { recordingQueueRejectionTotal += 1; },
    recordWebSocketQueueRejected: () => { websocketQueueRejectionTotal += 1; },
    render: () => [
      '# HELP fantetic_login_attempts_total Number of completed login attempts by outcome.',
      '# TYPE fantetic_login_attempts_total counter',
      `fantetic_login_attempts_total{outcome="success"} ${loginSuccessTotal}`,
      `fantetic_login_attempts_total{outcome="failure"} ${loginFailureTotal}`,
      '# HELP fantetic_websocket_active_connections Current active WebSocket connections.',
      '# TYPE fantetic_websocket_active_connections gauge',
      `fantetic_websocket_active_connections ${activeWebSocketCount}`,
      '# HELP fantetic_sqlite_busy_errors_total Number of SQLite busy or locked errors observed.',
      '# TYPE fantetic_sqlite_busy_errors_total counter',
      `fantetic_sqlite_busy_errors_total ${sqliteBusyErrorTotal}`,
      '# HELP fantetic_data_free_bytes Available bytes in the backend data filesystem.',
      '# TYPE fantetic_data_free_bytes gauge',
      `fantetic_data_free_bytes ${dataFreeBytes}`,
      '# HELP fantetic_recording_capacity_outcomes_total Recording capacity decisions by outcome.',
      '# TYPE fantetic_recording_capacity_outcomes_total counter',
      ...(['started', 'pruned', 'skipped_low_disk'] as const).map(outcome => (
        `fantetic_recording_capacity_outcomes_total{outcome="${outcome}"} ${recordingCapacityOutcomeMap.get(outcome) ?? 0}`
      )),
      '# HELP fantetic_recording_queue_rejections_total Recording events rejected because the bounded queue was full.',
      '# TYPE fantetic_recording_queue_rejections_total counter',
      `fantetic_recording_queue_rejections_total ${recordingQueueRejectionTotal}`,
      '# HELP fantetic_websocket_queue_rejections_total WebSocket messages rejected because the bounded queue was full.',
      '# TYPE fantetic_websocket_queue_rejections_total counter',
      `fantetic_websocket_queue_rejections_total ${websocketQueueRejectionTotal}`,
      '# HELP fantetic_http_requests_total Number of HTTP requests completed by method and status.',
      '# TYPE fantetic_http_requests_total counter',
      ...[...httpRequestMetricMap.values()].sort((left, right) => (
        `${left.method}:${left.status}`.localeCompare(`${right.method}:${right.status}`)
      )).map(metric => `fantetic_http_requests_total{method="${metric.method}",status="${metric.status}"} ${metric.count}`),
      '# HELP fantetic_http_request_duration_milliseconds_sum Total HTTP request duration in milliseconds by method and status.',
      '# TYPE fantetic_http_request_duration_milliseconds_sum counter',
      ...[...httpRequestMetricMap.values()].sort((left, right) => (
        `${left.method}:${left.status}`.localeCompare(`${right.method}:${right.status}`)
      )).map(metric => `fantetic_http_request_duration_milliseconds_sum{method="${metric.method}",status="${metric.status}"} ${metric.durationMilliseconds}`),
      '',
    ].join('\n'),
  };
};

const tokenMatches = (provided: string | undefined, expected: string): boolean => {
  if (!provided || !provided.startsWith('Bearer ')) return false;
  const value = Buffer.from(provided.slice('Bearer '.length));
  const target = Buffer.from(expected);
  return value.length === target.length && crypto.timingSafeEqual(value, target);
};

export const createMetricsHandlers = ({ registry, token }: { registry: MetricsRegistry; token?: string }) => ({
  prometheus: (request: Request, response: Response): void => {
    if (!token || !tokenMatches(request.get('authorization'), token)) {
      response.status(404).send('Not found');
      return;
    }
    response.status(200).type('text/plain; version=0.0.4; charset=utf-8').send(registry.render());
  },
});

export const backendMetrics = createMetricsRegistry();
