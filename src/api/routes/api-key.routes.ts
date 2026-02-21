import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { apiKeyService, VALID_SCOPES } from '../../services/api-key.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { ValidationError } from '../../shared/errors/validation.error';
import { Permission } from '../../core/rbac/types';
import { logger } from '../../shared/logger';

const router = Router();

// ============================================
// REQUEST VALIDATION SCHEMAS
// ============================================

const createApiKeySchema = z.object({
    label: z.string().min(1).max(100),
    scopes: z.array(z.string()).min(1),
    expiresAt: z.string().datetime().optional().or(z.undefined()),
});

// ============================================
// VALIDATION HELPER
// ============================================

function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
    const result = schema.safeParse(data);
    if (!result.success) {
        const errors = result.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
            code: 'INVALID_' + err.code.toUpperCase(),
        }));
        throw new ValidationError('Validation failed', errors);
    }
    return result.data;
}

// ============================================
// ROUTES
// ============================================

// All routes require authentication
router.use(authMiddleware);

// All API key routes require admin permission
router.use(requirePermission(Permission.API_KEY_CREATE));

// POST /api/v1/api-keys - Create a new API key
router.post(
    '/',
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const data = validate(createApiKeySchema, req.body);

            // Validate scopes
            const invalidScopes = data.scopes.filter(
                scope => !VALID_SCOPES.includes(scope as any)
            );
            if (invalidScopes.length > 0) {
                throw new ValidationError('Invalid scopes', [
                    {
                        field: 'scopes',
                        message: `Invalid scopes: ${invalidScopes.join(', ')}. Valid scopes are: ${VALID_SCOPES.join(', ')}`,
                        code: 'INVALID_SCOPE',
                    },
                ]);
            }

            // Parse expiresAt if provided
            const expiresAt = data.expiresAt ? new Date(data.expiresAt) : undefined;

            const createdKey = await apiKeyService.createApiKey(
                req.user!.orgId,
                {
                    label: data.label,
                    scopes: data.scopes,
                    expiresAt,
                }
            );

            res.status(201).json({
                success: true,
                data: {
                    // Return the full key with secret (only shown once!)
                    id: createdKey.id,
                    label: createdKey.label,
                    keyPrefix: createdKey.keyPrefix,
                    scopes: createdKey.scopes,
                    lastUsedAt: createdKey.lastUsedAt,
                    expiresAt: createdKey.expiresAt,
                    isActive: createdKey.isActive,
                    createdAt: createdKey.createdAt,
                    secret: createdKey.secret,
                    // Warning message
                    warning: 'This is the only time the secret will be shown. Store it securely!',
                },
            });

            logger.info(`API key created: ${createdKey.id} by user: ${req.user!.id}`);
        } catch (error) {
            next(error);
        }
    }
);

// GET /api/v1/api-keys - List all API keys for organization
router.get(
    '/',
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const apiKeys = await apiKeyService.listApiKeys(req.user!.orgId);

            res.status(200).json({
                success: true,
                data: apiKeys,
            });
        } catch (error) {
            next(error);
        }
    }
);

// GET /api/v1/api-keys/:id - Get a specific API key
router.get(
    '/:id',
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params;

            const apiKey = await apiKeyService.getApiKey(req.user!.orgId, id);

            res.status(200).json({
                success: true,
                data: apiKey,
            });
        } catch (error) {
            next(error);
        }
    }
);

// DELETE /api/v1/api-keys/:id - Revoke an API key
router.delete(
    '/:id',
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params;

            await apiKeyService.revokeApiKey(req.user!.orgId, id);

            res.status(200).json({
                success: true,
                data: {
                    message: 'API key revoked successfully',
                },
            });

            logger.info(`API key revoked: ${id} by user: ${req.user!.id}`);
        } catch (error) {
            next(error);
        }
    }
);

export default router;
