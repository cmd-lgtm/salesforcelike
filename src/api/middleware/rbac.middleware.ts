import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../../shared/errors/forbidden.error';
import { Permission, ROLE_PERMISSIONS, isOwner } from '../../core/rbac/types';
import { Role } from '@prisma/client';
import { logger } from '../../shared/logger';

// ============================================
// RBAC MIDDLEWARE FACTORY
// ============================================

/**
 * Creates a middleware that checks if the user has the required permission(s)
 * @param requiredPermissions - Single permission or array of permissions
 * @param options - Options for ownership checks
 */
export function requirePermission(
    requiredPermissions: Permission | Permission[],
    options: {
        /** If true, user needs ALL permissions. If false, user needs ANY permission */
        requireAll?: boolean;
        /** Resource owner field name in the request params or body */
        ownerField?: string;
        /** Callback to fetch the resource for ownership check */
        fetchResource?: (req: Request) => Promise<{ ownerId: string } | null>;
    } = {}
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
    const {
        requireAll = false,
        ownerField: _ownerField = 'ownerId',
        fetchResource,
    } = options;

    const permissions = Array.isArray(requiredPermissions)
        ? requiredPermissions
        : [requiredPermissions];

    return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.user) {
                next(new ForbiddenError('Authentication required'));
                return;
            }

            const { role, id: userId } = req.user;

            // Get user's permissions based on role
            const userPermissions = ROLE_PERMISSIONS[role] || [];

            // Check permission
            let hasPermission = false;

            if (requireAll) {
                // User must have ALL required permissions
                hasPermission = permissions.every(perm => userPermissions.includes(perm));
            } else {
                // User must have AT LEAST ONE of the required permissions
                hasPermission = permissions.some(perm => userPermissions.includes(perm));
            }

            if (!hasPermission) {
                logger.warn(`Permission denied: User ${userId} (role: ${role}) lacks required permissions: ${permissions.join(', ')}`);
                next(new ForbiddenError('Insufficient permissions'));
                return;
            }

            // Check ownership if required
            if (fetchResource && role !== Role.ADMIN) {
                // Only non-admins need ownership check
                const resource = await fetchResource(req);

                if (resource && !isOwner(resource, userId)) {
                    // Manager can access resources in their org
                    // Rep can only access their own resources
                    logger.warn(`Ownership denied: User ${userId} tried to access resource owned by ${resource.ownerId}`);
                    next(new ForbiddenError('You can only access your own resources'));
                    return;
                }
            }

            next();
        } catch (error) {
            logger.error('RBAC middleware error:', error);
            next(new ForbiddenError('Permission check failed'));
        }
    };
}

/**
 * Creates a middleware that checks if the user has the required role
 */
export function requireRole(...allowedRoles: Role[]): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, _res: Response, next: NextFunction): void => {
        if (!req.user) {
            next(new ForbiddenError('Authentication required'));
            return;
        }

        const { role, id: userId } = req.user;

        if (!allowedRoles.includes(role)) {
            logger.warn(`Role denied: User ${userId} (role: ${role}) tried to access resource for roles: ${allowedRoles.join(', ')}`);
            next(new ForbiddenError('Insufficient role'));
            return;
        }

        next();
    };
}

// ============================================
// ORGANIZATION SCOPE MIDDLEWARE
// ============================================

/**
 * Middleware to ensure users can only access resources within their organization
 */
export function requireOrgScope(paramName: string = 'orgId'): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, _res: Response, next: NextFunction): void => {
        if (!req.user) {
            next(new ForbiddenError('Authentication required'));
            return;
        }

        const userOrgId = req.user.orgId;
        const paramOrgId = req.params[paramName] || req.body[paramName];

        // If there's an orgId in the request, verify it matches user's org
        if (paramOrgId && paramOrgId !== userOrgId) {
            logger.warn(`Org scope violation: User from org ${userOrgId} tried to access org ${paramOrgId}`);
            next(new ForbiddenError('Access denied: Invalid organization'));
            return;
        }

        // Attach the correct orgId to the request for downstream use
        req.params.orgId = userOrgId;
        if (req.body) {
            req.body.orgId = userOrgId;
        }

        next();
    };
}

// ============================================
// PREDEFINED MIDDLEWARE COMBINATIONS
// ============================================

// Admin only
export const requireAdmin = requireRole(Role.ADMIN);

// Manager and above
export const requireManager = requireRole(Role.ADMIN, Role.MANAGER);

// Read-only access
export const requireReadOnly = requireRole(Role.ADMIN, Role.MANAGER, Role.REP, Role.READ_ONLY);

// User management permissions
export const requireUserRead = requirePermission(Permission.USER_READ);
export const requireUserCreate = requirePermission(Permission.USER_CREATE);
export const requireUserUpdate = requirePermission(Permission.USER_UPDATE);
export const requireUserDelete = requirePermission(Permission.USER_DELETE);

// Lead permissions
export const requireLeadRead = requirePermission(Permission.LEAD_READ);
export const requireLeadCreate = requirePermission(Permission.LEAD_CREATE);
export const requireLeadUpdate = requirePermission(Permission.LEAD_UPDATE);
export const requireLeadDelete = requirePermission(Permission.LEAD_DELETE);
export const requireLeadConvert = requirePermission(Permission.LEAD_CONVERT);

// Account permissions
export const requireAccountRead = requirePermission(Permission.ACCOUNT_READ);
export const requireAccountCreate = requirePermission(Permission.ACCOUNT_CREATE);
export const requireAccountUpdate = requirePermission(Permission.ACCOUNT_UPDATE);
export const requireAccountDelete = requirePermission(Permission.ACCOUNT_DELETE);

// Contact permissions
export const requireContactRead = requirePermission(Permission.CONTACT_READ);
export const requireContactCreate = requirePermission(Permission.CONTACT_CREATE);
export const requireContactUpdate = requirePermission(Permission.CONTACT_UPDATE);
export const requireContactDelete = requirePermission(Permission.CONTACT_DELETE);

// Opportunity permissions
export const requireOpportunityRead = requirePermission(Permission.OPPORTUNITY_READ);
export const requireOpportunityCreate = requirePermission(Permission.OPPORTUNITY_CREATE);
export const requireOpportunityUpdate = requirePermission(Permission.OPPORTUNITY_UPDATE);
export const requireOpportunityDelete = requirePermission(Permission.OPPORTUNITY_DELETE);
export const requireOpportunityChangeStage = requirePermission(Permission.OPPORTUNITY_CHANGE_STAGE);

// Task permissions
export const requireTaskRead = requirePermission(Permission.TASK_READ);
export const requireTaskCreate = requirePermission(Permission.TASK_CREATE);
export const requireTaskUpdate = requirePermission(Permission.TASK_UPDATE);
export const requireTaskDelete = requirePermission(Permission.TASK_DELETE);
export const requireTaskComplete = requirePermission(Permission.TASK_COMPLETE);

// Activity permissions
export const requireActivityRead = requirePermission(Permission.ACTIVITY_READ);
export const requireActivityCreate = requirePermission(Permission.ACTIVITY_CREATE);
export const requireActivityUpdate = requirePermission(Permission.ACTIVITY_UPDATE);
export const requireActivityDelete = requirePermission(Permission.ACTIVITY_DELETE);

// Analytics permissions
export const requireAnalyticsRead = requirePermission(Permission.ANALYTICS_READ);
export const requireForecastRead = requirePermission(Permission.FORECAST_READ);

export default {
    requirePermission,
    requireRole,
    requireOrgScope,
    requireAdmin,
    requireManager,
    requireReadOnly,
};
