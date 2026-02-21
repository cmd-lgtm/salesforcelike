import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { auditService } from '../../services/audit.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { ValidationError } from '../../shared/errors/validation.error';
import { AuditAction, AuditOutcome } from '@prisma/client';
import { Permission } from '../../core/rbac/types';
import { logger } from '../../shared/logger';

const router = Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

// ============================================
// PERMISSION MIDDLEWARE
// ============================================

// Require audit:read permission (Admin and Manager only)
const requireAuditRead = requirePermission(Permission.AUDIT_READ);

// Require audit:export permission (Admin and Manager only)
const requireAuditExport = requirePermission(Permission.AUDIT_EXPORT);

// ============================================
// REQUESTAS
// ================================= VALIDATION SCHEM===========

const auditLogQuerySchema = z.object({
    userId: z.string().optional(),
    action: z.nativeEnum(AuditAction).optional(),
    objectType: z.string().optional(),
    objectId: z.string().optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    outcome: z.nativeEnum(AuditOutcome).optional(),
    page: z.string().regex(/^\d+$/).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
});

const auditLogExportQuerySchema = z.object({
    userId: z.string().optional(),
    action: z.nativeEnum(AuditAction).optional(),
    objectType: z.string().optional(),
    objectId: z.string().optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    outcome: z.nativeEnum(AuditOutcome).optional(),
});

// ============================================
// VALIDATION HELPER
// ============================================

function validateQuery<T>(schema: z.ZodSchema<T>, data: unknown): T {
    const result = schema.safeParse(data);
    if (!result.success) {
        const errors = result.error.issues.map((err) => ({
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

// GET /api/v1/audit-logs - List audit logs with filters
router.get('/', requireAuditRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const query = validateQuery(auditLogQuerySchema, req.query);
        const orgId = req.user!.orgId;

        // Parse pagination
        const page = query.page ? parseInt(query.page, 10) : 1;
        const limit = query.limit ? parseInt(query.limit, 10) : 50;

        // Parse date filters
        const startDate = query.startDate ? new Date(query.startDate) : undefined;
        const endDate = query.endDate ? new Date(query.endDate) : undefined;

        const result = await auditService.queryLogs({
            orgId,
            userId: query.userId,
            action: query.action,
            objectType: query.objectType,
            objectId: query.objectId,
            startDate,
            endDate,
            outcome: query.outcome,
            page,
            limit,
        });

        logger.debug(`Fetched audit logs for org: ${orgId}, count: ${result.data.length}`);

        res.json({
            success: true,
            data: result.data,
            pagination: {
                page: result.page,
                limit: result.limit,
                total: result.total,
                totalPages: result.totalPages,
            },
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/v1/audit-logs/export - Export audit logs as CSV
router.get('/export', requireAuditExport, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const query = validateQuery(auditLogExportQuerySchema, req.query);
        const orgId = req.user!.orgId;

        // Parse date filters
        const startDate = query.startDate ? new Date(query.startDate) : undefined;
        const endDate = query.endDate ? new Date(query.endDate) : undefined;

        const csvContent = await auditService.exportLogs({
            orgId,
            userId: query.userId,
            action: query.action,
            objectType: query.objectType,
            objectId: query.objectId,
            startDate,
            endDate,
            outcome: query.outcome,
        });

        // Set response headers for CSV download
        const filename = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        logger.info(`Exported audit logs for org: ${orgId}`);

        res.send(csvContent);
    } catch (error) {
        next(error);
    }
});

// GET /api/v1/audit-logs/stats - Get audit log statistics
router.get('/stats', requireAuditRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const query = z.object({
            startDate: z.string().datetime().optional(),
            endDate: z.string().datetime().optional(),
        }).parse(req.query);

        const orgId = req.user!.orgId;

        // Parse date filters
        const startDate = query.startDate ? new Date(query.startDate) : undefined;
        const endDate = query.endDate ? new Date(query.endDate) : undefined;

        const stats = await auditService.getStats(orgId, startDate, endDate);

        res.json({
            success: true,
            data: stats,
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/v1/audit-logs/:id - Get single audit log by ID
router.get('/:id', requireAuditRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const orgId = req.user!.orgId;

        const log = await auditService.getLogById(orgId, id);

        if (!log) {
            res.json({
                success: false,
                error: {
                    message: 'Audit log not found',
                    code: 'NOT_FOUND',
                },
            });
            return;
        }

        res.json({
            success: true,
            data: log,
        });
    } catch (error) {
        next(error);
    }
});

export default router;
