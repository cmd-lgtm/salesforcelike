import { Request, Response, NextFunction } from 'express';
import { authService } from '../../services/auth.service';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error';
import { TokenPayload } from '../../core/auth/types';
import { Role } from '@prisma/client';
import { logger } from '../../shared/logger';

// ============================================
// EXTEND EXPRESS REQUEST TYPE
// ============================================

declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                email: string;
                orgId: string;
                role: Role;
            };
            tokenPayload?: TokenPayload;
        }
    }
}

// ============================================
// AUTH MIDDLEWARE
// ============================================

export async function authMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction
): Promise<void> {
    try {
        // Extract token from Authorization header
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            throw new UnauthorizedError('No authorization token provided');
        }

        const [bearer, token] = authHeader.split(' ');

        if (bearer !== 'Bearer' || !token) {
            throw new UnauthorizedError('Invalid authorization header format');
        }

        // Verify and decode the access token
        const payload = await authService.verifyAccessToken(token);

        // Attach user info to request
        req.user = {
            id: payload.sub,
            email: payload.email,
            orgId: payload.org_id,
            role: payload.role,
        };

        req.tokenPayload = payload;

        next();
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            next(error);
        } else {
            logger.error('Auth middleware error:', error);
            next(new UnauthorizedError('Authentication failed'));
        }
    }
}

// ============================================
// OPTIONAL AUTH MIDDLEWARE
// ============================================

export async function optionalAuthMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            // No token provided, continue without authentication
            return next();
        }

        const [bearer, token] = authHeader.split(' ');

        if (bearer !== 'Bearer' || !token) {
            // Invalid format, continue without authentication
            return next();
        }

        // Try to verify token
        try {
            const payload = await authService.verifyAccessToken(token);

            req.user = {
                id: payload.sub,
                email: payload.email,
                orgId: payload.org_id,
                role: payload.role,
            };

            req.tokenPayload = payload;
        } catch {
            // Token invalid, but we continue without authentication
            logger.debug('Optional auth: invalid token provided');
        }

        next();
    } catch (error) {
        // Continue without authentication on any error
        next();
    }
}

export default authMiddleware;
