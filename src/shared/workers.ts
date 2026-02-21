import { Worker, Job } from 'bullmq';
import { prisma } from '../config/database';
import { logger } from '../shared/logger';
import {
    QUEUE_NAMES,
    AuditLogJob,
    ImportJob,
    ExportJob,
    EmailJob,
    SessionCleanupJob,
} from './queue';

// ============================================
// UTILITY: Create worker factory
// ============================================

function createWorker<T>(
    name: string,
    processor: (job: Job<T>) => Promise<void>
): Worker<T> {
    const worker = new Worker<T>(name, processor, {
        connection: {
            maxRetriesPerRequest: null,
        },
        concurrency: 5, // Process 5 jobs concurrently
    });

    worker.on('completed', (job) => {
        logger.debug(`Worker ${name}: Job ${job.id} completed`);
    });

    worker.on('failed', (job, err) => {
        logger.error(`Worker ${name}: Job ${job?.id} failed:`, err.message);
    });

    worker.on('error', (err) => {
        logger.error(`Worker ${name} error:`, err);
    });

    logger.info(`Worker started: ${name}`);
    return worker;
}

// ============================================
// AUDIT LOG WORKER
// ============================================

async function processAuditLogJob(job: Job<AuditLogJob>): Promise<void> {
    const { data } = job;

    await prisma.auditLog.create({
        data: {
            orgId: data.orgId,
            userId: data.userId,
            action: data.action as any,
            objectType: data.objectType,
            objectId: data.objectId,
            changes: data.changes,
            outcome: data.outcome as any,
            errorMessage: data.errorMessage,
            ipAddress: data.ipAddress,
            userAgent: data.userAgent,
        },
    });
}

// ============================================
// SESSION CLEANUP WORKER
// ============================================

async function processSessionCleanupJob(job: Job<SessionCleanupJob>): Promise<void> {
    const { olderThanHours } = job.data;
    const cutoffDate = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

    const result = await prisma.session.deleteMany({
        where: {
            expiresAt: {
                lt: cutoffDate,
            },
        },
    });

    logger.info(`Session cleanup: deleted ${result.count} expired sessions`);
}

// ============================================
// IMPORT WORKER (Placeholder - Import logic would move here)
// ============================================

async function processImportJob(job: Job<ImportJob>): Promise<void> {
    const { orgId, entityType } = job.data;
    logger.info(`Processing import job ${job.id} for org ${orgId}, entity ${entityType}`);

    // TODO: Move import logic from import.service.ts to here
    // This would process the file in the background

    // For now, we'll just log - the actual import is still sync
    logger.info(`Import job ${job.id} processed (sync mode)`);
}

// ============================================
// EXPORT WORKER (Placeholder)
// ============================================

async function processExportJob(job: Job<ExportJob>): Promise<void> {
    const { orgId, entityType } = job.data;
    logger.info(`Processing export job ${job.id} for org ${orgId}, entity ${entityType}`);

    // TODO: Implement export processing in background
    logger.info(`Export job ${job.id} processed (sync mode)`);
}

// ============================================
// EMAIL WORKER (Placeholder)
// ============================================

async function processEmailJob(job: Job<EmailJob>): Promise<void> {
    const { to, subject } = job.data;
    logger.info(`Processing email job ${job.id} to ${to}: ${subject}`);

    // TODO: Integrate with email provider (SendGrid, AWS SES, etc.)
    // For now, just log
    logger.info(`Email job ${job.id}: Would send to ${to}`);
}

// ============================================
// START ALL WORKERS
// ============================================

const workers: Worker[] = [];

export function startWorkers(): void {
    // Audit Log Worker (high priority - many jobs)
    workers.push(
        createWorker(QUEUE_NAMES.AUDIT_LOG, processAuditLogJob)
    );

    // Session Cleanup Worker
    workers.push(
        createWorker(QUEUE_NAMES.SESSION_CLEANUP, processSessionCleanupJob)
    );

    // Import Worker
    workers.push(
        createWorker(QUEUE_NAMES.IMPORT, processImportJob)
    );

    // Export Worker
    workers.push(
        createWorker(QUEUE_NAMES.EXPORT, processExportJob)
    );

    // Email Worker
    workers.push(
        createWorker(QUEUE_NAMES.EMAIL, processEmailJob)
    );

    logger.info('All workers started');
}

export async function stopWorkers(): Promise<void> {
    for (const worker of workers) {
        await worker.close();
        logger.info(`Worker stopped: ${worker.name}`);
    }
    workers.length = 0;
}

export default {
    startWorkers,
    stopWorkers,
};
