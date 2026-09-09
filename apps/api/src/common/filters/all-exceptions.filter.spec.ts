import { BadRequestException, ForbiddenException, ArgumentsHost, Logger } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

beforeAll(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
afterAll(() => jest.restoreAllMocks());

function mockHost(reqHeaders: Record<string, unknown> = {}) {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, unknown>,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    setHeader(k: string, v: unknown) { this.headers[k] = v; },
  };
  const req = { method: 'GET', originalUrl: '/api/x', headers: reqHeaders };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('passes an HttpException body through unchanged with its status', () => {
    const { host, res } = mockHost();
    filter.catch(new ForbiddenException({ statusCode: 403, code: 'FORBIDDEN_ACTION', action: 'x' }), host);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ statusCode: 403, code: 'FORBIDDEN_ACTION', action: 'x' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('preserves ValidationPipe-style array messages', () => {
    const { host, res } = mockHost();
    filter.catch(new BadRequestException(['name must be a string']), host);
    expect(res.statusCode).toBe(400);
    expect((res.body as any).message).toEqual(['name must be a string']);
  });

  it('wraps an unknown error as a generic 500 with a request id and no internals', () => {
    const { host, res } = mockHost();
    filter.catch(new Error('secret db detail: password=hunter2'), host);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ statusCode: 500, message: 'Internal server error', requestId: expect.any(String) });
    expect(JSON.stringify(res.body)).not.toMatch(/hunter2/);
  });

  it('echoes an inbound x-request-id', () => {
    const { host, res } = mockHost({ 'x-request-id': 'abc-123' });
    filter.catch(new Error('boom'), host);
    expect(res.headers['x-request-id']).toBe('abc-123');
    expect((res.body as any).requestId).toBe('abc-123');
  });
});
