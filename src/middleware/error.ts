import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { isProd } from '../config/env';
import { AppError } from '../utils/errors';
import { connectDb } from '../config/db';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  await connectDb();
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code ?? 'ERROR', message: err.message } });
  }
  // Errors raised by the body parser (malformed JSON, oversized body, wrong charset) carry their own 4xx status.
  const http = err as { status?: number; type?: string };
  if (typeof err === 'object' && err && typeof http.status === 'number' && http.status >= 400 && http.status < 500 && typeof http.type === 'string') {
    const tooBig = http.type === 'entity.too.large';
    return res.status(http.status).json({ error: { code: tooBig ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST', message: tooBig ? 'Request body is too large' : 'The request body could not be read' } });
  }
  if (typeof err === 'object' && err && (err as { code?: number }).code === 11000) {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'A record with these details already exists' } });
  }
  if (err instanceof Error && err.name === 'CastError') {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid identifier' } });
  }
  console.error(err);
  res.status(500).json({
    error: { code: 'INTERNAL', message: isProd ? 'Something went wrong' : String((err as Error)?.message ?? err) },
  });
}
