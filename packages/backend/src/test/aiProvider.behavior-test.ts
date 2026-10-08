import assert from 'node:assert/strict';
import { NL2CMD_CONFIG } from '../ai-ops/nl2cmd.constants';
import axios from 'axios';
import { createServer } from 'node:http';
import { callOpenAI, callClaude, readAIErrorCode } from '../ai-ops/nl2cmd.provider';
import type { AISettings } from '../ai-ops/nl2cmd.types';

let attempts = 0;
let failureStatus = 500;
let alwaysFail = false;
let responseBody: unknown;
let retryAfter: string | undefined;
let hang = false;
let reasoningMode = false;
const server = createServer((req, res) => {
  if (reasoningMode) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const input = JSON.parse(body);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ finish_reason: input.max_tokens <= 500 ? 'length' : 'stop', message: { content: input.max_tokens <= 500 ? '' : 'pwd', reasoning_content: 'private analysis' } }] }));
    });
    return;
  }
  req.resume();
  attempts++;
  if (hang) return;
  res.setHeader('Content-Type', 'application/json');
  if (retryAfter) res.setHeader('Retry-After', retryAfter);
  if (responseBody !== undefined) { res.end(JSON.stringify(responseBody)); return; }
  if (attempts === 1 || alwaysFail) {
    res.writeHead(failureStatus).end(JSON.stringify({ error: { message: 'temporary failure' } }));
  } else {
    res.end(JSON.stringify({ choices: [{ message: { content: '{"command":"pwd"}' } }], content: [{ type: 'text', text: 'pwd' }], output_text: 'pwd' }));
  }
});
async function run() {
  const retryDelay = NL2CMD_CONFIG.RETRY_BASE_DELAY_MS;
  Object.assign(NL2CMD_CONFIG, { RETRY_BASE_DELAY_MS: 10 });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const settings: AISettings = { enabled: true, provider: 'openai', baseUrl: `http://127.0.0.1:${address.port}`, apiKey: 'test-only', model: 'test' };
  try {
    assert.equal((await callOpenAI(settings, 'print directory')).command, '{"command":"pwd"}');
    assert.equal(attempts, 2, 'temporary upstream 500 should recover in the same request');
    for (const status of [429, 502, 503, 504, 529]) {
      attempts = 0;
      failureStatus = status;
      assert.equal((await callClaude(settings, 'print directory')).command, 'pwd');
      assert.equal(attempts, 2);
    }
    attempts = 0;
    assert.equal((await callOpenAI({ ...settings, openaiEndpoint: '/responses' }, 'directory')).command, 'pwd');
    assert.equal(attempts, 2);
    for (const status of [400, 401, 403, 404]) {
      attempts = 0;
      failureStatus = status;
      await assert.rejects(callOpenAI(settings, 'directory'), error => axios.isAxiosError(error) && error.response?.status === status);
      assert.equal(attempts, 1, 'permanent errors must not retry');
    }
    attempts = 0;
    failureStatus = 503;
    alwaysFail = true;
    await assert.rejects(callOpenAI(settings, 'directory'));
    assert.equal(attempts, 3, 'persistent failures are bounded');
    attempts = 0;
    retryAfter = '120';
    await assert.rejects(callOpenAI(settings, 'directory'));
    assert.equal(attempts, 1, 'Retry-After exceeding the budget must not retry early');
    retryAfter = undefined;
    alwaysFail = false;
    responseBody = {
      object: 'response', status: 'completed', error: null, incomplete_details: null,
      output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"command":"pwd"}' }] }],
    };
    assert.equal((await callOpenAI({ ...settings, openaiEndpoint: '/responses' }, 'directory')).command, '{"command":"pwd"}', 'successful Responses payloads include error: null');
    responseBody = { error: { message: 'provider failure' }, message: 'must never be a command' };
    await assert.rejects(callOpenAI(settings, 'directory'), /ai\.serviceUnavailable/);
    assert.equal(readAIErrorCode(new Error('ai.serviceUnavailable')), 'ai.serviceUnavailable', 'provider failures retain their actionable error code');
    assert.equal(readAIErrorCode(new Error('private upstream details')), 'ai.generateFailed', 'unknown error messages must not leak');
    for (const status of ['failed', 'cancelled', 'queued', 'in_progress']) {
      responseBody = { status, error: null, output_text: 'must not be returned' };
      await assert.rejects(callOpenAI({ ...settings, openaiEndpoint: '/responses' }, 'directory'), /ai\.serviceUnavailable/);
    }
    responseBody = { output_text: { invalid: true } };
    await assert.rejects(callOpenAI({ ...settings, openaiEndpoint: '/responses' }, 'directory'), /ai\.emptyCommand/);
    responseBody = { status: 'incomplete', error: null, output_text: 'rm -r' };
    await assert.rejects(callOpenAI({ ...settings, openaiEndpoint: '/responses' }, 'directory'), /ai\.outputTruncated/);
    responseBody = { stop_reason: 'max_tokens', content: [{ text: 'rm -r' }] };
    await assert.rejects(callClaude(settings, 'directory'), /ai\.outputTruncated/);
    responseBody = null;
    await assert.rejects(callOpenAI(settings, 'directory'), /ai\.emptyCommand/);
    responseBody = undefined;
    reasoningMode = true;
    assert.equal((await callOpenAI(settings, 'directory')).command, 'pwd', 'reasoning exhausting the initial budget must recover without exposing reasoning');
    reasoningMode = false;
    responseBody = { choices: [{ finish_reason: 'length', message: { content: 'rm -r', reasoning_content: 'analysis' } }] };
    await assert.rejects(callOpenAI(settings, 'directory'), /ai\.outputTruncated/, 'partial commands must never reach the terminal');
    const originalConfig = { ...NL2CMD_CONFIG };
    try {
      Object.assign(NL2CMD_CONFIG, { REQUEST_TIMEOUT_MS: 40, TOTAL_TIMEOUT_MS: 70, RETRY_BASE_DELAY_MS: 5 });
      responseBody = undefined;
      hang = true;
      attempts = 0;
      const started = Date.now();
      await assert.rejects(callOpenAI(settings, 'directory'));
      assert.ok(Date.now() - started < 250, 'all attempts share the timeout budget');
      assert.equal(attempts, 2);
    } finally {
      Object.assign(NL2CMD_CONFIG, originalConfig);
    }
  } finally {
    Object.assign(NL2CMD_CONFIG, { RETRY_BASE_DELAY_MS: retryDelay });
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
run().then(() => console.log('AI provider behavior ok')).catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
