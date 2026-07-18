import assert from 'node:assert/strict';

import { createMetricsHandlers, createMetricsRegistry } from '../observability/metrics';

const registry = createMetricsRegistry();
registry.recordLoginAttempt('success');
registry.recordLoginAttempt('failure');
registry.setActiveWebSocketCount(3);
registry.recordSqliteBusyError();
registry.setDataFreeBytes(1_024);
registry.recordRecordingCapacityOutcome('started');
registry.recordRecordingCapacityOutcome('pruned');
registry.recordRecordingQueueRejected();
registry.recordWebSocketQueueRejected();
registry.recordHttpRequest('GET', 200, 12);
registry.recordHttpRequest('POST', 500, 8);
assert.match(registry.render(), /fantetic_login_attempts_total\{outcome="success"\} 1/);
assert.match(registry.render(), /fantetic_login_attempts_total\{outcome="failure"\} 1/);
assert.match(registry.render(), /fantetic_websocket_active_connections 3/);
assert.match(registry.render(), /fantetic_sqlite_busy_errors_total 1/);
assert.match(registry.render(), /fantetic_data_free_bytes 1024/);
assert.match(registry.render(), /fantetic_recording_capacity_outcomes_total\{outcome="started"\} 1/);
assert.match(registry.render(), /fantetic_recording_capacity_outcomes_total\{outcome="pruned"\} 1/);
assert.match(registry.render(), /fantetic_recording_queue_rejections_total 1/);
assert.match(registry.render(), /fantetic_websocket_queue_rejections_total 1/);
assert.match(registry.render(), /fantetic_http_requests_total\{method="GET",status="200"\} 1/);
assert.match(registry.render(), /fantetic_http_request_duration_milliseconds_sum\{method="POST",status="500"\} 8/);

const createResponse = () => ({
  statusCode: 200,
  headers: {} as Record<string, string>,
  body: '',
  status(code: number) { this.statusCode = code; return this; },
  setHeader(name: string, value: string) { this.headers[name] = value; },
  type(value: string) { this.headers['Content-Type'] = value; return this; },
  send(value: string) { this.body = value; return this; },
});

const handlers = createMetricsHandlers({ registry, token: 'metrics-secret' });
const disabled = createResponse();
createMetricsHandlers({ registry }).prometheus({ get: () => 'Bearer arbitrary-value' } as any, disabled as any);
assert.equal(disabled.statusCode, 404, 'metrics must not be exposed until METRICS_TOKEN is configured');
const denied = createResponse();
handlers.prometheus({ get: () => undefined } as any, denied as any);
assert.equal(denied.statusCode, 404);

const accepted = createResponse();
handlers.prometheus({ get: () => 'Bearer metrics-secret' } as any, accepted as any);
assert.equal(accepted.statusCode, 200);
assert.equal(accepted.headers['Content-Type'], 'text/plain; version=0.0.4; charset=utf-8');
assert.match(accepted.body, /fantetic_websocket_active_connections 3/);

console.log('metrics behavior passed');
