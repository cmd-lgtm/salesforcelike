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
import { importService } from '../services/import.service';
import { exportService } from '../services/export.service';
import * as fs from 'fs';

// ============================================
// UTILITY: Create worker factory
// ============================================

function createWorker<T>(
    name: string,
    processor: (job: Job<T>) => Promise<void>,
    options?: { concurrency?: number }
): Worker<T> {
    const worker = new Worker<T>(name, processor, {
        connection: {
            maxRetriesPerRequest: null,
        },
        concurrency: options?.concurrency || 5,
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
// IMPORT WORKER
// ============================================

async function processImportJob(job: Job<ImportJob>): Promise<void> {
    const { orgId, userId, entityType, filePath, options, callbackUrl } = job.data;

    logger.info(`Processing import job ${job.id} for org ${orgId}, entity ${entityType}, file: ${filePath}`);

    try {
        await job.updateProgress(10);

        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const fileBuffer = fs.readFileSync(filePath);
        await job.updateProgress(30);

        let result;
        switch (entityType) {
            case 'leads':
                result = await importService.importLeads(orgId, userId, fileBuffer, options);
                break;
            case 'accounts':
                result = await importService.importAccounts(orgId, userId, fileBuffer, options);
                break;
            case 'contacts':
                result = await importService.importContacts(orgId, userId, fileBuffer, options);
                break;
            case 'opportunities':
                result = await importService.importOpportunities(orgId, userId, fileBuffer, options);
                break;
            default:
                throw new Error(`Unknown entity type: ${entityType}`);
        }

        await job.updateProgress(90);

        if (callbackUrl) {
            logger.info(`Would notify callback URL: ${callbackUrl}`);
        }

        try {
            fs.unlinkSync(filePath);
        } catch {
            logger.warn(`Failed to delete uploaded file: ${filePath}`);
        }

        await job.updateProgress(100);
        logger.info(`Import job ${job.id} completed: ${result.successCount} success, ${result.failureCount} failed`);

    } catch (error) {
        logger.error(`Import job ${job.id} failed:`, error);
        throw error;
    }
}

// ============================================
// EXPORT WORKER
// ============================================

async function processExportJob(job: Job<ExportJob>): Promise<void> {
    const { orgId, userId, userRole, entityType, filters, columns, callbackUrl } = job.data;

    logger.info(`Processing export job ${job.id} for org ${orgId}, entity ${entityType}`);

    try {
        await job.updateProgress(10);

        const result = await exportService.exportRecords(
            entityType as 'leads' | 'accounts' | 'contacts' | 'opportunities',
            orgId,
            userId,
            userRole,
            { filters, columns }
        );

        await job.updateProgress(80);

        if (callbackUrl) {
            logger.info(`Would notify callback URL: ${callbackUrl}`);
        }

        await job.updateProgress(100);
        logger.info(`Export job ${job.id} completed: ${result.total} records exported`);

    } catch (error) {
        logger.error(`Export job ${job.id} failed:`, error);
        throw error;
    }
}

// ============================================
// EMAIL WORKER (Placeholder)
// ============================================

async function processEmailJob(job: Job<EmailJob>): Promise<void> {
    const { to, subject } = job.data;
    logger.info(`Processing email job ${job.id} to ${to}: ${subject}`);
    logger.info(`Email job ${job.id}: Would send to ${to}`);
}

// ============================================
// START ALL WORKERS
// ============================================

const workers: Worker[] = [];

export function startWorkers(): void {
    workers.push(createWorker(QUEUE_NAMES.AUDIT_LOG, processAuditLogJob));
    workers.push(createWorker(QUEUE_NAMES.SESSION_CLEANUP, processSessionCleanupJob, { concurrency: 1 }));
    workers.push(createWorker(QUEUE_NAMES.IMPORT, processImportJob, { concurrency: 2 }));
    workers.push(createWorker(QUEUE_NAMES.EXPORT, processExportJob, { concurrency: 2 }));
    workers.push(createWorker(QUEUE_NAMES.EMAIL, processEmailJob));
    logger.info('All workers started');
}

export async function stopWorkers(): Promise<void> {
    for (const worker of workers) {
        await worker.close();
        logger.info(`Worker stopped: ${worker.name}`);
    }
    workers.length = 0;
}

export default { startWorkers, stopWorkers };
