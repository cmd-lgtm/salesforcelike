import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { Role, PlanType } from '@prisma/client';
import * as billingService from '../../services/billing.service';
import { ValidationError } from '../../shared/errors/validation.error';
import { ForbiddenError } from '../../shared/errors/forbidden.error';

const router = Router();

// ============================================
// REQUEST VALIDATION SCHEMAS
// ============================================

const updatePlanSchema = z.object({
    plan: z.enum([PlanType.FREE, PlanType.PRO, PlanType.ENTERPRISE]),
});

const assignSeatSchema = z.object({
    userId: z.string().min(1),
});

const reclaimSeatSchema = z.object({
    userId: z.string().min(1),
});

const upgradeSchema = z.object({
    plan: z.enum([PlanType.PRO, PlanType.ENTERPRISE]),
});

const startTrialSchema = z.object({
    trialDays: z.number().min(1).max(30).optional(),
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
// EXTRACT ORG ID FROM REQUEST
// ============================================

function getOrgId(req: Request): string {
    return req.user?.orgId || '';
}

// ============================================
// ROUTES
// ============================================

// GET /api/v1/billing - Get billing info (plan, seats, trial)
router.get(
    '/',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const orgId = getOrgId(req);
            const billingInfo = await billingService.getBillingInfo(orgId);

            res.status(200).json({
                success: true,
                data: billingInfo,
            });
        } catch (error) {
            next(error);
        }
    }
);

// GET /api/v1/billing/plan - Get current plan details
router.get(
    '/plan',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const orgId = getOrgId(req);
            const planDetails = await billingService.getPlanDetails(orgId);

            res.status(200).json({
                success: true,
                data: planDetails,
            });
        } catch (error) {
            next(error);
        }
    }
);

// PATCH /api/v1/billing/plan - Update plan (stub - records intent)
router.patch(
    '/plan',
    authMiddleware,
    requireRole(Role.ADMIN),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const orgId = getOrgId(req);
            const { plan } = validate(updatePlanSchema, req.body);

            const result = await billingService.updatePlan(orgId, plan, {
                updatedBy: req.user?.email,
                ipAddress: req.ip,
            });

            res.status(200).json({
                success: result.success,
                message: result.message,
                data: result.billingRecord ? {
                    id: result.billingRecord.id,
                    eventType: result.billingRecord.eventType,
                    planType: result.billingRecord.planType,
                    createdAt: result.billingRecord.createdAt,
                } : undefined,
            });
        } catch (error) {
            next(error);
        }
    }
);

// GET /api/v1/billing/seats - Get seat usage
router.get(
    '/seats',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const orgId = getOrgId(req);
            const seatUsage = await billingService.getSeatUsage(orgId);

            res.status(200).json({
                success: true,
                data: seatUsage,
            });
        } catch (error) {
            next(error);
        }
    }
);

// POST /api/v1/billing/seats/assign - Assign a seat to a user
router.post(
    '/seats/assign',
    authMiddleware,
    requireRole(Role.ADMIN, Role.MANAGER),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const orgId = getOrgId(req);
            const { userId } = validate(assignSeatSchema, req.body);

            const result = await billingService.assignSeat(orgId, userId);

            res.status(200).json({
                success: true,
                data: result,
                message: 'Seat assigned successfully',
            });
        } catch (error) {
            next(error);
        }
    }
);

// POST /api/v1/billing/seats/reclaim - Reclaim a seat from a user
router.post(
    '/seats/reclaim',
    authMiddleware,
    requireRole(Role.ADMIN, Role.MANAGER),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const orgId = getOrgId(req);
            const { userId } = validate(reclaimSeatSchema, req.body);

            const result = await billingService.reclaimSeat(orgId, userId);

            res.status(200).json({
                success: true,
                data: result,
                message: 'Seat reclaimed successfully',
            });
        } catch (error) {
            next(error);
        }
    }
);

// GET /api/v1/billing/invoices - Get invoice history (mock)
router.get(
    '/invoices',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const orgId = getOrgId(req);
            const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

            if (isNaN(limit) || limit < 1 || limit > 100) {
                throw new ValidationError('Invalid limit parameter. Must be between 1 and 100.');
            }

            const invoices = await billingService.getInvoiceHistory(orgId, limit);

            res.status(200).json({
                success: true,
                data: invoices,
            });
        } catch (error) {
            next(error);
        }
    }
);

// POST /api/v1/billing/upgrade - Start upgrade flow (stub)
router.post(
    '/upgrade',
    authMiddleware,
    requireRole(Role.ADMIN),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const orgId = getOrgId(req);
            const { plan } = validate(upgradeSchema, req.body);

            const result = await billingService.startUpgradeFlow(orgId, plan);

            res.status(200).json({
                success: result.success,
                message: result.message,
                data: result.checkoutUrl ? {
                    checkoutUrl: result.checkoutUrl,
                    upgradeIntent: result.upgradeIntent,
                } : undefined,
            });
        } catch (error) {
            next(error);
        }
    }
);

// POST /api/v1/billing/trial - Start a trial
router.post(
    '/trial',
    authMiddleware,
    requireRole(Role.ADMIN),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const orgId = getOrgId(req);
            const { trialDays } = validate(startTrialSchema, req.body);

            const result = await billingService.startTrial(orgId, trialDays || 14);

            res.status(200).json({
                success: result.success,
                message: 'Trial started successfully',
                data: {
                    trialEnd: result.trialEnd,
                },
            });
        } catch (error) {
            next(error);
        }
    }
);

// DELETE /api/v1/billing/trial - Cancel trial
router.delete(
    '/trial',
    authMiddleware,
    requireRole(Role.ADMIN),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const orgId = getOrgId(req);

            const result = await billingService.cancelTrial(orgId);

            res.status(200).json({
                success: result.success,
                message: 'Trial cancelled successfully',
            });
        } catch (error) {
            next(error);
        }
    }
);

// GET /api/v1/billing/features/:feature - Check feature access
router.get(
    '/features/:feature',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const orgId = getOrgId(req);
            const { feature } = req.params;

            const billingInfo = await billingService.getBillingInfo(orgId);
            const hasAccess = billingService.checkFeatureAccess(billingInfo.plan, feature as any);

            if (!hasAccess) {
                const message = billingService.getFeatureGatedMessage(feature);
                throw new ForbiddenError(message);
            }

            res.status(200).json({
                success: true,
                data: {
                    feature,
                    access: true,
                    plan: billingInfo.plan,
                },
            });
        } catch (error) {
            next(error);
        }
    }
);

// POST /api/v1/billing/validate-seats - Validate seat assignment
router.post(
    '/validate-seats',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const orgId = getOrgId(req);

            await billingService.validateSeatAssignment(orgId);

            res.status(200).json({
                success: true,
                message: 'Seat assignment allowed',
            });
        } catch (error) {
            next(error);
        }
    }
);

export default router;
