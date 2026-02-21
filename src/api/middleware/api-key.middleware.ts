import { Request, Response, NextFunction } from 'express';
import { apiKeyService } from '../../services/api-key.service';
import { UnauthorizedError } from '../../shared/errors/unauthorized.error';
import { ForbiddenError } from '../../shared/errors/forbidden.error';
import { getRedisClient } from '../../config/redis';
import { prisma } from '../../config/database';
import { logger } from '../../shared/logger';
import { AuditAction, AuditOutcome } from '@prisma/client';

// ============================================
// EXTEND EXPRESS REQUEST TYPE
// ============================================

declare global {
    namespace Express {
        interface Request {
            apiKey?: {
                id: string;
                orgId: string;
                scopes: string[];
            };
        }
    }
}

// ============================================
// CONSTANTS
// ============================================

const API_KEY_HEADER = 'x-api-key';
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 1000; // 1000 requests per minute per org

// ============================================
// RATE LIMITING
// ============================================

/**
 * Check if the organization has exceeded their rate limit
 * Uses Redis for distributed rate limiting
 */
async function checkRateLimit(orgId: string): Promise<boolean> {
    try {
        const redis = await getRedisClient();
        const key = `rate_limit:api_key:${orgId}`;

        const currentCount = await redis.incr(key);

        // Set expiry on first request
        if (currentCount === 1) {
            await redis.expire(key, RATE_LIMIT_WINDOW_MS / 1000);
        }

        return currentCount <= RATE_LIMIT_MAX_REQUESTS;
    } catch (error) {
        logger.error('Rate limit check failed:', error);
        // Fail open - allow request if Redis is unavailable
        return true;
    }
}

// ============================================
// AUDIT LOGGING
// ============================================

/**
 * Log API key request to audit log
 */
async function logApiKeyRequest(
    orgId: string,
    apiKeyId: string,
    req: Request,
    outcome: AuditOutcome,
    errorMessage?: string
): Promise<void> {
    try {
        await prisma.auditLog.create({
            data: {
                orgId,
                userId: null, // API key requests don't have a user
                action: AuditAction.READ, // Default to read, can be adjusted
                objectType: 'API_KEY',
                objectId: apiKeyId,
                requestOrigin: req.headers['origin'] as string || undefined,
                ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
                userAgent: req.headers['user-agent'] || undefined,
                outcome,
                errorMessage,
            },
        });
    } catch (error) {
        logger.error('Failed to log API key audit:', error);
    }
}

// ============================================
// API KEY MIDDLEWARE
// ============================================

/**
 * Middleware to validate API key from header
 * Extracts the key, validates it, applies rate limiting, and attaches to request
 */
export async function apiKeyMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction
): Promise<void> {
    try {
        // Check for API key header
        const apiKeyHeader = req.headers[API_KEY_HEADER];

        if (!apiKeyHeader) {
            // No API key provided, continue without API key authentication
            // This allows routes to support both JWT and API key auth
            return next();
        }

        const apiKeySecret = Array.isArray(apiKeyHeader)
            ? apiKeyHeader[0]
            : apiKeyHeader;

        // Validate the API key
        const validatedKey = await apiKeyService.validateApiKey(apiKeySecret);

        if (!validatedKey) {
            await logApiKeyRequest(
                'unknown',
                'unknown',
                req,
                AuditOutcome.FAILURE,
                'Invalid API key'
            );
            throw new UnauthorizedError('Invalid or expired API key');
        }

        // Apply rate limiting per organization
        const rateLimitOk = await checkRateLimit(validatedKey.orgId);

        if (!rateLimitOk) {
            logger.warn(`Rate limit exceeded for org: ${validatedKey.orgId}`);
            await logApiKeyRequest(
                validatedKey.orgId,
                validatedKey.id,
                req,
                AuditOutcome.FAILURE,
                'Rate limit exceeded'
            );
            throw new ForbiddenError('Rate limit exceeded. Maximum 1000 requests per minute.');
        }

        // Attach API key info to request
        req.apiKey = {
            id: validatedKey.id,
            orgId: validatedKey.orgId,
            scopes: validatedKey.scopes,
        };

        // Log successful authentication
        await logApiKeyRequest(
            validatedKey.orgId,
            validatedKey.id,
            req,
            AuditOutcome.SUCCESS
        );

        next();
    } catch (error) {
        if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
            next(error);
        } else {
            logger.error('API key middleware error:', error);
            next(new UnauthorizedError('API key authentication failed'));
        }
    }
}

// ============================================
// SCOPE VALIDATION MIDDLEWARE
// ============================================

/**
 * Middleware factory to check if API key has required scope
 * @param requiredScope - The scope required to access the route
 */
export function requireApiKeyScope(requiredScope: string) {
    return async (
        req: Request,
        _res: Response,
        next: NextFunction
    ): Promise<void> => {
        try {
            // If no API key, skip this check (fallback to JWT auth)
            if (!req.apiKey) {
                return next();
            }

            // Check if the API key has the required scope
            const hasPermission = apiKeyService.hasPermission(req.apiKey, requiredScope);

            if (!hasPermission) {
                logger.warn(
                    `API key ${req.apiKey.id} lacks required scope: ${requiredScope} for ${req.method} ${req.path}`
                );
                throw new ForbiddenError(
                    `Insufficient permissions. Required scope: ${requiredScope}`
                );
            }

            next();
        } catch (error) {
            if (error instanceof ForbiddenError) {
                next(error);
            } else {
                logger.error('API key scope check error:', error);
                next(new ForbiddenError('Permission check failed'));
            }
        }
    };
}

// ============================================
// OPTIONAL API KEY MIDDLEWARE
// ============================================

/**
 * Optional API key middleware - doesn't fail if no key provided
 * Useful for endpoints that can work with or without API key
 */
export async function optionalApiKeyMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        await apiKeyMiddleware(req, res, next);
    } catch (error) {
        // Don't fail - just continue without API key authentication
        next();
    }
}

// ============================================
// COMBINED MIDDLEWARE FOR API KEY PROTECTED ROUTES
// ============================================

/**
 * Creates a middleware that requires API key authentication with specific scope
 * @param requiredScope - The scope required to access the route
 */
export function requireApiKey(requiredScope?: string) {
    const middlewares = [apiKeyMiddleware];

    if (requiredScope) {
        middlewares.push(requireApiKeyScope(requiredScope));
    }

    return middlewares;
}
