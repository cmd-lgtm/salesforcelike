import { Request, Response, NextFunction } from 'express';
import { logger } from '../../shared/logger';
import { BaseError } from '../../shared/errors/base.error';

interface ErrorResponse {
    success: false;
    error: {
        code: string;
        message: string;
        details?: unknown;
        requestId?: string;
    };
}

export function errorHandler(
    err: Error,
    req: Request,
    res: Response,
    _next: NextFunction
): void {
    const requestId = (req as any).requestId || 'unknown';

    // Log the error
    logger.error(`[${requestId}] Error:`, {
        message: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
    });

    // Handle known errors
    if (err instanceof BaseError) {
        const response: ErrorResponse = {
            success: false,
            error: {
                code: err.code,
                message: err.message,
                requestId,
            },
        };

        if (err.details) {
            response.error.details = err.details;
        }

        res.status(err.statusCode).json(response);
        return;
    }

    // Handle unknown errors
    const response: ErrorResponse = {
        success: false,
        error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: process.env.NODE_ENV === 'production'
                ? 'An unexpected error occurred'
                : err.message,
            requestId,
        },
    };

    res.status(500).json(response);
}

export default errorHandler;
