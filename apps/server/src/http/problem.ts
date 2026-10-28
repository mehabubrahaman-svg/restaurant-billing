import { ERROR_STATUS, type ErrorCode, type ProblemDetails } from '@restroos/contracts';
import { DomainError } from '@restroos/domain';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/** An error the HTTP layer raises on purpose, with a known code. */
export class HttpProblem extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly errors?: ProblemDetails['errors'],
    readonly permission?: string,
  ) {
    super(message);
    this.name = 'HttpProblem';
  }
}

const TITLES: Record<number, string> = {
  401: 'Unauthenticated',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

/** Domain error codes that are not in ERROR_STATUS map to 422: a business rule said no. */
function statusForCode(code: string): number {
  return (ERROR_STATUS as Record<string, number>)[code] ?? 422;
}

export function problem(
  request: FastifyRequest,
  status: number,
  code: string,
  detail?: string,
  errors?: ProblemDetails['errors'],
): ProblemDetails {
  return {
    type: `https://restroos.app/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title: TITLES[status] ?? 'Error',
    status,
    code,
    ...(detail !== undefined && { detail }),
    ...(errors !== undefined && { errors }),
    instance: request.url,
    requestId: request.id,
  };
}

export function sendProblem(reply: FastifyReply, body: ProblemDetails): FastifyReply {
  return reply.status(body.status).type('application/problem+json').send(body);
}

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof HttpProblem) {
    const body = problem(
      request,
      ERROR_STATUS[error.code],
      error.code,
      error.message,
      error.errors,
    );
    return sendProblem(reply, error.permission ? { ...body, permission: error.permission } : body);
  }
  if (error instanceof DomainError) {
    const body = problem(request, statusForCode(error.code), error.code, error.message);
    const permission = error.details?.['permission'];
    return sendProblem(reply, typeof permission === 'string' ? { ...body, permission } : body);
  }
  if (error instanceof ZodError) {
    const errors = error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return sendProblem(
      reply,
      problem(request, 422, 'VALIDATION_FAILED', 'request validation failed', errors),
    );
  }
  const status =
    'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
  if (status === 429) {
    return sendProblem(
      reply,
      problem(request, 429, 'RATE_LIMITED', 'too many requests, slow down'),
    );
  }
  if (status >= 400 && status < 500) {
    // Fastify's own client errors (bad JSON, body too large, ...).
    return sendProblem(reply, problem(request, status, 'VALIDATION_FAILED', error.message));
  }
  request.log.error({ err: error }, 'unhandled error');
  // Never leak internals to the client; the request id ties it to the log line.
  return sendProblem(reply, problem(request, 500, 'INTERNAL_ERROR', 'something went wrong'));
}
