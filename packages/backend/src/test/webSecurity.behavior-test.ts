import assert from 'node:assert/strict';

import { apiErrorHandler, createFixedWindowRateLimiter, securityHeaders, validateJsonComplexity, validateMutationOrigin } from '../security/web-security.middleware';

const createResponse = () => {
  const headers = new Map<string, string>();
  return {
    statusCode: 200,
    body: undefined as unknown,
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); },
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    headers,
  };
};

let now = 1_000;
const limiter = createFixedWindowRateLimiter({
  windowMs: 1_000,
  maxRequests: 2,
  now: () => now,
  key: request => request.ip,
});
const request = { ip: '192.0.2.1' } as any;
for (let index = 0; index < 2; index += 1) {
  const response = createResponse();
  let called = false;
  limiter(request, response as any, () => { called = true; });
  assert.equal(called, true);
}
const limitedResponse = createResponse();
limiter(request, limitedResponse as any, () => assert.fail('limited request must not continue'));
assert.equal(limitedResponse.statusCode, 429);
assert.equal(limitedResponse.headers.get('retry-after'), '1');
now = 2_001;
let resumed = false;
limiter(request, createResponse() as any, () => { resumed = true; });
assert.equal(resumed, true);

const originResponse = createResponse();
validateMutationOrigin(new Set(['https://terminal.example.com']))(
  { method: 'POST', get: (name: string) => name.toLowerCase() === 'origin' ? 'https://evil.example.com' : undefined } as any,
  originResponse as any,
  () => assert.fail('untrusted origin must not continue'),
);
assert.equal(originResponse.statusCode, 403);

let trustedOriginContinued = false;
validateMutationOrigin(new Set(['https://terminal.example.com']))(
  { method: 'POST', get: () => 'https://terminal.example.com' } as any,
  createResponse() as any,
  () => { trustedOriginContinued = true; },
);
assert.equal(trustedOriginContinued, true);

let forwardedIpOriginContinued = false;
validateMutationOrigin(new Set())(
  {
    method: 'POST',
    get: (name: string) => ({
      origin: 'http://192.168.1.20:18111',
      host: 'backend:3001',
      'x-forwarded-host': '192.168.1.20:18111',
    })[name.toLowerCase()],
  } as any,
  createResponse() as any,
  () => { forwardedIpOriginContinued = true; },
);
assert.equal(forwardedIpOriginContinued, true, 'a trusted reverse proxy must preserve the public IP origin and port');

const complexityResponse = createResponse();
validateJsonComplexity({ maxDepth: 3, maxKeys: 10, maxStringLength: 20 })(
  { body: { one: { two: { three: { four: true } } } } } as any,
  complexityResponse as any,
  () => assert.fail('overly deep JSON must not continue'),
);
assert.equal(complexityResponse.statusCode, 413);

const headerResponse = createResponse();
securityHeaders({ secure: true } as any, headerResponse as any, () => undefined);
assert.equal(headerResponse.headers.get('x-frame-options'), 'DENY');
assert.match(headerResponse.headers.get('strict-transport-security') || '', /max-age=/);

const invalidJsonResponse = createResponse();
const invalidJsonError = Object.assign(new SyntaxError('invalid json'), { status: 400 });
apiErrorHandler(invalidJsonError, {} as any, invalidJsonResponse as any, () => assert.fail('invalid JSON must be handled'));
assert.equal(invalidJsonResponse.statusCode, 400);
assert.equal((invalidJsonResponse.body as any).code, 'security.invalidJson');
assert.deepEqual((invalidJsonResponse.body as any).args, []);
assert.match((invalidJsonResponse.body as any).requestId, /^[A-Za-z0-9._:-]{1,128}$/);

const unexpectedErrorResponse = createResponse();
apiErrorHandler(new Error('internal detail must not reach the client'), {} as any, unexpectedErrorResponse as any, () => assert.fail('unexpected API errors must use the stable envelope'));
assert.equal(unexpectedErrorResponse.statusCode, 500);
assert.equal((unexpectedErrorResponse.body as any).code, 'system.internalError');
assert.deepEqual((unexpectedErrorResponse.body as any).args, []);

console.log('web security behavior ok');
