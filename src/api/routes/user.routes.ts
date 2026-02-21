import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireAdmin, requireUserRead, requireUserUpdate } from '../middleware/rbac.middleware';
import { ValidationError } from '../../shared/errors/validation.error';
import { ForbiddenError } from '../../shared/errors/forbidden.error';
import { NotFoundError } from '../../shared/errors/not-found.error';
import { Role, AuditAction, AuditOutcome } from '@prisma/client';
import { logger } from '../../shared/logger';
import bcrypt from 'bcryptjs';

const router = Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

// ============================================
// REQUEST VALIDATION SCHEMAS
// ============================================

const inviteUserSchema = z.object({
    email: z.string().email(),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    role: z.enum([Role.ADMIN, Role.MANAGER, Role.REP, Role.READ_ONLY]),
});

const updateUserSchema = z.object({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    role: z.enum([Role.ADMIN, Role.MANAGER, Role.REP, Role.READ_ONLY]).optional(),
});

// ============================================
// VALIDATION HELPER
// ============================================

function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
    const result = schema.safeParse(data);
    if (!result.success) {
        const errors = result.error.issues.map((err: z.ZodIssue) => ({
            field: err.path.join('.'),
            message: err.message,
            code: 'INVALID_' + err.code.toUpperCase(),
        }));
        throw new ValidationError('Validation failed', errors);
    }
    return result.data;
}

// ============================================
// PAGINATION HELPER
// ============================================

interface PaginationParams {
    page: number;
    limit: number;
    skip: number;
}

function getPagination(req: Request): PaginationParams {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;
    return { page, limit, skip };
}

// ============================================
// ROUTES
// ============================================

// GET /users - List org users (paginated)
router.get('/', requireUserRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { page, limit, skip } = getPagination(req);
        const orgId = req.user!.orgId;

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where: { orgId },
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                    isActive: true,
                    emailVerified: true,
                    lastLoginAt: true,
                    createdAt: true,
                },
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
            prisma.user.count({ where: { orgId } }),
        ]);

        res.status(200).json({
            success: true,
            data: {
                users,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                },
            },
        });
    } catch (error) {
        next(error);
    }
});

// POST /users/invite - Invite new user (Admin only)
router.post('/invite', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = validate(inviteUserSchema, req.body);
        const orgId = req.user!.orgId;

        // Check if email already exists in org
        const existingUser = await prisma.user.findUnique({
            where: { orgId_email: { orgId, email: data.email.toLowerCase() } },
        });

        if (existingUser) {
            throw new ValidationError('User with this email already exists', [
                { field: 'email', message: 'Email already registered in this organization', code: 'EMAIL_EXISTS' },
            ]);
        }

        // Check seat availability
        const org = await prisma.organization.findUnique({
            where: { id: orgId },
            select: { seatsTotal: true, seatsUsed: true },
        });

        if (!org || org.seatsUsed >= org.seatsTotal) {
            throw new ForbiddenError('No available seats. Please upgrade your plan.');
        }

        // Generate temporary password (in production, would send invite email)
        const tempPassword = Math.random().toString(36).slice(-12);
        const passwordHash = await bcrypt.hash(tempPassword, 12);

        // Create user
        const user = await prisma.user.create({
            data: {
                orgId,
                email: data.email.toLowerCase(),
                passwordHash,
                firstName: data.firstName,
                lastName: data.lastName,
                role: data.role,
                emailVerified: false,
            },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                isActive: true,
                createdAt: true,
            },
        });

        // Update seat count
        await prisma.organization.update({
            where: { id: orgId },
            data: { seatsUsed: { increment: 1 } },
        });

        // Create audit log
        await prisma.auditLog.create({
            data: {
                orgId,
                userId: req.user!.id,
                action: AuditAction.CREATE,
                objectType: 'USER',
                objectId: user.id,
                outcome: AuditOutcome.SUCCESS,
                ipAddress: req.ip || undefined,
                userAgent: req.headers['user-agent'],
            },
        });

        logger.info(`User invited: ${user.id} in org ${orgId}`);

        res.status(201).json({
            success: true,
            data: { user },
            message: 'User invited successfully',
            // In development, include temp password for testing
            ...(process.env.NODE_ENV === 'development' ? { devTempPassword: tempPassword } : {}),
        });
    } catch (error) {
        next(error);
    }
});

// GET /users/:id - Get user details
router.get('/:id', requireUserRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const orgId = req.user!.orgId;

        const user = await prisma.user.findFirst({
            where: { id, orgId },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                isActive: true,
                emailVerified: true,
                lastLoginAt: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        if (!user) {
            throw new NotFoundError('User not found');
        }

        res.status(200).json({
            success: true,
            data: { user },
        });
    } catch (error) {
        next(error);
    }
});

// PATCH /users/:id - Update user
router.patch('/:id', requireUserUpdate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const orgId = req.user!.orgId;
        const currentUserId = req.user!.id;
        const currentUserRole = req.user!.role;

        const data = validate(updateUserSchema, req.body);

        // Check if user exists
        const existingUser = await prisma.user.findFirst({
            where: { id, orgId },
        });

        if (!existingUser) {
            throw new NotFoundError('User not found');
        }

        // Prevent self-demotion from admin
        if (id === currentUserId && data.role && data.role !== Role.ADMIN && currentUserRole === Role.ADMIN) {
            throw new ForbiddenError('Cannot change your own admin role');
        }

        // Non-admins can only update themselves
        if (currentUserRole !== Role.ADMIN && id !== currentUserId) {
            throw new ForbiddenError('You can only update your own profile');
        }

        // Admins can update role, others cannot
        if (data.role && currentUserRole !== Role.ADMIN) {
            throw new ForbiddenError('Only admins can change user roles');
        }

        const user = await prisma.user.update({
            where: { id },
            data: {
                firstName: data.firstName,
                lastName: data.lastName,
                role: data.role,
            },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                isActive: true,
                updatedAt: true,
            },
        });

        // Create audit log
        await prisma.auditLog.create({
            data: {
                orgId,
                userId: currentUserId,
                action: AuditAction.UPDATE,
                objectType: 'USER',
                objectId: user.id,
                changes: { before: existingUser, after: user },
                outcome: AuditOutcome.SUCCESS,
                ipAddress: req.ip || undefined,
                userAgent: req.headers['user-agent'],
            },
        });

        res.status(200).json({
            success: true,
            data: { user },
        });
    } catch (error) {
        next(error);
    }
});

// DELETE /users/:id - Deactivate user (Admin only)
router.delete('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const orgId = req.user!.orgId;
        const currentUserId = req.user!.id;

        // Prevent self-deactivation
        if (id === currentUserId) {
            throw new ForbiddenError('Cannot deactivate your own account');
        }

        // Check if user exists
        const existingUser = await prisma.user.findFirst({
            where: { id, orgId },
        });

        if (!existingUser) {
            throw new NotFoundError('User not found');
        }

        // Deactivate user (soft delete)
        await prisma.user.update({
            where: { id },
            data: { isActive: false },
        });

        // Update seat count
        await prisma.organization.update({
            where: { id: orgId },
            data: { seatsUsed: { decrement: 1 } },
        });

        // Invalidate all sessions
        await prisma.session.deleteMany({
            where: { userId: id },
        });

        // Create audit log
        await prisma.auditLog.create({
            data: {
                orgId,
                userId: currentUserId,
                action: AuditAction.DELETE,
                objectType: 'USER',
                objectId: id,
                outcome: AuditOutcome.SUCCESS,
                ipAddress: req.ip || undefined,
                userAgent: req.headers['user-agent'],
            },
        });

        logger.info(`User deactivated: ${id} in org ${orgId}`);

        res.status(200).json({
            success: true,
            message: 'User deactivated successfully',
        });
    } catch (error) {
        next(error);
    }
});

// POST /users/:id/resend-invite - Resend invitation
router.post('/:id/resend-invite', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const orgId = req.user!.orgId;

        const user = await prisma.user.findFirst({
            where: { id, orgId },
        });

        if (!user) {
            throw new NotFoundError('User not found');
        }

        if (user.emailVerified) {
            res.status(400).json({
                success: false,
                error: { code: 'EMAIL_ALREADY_VERIFIED', message: 'Email is already verified' },
            });
            return;
        }

        // Generate new temp password
        const tempPassword = Math.random().toString(36).slice(-12);
        const passwordHash = await bcrypt.hash(tempPassword, 12);

        await prisma.user.update({
            where: { id },
            data: { passwordHash },
        });

        // In production, send new invite email
        logger.info(`Invite resent for user: ${id}`);

        res.status(200).json({
            success: true,
            message: 'Invitation resent successfully',
            // In development, include temp password for testing
            ...(process.env.NODE_ENV === 'development' ? { devTempPassword: tempPassword } : {}),
        });
    } catch (error) {
        next(error);
    }
});

export default router;
