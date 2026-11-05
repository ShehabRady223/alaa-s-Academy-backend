export class AppError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}
export const badRequest = (m: string) => new AppError(400, m, 'BAD_REQUEST');
export const unauthorized = (m = 'Authentication required') => new AppError(401, m, 'UNAUTHORIZED');
export const forbidden = (m = 'You do not have access to this resource') => new AppError(403, m, 'FORBIDDEN');
export const notFound = (m = 'Resource not found') => new AppError(404, m, 'NOT_FOUND');
export const conflict = (m: string) => new AppError(409, m, 'CONFLICT');
