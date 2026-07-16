import assert from 'node:assert/strict';

import { normalizeLegacyApiErrorResponse } from '../security/legacy-api-error-normalizer.middleware';

const createResponse = () => {
  const headers = new Map<string, string>();
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); },
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  return { response, headers };
};

{
  const { response, headers } = createResponse();
  normalizeLegacyApiErrorResponse({} as any, response as any, () => undefined);
  response.status(500).json({ message: 'database details must not reach clients', error: 'SQLITE_BUSY' });
  assert.deepEqual(response.body, {
    code: 'api.legacyError',
    args: [],
    requestId: (response.body as any)?.requestId,
  });
  assert.equal(typeof (response.body as any)?.requestId, 'string');
  assert.equal(headers.get('x-request-id'), (response.body as any)?.requestId);
}

{
  const { response } = createResponse();
  normalizeLegacyApiErrorResponse({} as any, response as any, () => undefined);
  response.status(400).json({ code: 'auth.invalidCredentials', args: [], requestId: 'already-normalized' });
  assert.deepEqual(response.body, { code: 'auth.invalidCredentials', args: [], requestId: 'already-normalized' });
}

{
  const { response } = createResponse();
  normalizeLegacyApiErrorResponse({} as any, response as any, () => undefined);
  response.status(200).json({ message: 'successful response remains unchanged' });
  assert.deepEqual(response.body, { message: 'successful response remains unchanged' });
}

console.log('legacy api error normalizer behavior ok');
