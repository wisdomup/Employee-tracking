export class AppError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function notFound(message: string): AppError {
  return new AppError(message, 404);
}

export function badRequest(message: string): AppError {
  return new AppError(message, 400);
}

export function unauthorized(message: string): AppError {
  return new AppError(message, 401);
}

export function conflict(message: string): AppError {
  return new AppError(message, 409);
}

export function forbidden(message: string): AppError {
  return new AppError(message, 403);
}
