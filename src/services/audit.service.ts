import { prisma } from '../config/database';
import { logger } from '../shared/logger';
import { AuditAction, AuditOutcome, AuditLog } from '@prisma/client';

// Type alias for common actions
export type { AuditLog, AuditAction, AuditOutcome };

// ============================================
// TYPES
// ============================================

export interface AuditLogEntry {
    id: string;
    orgId: string;
    userId: string | null;
    action: AuditAction;
    objectType: string;
    objectId: string | null;
    changes: Record<string, { old: unknown; new: unknown }> | null;
    requestOrigin: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    outcome: AuditOutcome;
    errorMessage: string | null;
    timestamp: Date;
    // Relations
    user?: {
        id: string;
        email: string;
        firstName: string;
        lastName: string;
    } | null;
}

export interface CreateAuditLogParams {
    orgId: string;
    userId?: string | null;
    action: AuditAction;
    objectType: string;
    objectId?: string | null;
    changes?: Record<string, { old: unknown; new: unknown }> | null;
    requestOrigin?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    outcome?: AuditOutcome;
    errorMessage?: string | null;
}

export interface AuditLogQueryParams {
    orgId: string;
    userId?: string;
    action?: AuditAction;
    objectType?: string;
    objectId?: string;
    startDate?: Date;
    endDate?: Date;
    outcome?: AuditOutcome;
    page?: number;
    limit?: number;
}

export interface PaginatedAuditLogs {
    data: AuditLogEntry[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

// ============================================
// CONSTANTS
// ============================================

const AUDIT_RETENTION_DAYS = 90;

// ============================================
// AUDIT SERVICE
// ============================================

export const auditService = {
    // ----------------------------------------
    // CREATE AUDIT LOG ENTRY
    // ----------------------------------------
    async createLog(params: CreateAuditLogParams): Promise<AuditLog> {
        try {
            const auditLog = await prisma.auditLog.create({
                data: {
                    orgId: params.orgId,
                    userId: params.userId ?? null,
                    action: params.action,
                    objectType: params.objectType,
                    objectId: params.objectId ?? null,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    changes: params.changes as any,
                    requestOrigin: params.requestOrigin ?? null,
                    ipAddress: params.ipAddress ?? null,
                    userAgent: params.userAgent ?? null,
                    outcome: params.outcome ?? AuditOutcome.SUCCESS,
                    errorMessage: params.errorMessage ?? null,
                },
            });

            logger.debug(`Audit log created: ${auditLog.id} - ${params.action} on ${params.objectType}`);
            return auditLog;
        } catch (error) {
            logger.error('Failed to create audit log:', error);
            throw error;
        }
    },

    // ----------------------------------------
    // QUERY AUDIT LOGS (with filters)
    // ----------------------------------------
    async queryLogs(params: AuditLogQueryParams): Promise<PaginatedAuditLogs> {
        const { orgId, userId, action, objectType, objectId, startDate, endDate, outcome, page = 1, limit = 50 } = params;

        // Build where clause
        const where: Record<string, unknown> = {
            orgId,
        };

        if (userId) {
            where.userId = userId;
        }

        if (action) {
            where.action = action;
        }

        if (objectType) {
            where.objectType = objectType;
        }

        if (objectId) {
            where.objectId = objectId;
        }

        if (outcome) {
            where.outcome = outcome;
        }

        // Date range filter
        if (startDate || endDate) {
            where.timestamp = {};
            if (startDate) {
                (where.timestamp as Record<string, Date>).gte = startDate;
            }
            if (endDate) {
                (where.timestamp as Record<string, Date>).lte = endDate;
            }
        }

        // Calculate pagination
        const skip = (page - 1) * limit;
        const total = await prisma.auditLog.count({ where });

        // Fetch logs with user relation
        const logs = await prisma.auditLog.findMany({
            where,
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                    },
                },
            },
            orderBy: {
                timestamp: 'desc',
            },
            skip,
            take: limit,
        });

        return {
            data: logs as AuditLogEntry[],
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    },

    // ----------------------------------------
    // GET SINGLE AUDIT LOG BY ID
    // ----------------------------------------
    async getLogById(orgId: string, logId: string): Promise<AuditLogEntry | null> {
        const log = await prisma.auditLog.findFirst({
            where: {
                id: logId,
                orgId,
            },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                    },
                },
            },
        });

        return log as AuditLogEntry | null;
    },

    // ----------------------------------------
    // EXPORT AUDIT LOGS TO CSV
    // ----------------------------------------
    async exportLogs(params: AuditLogQueryParams): Promise<string> {
        const { orgId, userId, action, objectType, objectId, startDate, endDate, outcome } = params;

        // Build where clause (same as queryLogs but without pagination)
        const where: Record<string, unknown> = {
            orgId,
        };

        if (userId) {
            where.userId = userId;
        }

        if (action) {
            where.action = action;
        }

        if (objectType) {
            where.objectType = objectType;
        }

        if (objectId) {
            where.objectId = objectId;
        }

        if (outcome) {
            where.outcome = outcome;
        }

        if (startDate || endDate) {
            where.timestamp = {};
            if (startDate) {
                (where.timestamp as Record<string, Date>).gte = startDate;
            }
            if (endDate) {
                (where.timestamp as Record<string, Date>).lte = endDate;
            }
        }

        // Fetch all matching logs (limit to 100k for performance)
        const logs = await prisma.auditLog.findMany({
            where,
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                    },
                },
            },
            orderBy: {
                timestamp: 'desc',
            },
            take: 100000,
        });

        // Generate CSV
        const headers = [
            'ID',
            'Timestamp',
            'User Email',
            'User Name',
            'Action',
            'Object Type',
            'Object ID',
            'Changes',
            'Request Origin',
            'IP Address',
            'User Agent',
            'Outcome',
            'Error Message',
        ];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows: string[][] = logs.map((log: any) => [
            log.id,
            log.timestamp.toISOString(),
            log.user?.email ?? '',
            log.user ? `${log.user.firstName} ${log.user.lastName}` : '',
            log.action,
            log.objectType,
            log.objectId ?? '',
            log.changes ? JSON.stringify(log.changes) : '',
            log.requestOrigin ?? '',
            log.ipAddress ?? '',
            log.userAgent ?? '',
            log.outcome,
            log.errorMessage ?? '',
        ]);

        // Escape CSV values
        const escapeCSV = (value: string): string => {
            if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
        };

        const csvContent: string = [
            headers.join(','),
            ...rows.map((row: string[]) => row.map(escapeCSV).join(',')),
        ].join('\n');

        logger.info(`Exported ${logs.length} audit logs for org: ${orgId}`);
        return csvContent;
    },

    // ----------------------------------------
    // CLEANUP OLD AUDIT LOGS (90-day retention)
    // ----------------------------------------
    async cleanupOldLogs(): Promise<number> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - AUDIT_RETENTION_DAYS);

        try {
            const result = await prisma.auditLog.deleteMany({
                where: {
                    timestamp: {
                        lt: cutoffDate,
                    },
                },
            });

            logger.info(`Cleaned up ${result.count} audit logs older than ${AUDIT_RETENTION_DAYS} days`);
            return result.count;
        } catch (error) {
            logger.error('Failed to cleanup old audit logs:', error);
            throw error;
        }
    },

    // ----------------------------------------
    // GET AUDIT STATISTICS
    // ----------------------------------------
    async getStats(orgId: string, startDate?: Date, endDate?: Date): Promise<{
        totalLogs: number;
        byAction: Record<string, number>;
        byObjectType: Record<string, number>;
        byOutcome: Record<string, number>;
        byUser: { userId: string; count: number }[];
    }> {
        // Build date filter
        const dateFilter: Record<string, Date> = {};
        if (startDate) {
            dateFilter.gte = startDate;
        }
        if (endDate) {
            dateFilter.lte = endDate;
        }

        const where = {
            orgId,
            ...(Object.keys(dateFilter).length > 0 ? { timestamp: dateFilter } : {}),
        };

        // Total count
        const totalLogs = await prisma.auditLog.count({ where });

        // By action
        const byActionRaw = await prisma.auditLog.groupBy({
            by: ['action'],
            where,
            _count: true,
        });
        const byAction: Record<string, number> = byActionRaw.reduce<Record<string, number>>((acc: Record<string, number>, item: { action: string; _count: number }) => {
            acc[item.action] = item._count;
            return acc;
        }, {});

        // By object type
        const byObjectTypeRaw = await prisma.auditLog.groupBy({
            by: ['objectType'],
            where,
            _count: true,
        });
        const byObjectType: Record<string, number> = byObjectTypeRaw.reduce<Record<string, number>>((acc: Record<string, number>, item: { objectType: string; _count: number }) => {
            acc[item.objectType] = item._count;
            return acc;
        }, {});

        // By outcome
        const byOutcomeRaw = await prisma.auditLog.groupBy({
            by: ['outcome'],
            where,
            _count: true,
        });
        const byOutcome: Record<string, number> = byOutcomeRaw.reduce<Record<string, number>>((acc: Record<string, number>, item: { outcome: string; _count: number }) => {
            acc[item.outcome] = item._count;
            return acc;
        }, {});

        // By user (top 10)
        const byUserRaw = await prisma.auditLog.groupBy({
            by: ['userId'],
            where: {
                ...where,
                userId: { not: null },
            },
            _count: true,
            orderBy: {
                _count: {
                    userId: 'desc',
                },
            },
            take: 10,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const byUser = byUserRaw
            .filter((item: any) => item.userId !== null)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((item: any) => ({
                userId: item.userId,
                count: item._count,
            }));

        return {
            totalLogs,
            byAction,
            byObjectType,
            byOutcome,
            byUser,
        };
    },

    // ----------------------------------------
    // LOG AUTH EVENTS
    // ----------------------------------------
    async logAuthEvent(
        orgId: string,
        userId: string | null,
        action: typeof AuditAction.LOGIN | typeof AuditAction.LOGOUT,
        outcome: AuditOutcome,
        ipAddress?: string,
        userAgent?: string,
        errorMessage?: string
    ): Promise<AuditLog> {
        return this.createLog({
            orgId,
            userId,
            action,
            objectType: 'USER',
            outcome,
            ipAddress,
            userAgent,
            errorMessage,
        });
    },

    // ----------------------------------------
    // LOG INVITE EVENTS
    // ----------------------------------------
    async logInviteEvent(
        orgId: string,
        userId: string,
        invitedEmail: string,
        outcome: AuditOutcome,
        ipAddress?: string,
        userAgent?: string,
        errorMessage?: string
    ): Promise<AuditLog> {
        return this.createLog({
            orgId,
            userId,
            action: AuditAction.CREATE,
            objectType: 'USER_INVITE',
            objectId: invitedEmail,
            outcome,
            ipAddress,
            userAgent,
            errorMessage,
        });
    },

    // ----------------------------------------
    // LOG ROLE CHANGE EVENTS
    // ----------------------------------------
    async logRoleChangeEvent(
        orgId: string,
        userId: string,
        targetUserId: string,
        oldRole: string,
        newRole: string,
        ipAddress?: string,
        userAgent?: string
    ): Promise<AuditLog> {
        return this.createLog({
            orgId,
            userId,
            action: AuditAction.UPDATE,
            objectType: 'USER_ROLE',
            objectId: targetUserId,
            changes: {
                role: { old: oldRole, new: newRole },
            },
            outcome: AuditOutcome.SUCCESS,
            ipAddress,
            userAgent,
        });
    },

    // ----------------------------------------
    // LOG API KEY EVENTS
    // ----------------------------------------
    async logApiKeyEvent(
        orgId: string,
        userId: string,
        action: typeof AuditAction.CREATE | typeof AuditAction.DELETE,
        apiKeyId: string,
        apiKeyLabel: string,
        outcome: AuditOutcome,
        ipAddress?: string,
        userAgent?: string,
        errorMessage?: string
    ): Promise<AuditLog> {
        return this.createLog({
            orgId,
            userId,
            action,
            objectType: 'API_KEY',
            objectId: apiKeyId,
            changes: action === AuditAction.CREATE ? { label: { old: null, new: apiKeyLabel } } : undefined,
            outcome,
            ipAddress,
            userAgent,
            errorMessage,
        });
    },

    // ----------------------------------------
    // LOG CRUD EVENTS (generic helper)
    // ----------------------------------------
    async logCrudEvent(
        orgId: string,
        userId: string | null,
        action: typeof AuditAction.CREATE | typeof AuditAction.UPDATE | typeof AuditAction.DELETE,
        objectType: string,
        objectId: string,
        oldValues?: Record<string, unknown>,
        newValues?: Record<string, unknown>,
        ipAddress?: string,
        userAgent?: string,
        requestOrigin?: string,
        outcome: AuditOutcome = AuditOutcome.SUCCESS,
        errorMessage?: string
    ): Promise<AuditLog> {
        let changes: Record<string, { old: unknown; new: unknown }> | null = null;

        if (oldValues && newValues) {
            changes = {};
            const allKeys = new Set([...Object.keys(oldValues), ...Object.keys(newValues)]);
            for (const key of allKeys) {
                const oldVal = oldValues[key];
                const newVal = newValues[key];
                if (oldVal !== newVal) {
                    changes[key] = { old: oldVal, new: newVal };
                }
            }
            // If no actual changes, set to null
            if (Object.keys(changes).length === 0) {
                changes = null;
            }
        }

        return this.createLog({
            orgId,
            userId,
            action,
            objectType,
            objectId,
            changes,
            ipAddress,
            userAgent,
            requestOrigin,
            outcome,
            errorMessage,
        });
    },
};
