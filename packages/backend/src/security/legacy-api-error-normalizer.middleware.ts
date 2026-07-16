import type { RequestHandler, Response } from 'express';

import type { ApiErrorEnvelope } from '@fantetic-terminal/contracts';

import { createApiErrorEnvelope } from './api-error-envelope';

const isApiErrorEnvelope = (body: unknown): body is ApiErrorEnvelope => (
  typeof body === 'object'
  && body !== null
  && typeof (body as Partial<ApiErrorEnvelope>).code === 'string'
  && Array.isArray((body as Partial<ApiErrorEnvelope>).args)
  && typeof (body as Partial<ApiErrorEnvelope>).requestId === 'string'
);

/**
 * 在逐模块迁移期间，防止旧 Controller 将错误详情直接输出给 API 客户端。
 * 已使用标准信封的端点保持原有业务错误码，不受该兼容层影响。
 */
export const normalizeLegacyApiErrorResponse: RequestHandler = (_request, response, next): void => {
  const originalJson = response.json.bind(response);

  response.json = ((body: unknown): Response => {
    if (response.statusCode >= 400 && !isApiErrorEnvelope(body)) {
      const envelope = createApiErrorEnvelope('api.legacyError');
      response.setHeader('X-Request-Id', envelope.requestId);
      return originalJson(envelope);
    }
    return originalJson(body);
  }) as Response['json'];

  next();
};
