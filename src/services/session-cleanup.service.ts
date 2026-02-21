import { prisma } from '../config/database';
import { logger } from '../shared/logger';
import { addSessionCleanupJob } from '../shared/queue';

// ============================================
// SESSION CLEANUP SERVICE
// ============================================

export const sessionCleanupService = {
    /**
     * Delete all expired sessions
     * @param olderThanHours - Delete sessions that expired more than this many hours ago
     * @returns Number of deleted sessions
     */
    async cleanup(olderThanHours: number = 24): Promise<number> {
        const cutoffDate = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

        const result = await prisma.session.deleteMany({
            where: {
                expiresAt: {
                    lt: cutoffDate,
                },
            },
        });

        logger.info(`Session cleanup: deleted ${result.count} sessions older than ${olderThanHours} hours`);
        return result.count;
    },

    /**
     * Clean up sessions for a specific user
     * @param userId - The user ID
     * @returns Number of deleted sessions
     */
    async cleanupUserSessions(userId: string): Promise<number> {
        const result = await prisma.session.deleteMany({
            where: {
                userId,
            },
        });

        logger.info(`Session cleanup: deleted ${result.count} sessions for user ${userId}`);
        return result.count;
    },

    /**
     * Delete all sessions for an organization (when org is deactivated)
     * @param orgId - The organization ID
     * @returns Number of deleted sessions
     */
    async cleanupOrgSessions(orgId: string): Promise<number> {
        // Get all user IDs in the org
        const users = await prisma.user.findMany({
            where: { orgId },
            select: { id: true },
        });

        const userIds = users.map(u => u.id);

        const result = await prisma.session.deleteMany({
            where: {
                userId: { in: userIds },
            },
        });

        logger.info(`Session cleanup: deleted ${result.count} sessions for org ${orgId}`);
        return result.count;
    },

    /**
     * Get session statistics for an organization
     */
    async getStats(orgId: string): Promise<{
        totalSessions: number;
        activeSessions: number;
        expiredSessions: number;
    }> {
        const users = await prisma.user.findMany({
            where: { orgId },
            select: { id: true },
        });

        const userIds = users.map(u => u.id);
        const now = new Date();

        const [total, active] = await Promise.all([
            prisma.session.count({
                where: { userId: { in: userIds } },
            }),
            prisma.session.count({
                where: {
                    userId: { in: userIds },
                    expiresAt: { gt: now },
                },
            }),
        ]);

        return {
            totalSessions: total,
            activeSessions: active,
            expiredSessions: total - active,
        };
    },
};

// ============================================
// SESSION CLEANUP SCHEDULER
// ============================================

let cleanupInterval: NodeJS.Timeout | null = null;

const DEFAULT_CLEANUP_INTERVAL_HOURS = 6;
const DEFAULT_OLDER_THAN_HOURS = 24;

/**
 * Start the session cleanup scheduler
 * @param intervalHours - How often to run cleanup (default: every 6 hours)
 * @param olderThanHours - Delete sessions older than this (default: 24 hours)
 */
export function startSessionCleanupScheduler(
    intervalHours: number = DEFAULT_CLEANUP_INTERVAL_HOURS,
    olderThanHours: number = DEFAULT_OLDER_THAN_HOURS
): void {
    if (cleanupInterval) {
        logger.warn('Session cleanup scheduler already running');
        return;
    }

    // Run immediately on start
    sessionCleanupService.cleanup(olderThanHours).catch(err => {
        logger.error('Initial session cleanup failed:', err);
    });

    // Then run on interval
    const intervalMs = intervalHours * 60 * 60 * 1000;
    cleanupInterval = setInterval(() => {
        sessionCleanupService.cleanup(olderThanHours).catch(err => {
            logger.error('Scheduled session cleanup failed:', err);
        });
    }, intervalMs);

    logger.info(`Session cleanup scheduler started: every ${intervalHours} hours, deleting sessions older than ${olderThanHours} hours`);
}

/**
 * Stop the session cleanup scheduler
 */
export function stopSessionCleanupScheduler(): void {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        logger.info('Session cleanup scheduler stopped');
    }
}

/**
 * Trigger an immediate session cleanup via queue
 */
export async function triggerSessionCleanup(): Promise<void> {
    await addSessionCleanupJob(DEFAULT_OLDER_THAN_HOURS);
    logger.info('Session cleanup job queued');
}

export default sessionCleanupService;
