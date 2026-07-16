import { randomUUID } from 'node:crypto';
import type { Response } from 'express';

import type { ApiErrorArgument, ApiErrorEnvelope } from '@fantetic-terminal/contracts';

import { readAuditContext } from '../audit/audit-context';

const resolveRequestId = (): string => readAuditContext()?.requestId ?? randomUUID();

export const createApiErrorEnvelope = (
  code: string,
  args: ApiErrorArgument[] = [],
): ApiErrorEnvelope => ({
  code,
  args,
  requestId: resolveRequestId(),
});

export const sendApiError = (
  response: Pick<Response, 'setHeader' | 'status' | 'json'>,
  status: number,
  code: string,
  args: ApiErrorArgument[] = [],
): void => {
  const body = createApiErrorEnvelope(code, args);
  response.setHeader('X-Request-Id', body.requestId);
  response.status(status).json(body);
};
