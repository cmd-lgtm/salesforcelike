import { Queue, Worker, QueueEvents } from 'bullmq';
import { logger } from '../shared/logger';

// ============================================
// QUEUE NAMES
// ============================================

export const QUEUE_NAMES = {
    AUDIT_LOG: 'audit-log',
    IMPORT: 'import',
    EXPORT: 'export',
    EMAIL: 'email',
    AI_PROCESSING: 'ai-processing',
    SESSION_CLEANUP: 'session-cleanup',
    CACHE_WARMUP: 'cache-warmup',
} as const;

// ============================================
// JOB TYPES
// ============================================

export interface AuditLogJob {
    orgId: string;
    userId: string | null;
    action: string;
    objectType: string;
    objectId?: string;
    changes?: object;
    outcome: string;
    errorMessage?: string;
    ipAddress?: string;
    userAgent?: string;
}

export interface ImportJob {
    orgId: string;
    userId: string;
    entityType: 'leads' | 'accounts' | 'contacts' | 'opportunities';
    filePath: string;
    options: {
        fieldMapping?: Record<string, string>;
        skipDuplicates?: boolean;
        updateExisting?: boolean;
        batchSize?: number;
    };
    callbackUrl?: string; // Webhook to notify when done
}

export interface ExportJob {
    orgId: string;
    userId: string;
    userRole: 'ADMIN' | 'MANAGER' | 'REP' | 'READ_ONLY';
    entityType: string;
    filters?: Record<string, unknown>;
    columns?: string[];
    format: 'csv' | 'json';
    callbackUrl?: string; // Webhook to notify when done
}

export interface EmailJob {
    to: string;
    subject: string;
    body: string;
    from?: string;
    cc?: string[];
    bcc?: string[];
    attachments?: Array<{ filename: string; path: string }>;
}

export interface AIProcessingJob {
    orgId: string;
    userId: string;
    type: 'nlq' | 'deal-analysis' | 'outreach' | 'pipeline-review';
    input: object;
}

export interface SessionCleanupJob {
    olderThanHours: number;
}

export interface CacheWarmupJob {
    orgId: string;
}

// ============================================
// CONNECTION OPTIONS
// ============================================

import config from '../config';

const connectionOptions = {
    maxRetriesPerRequest: null,
    url: config.redis.queueUrl,
};

// ============================================
// QUEUE FACTORY
// ============================================

const queues: Map<string, Queue> = new Map();
const workers: Map<string, Worker> = new Map();
const queueEvents: Map<string, QueueEvents> = new Map();

/**
 * Get or create a queue
 */
export function getQueue<T>(name: string): Queue<T> {
    if (!queues.has(name)) {
        const queue = new Queue<T>(name, {
            connection: connectionOptions,
            defaultJobOptions: {
                removeOnComplete: 100,
                removeOnFail: 500,
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 1000,
                },
            },
        });
        queues.set(name, queue);
        logger.info(`Queue created: ${name}`);
    }
    return queues.get(name) as Queue<T>;
}

/**
 * Get queue events for monitoring
 */
export function getQueueEvents(name: string): QueueEvents {
    if (!queueEvents.has(name)) {
        const events = new QueueEvents(name, { connection: connectionOptions });
        queueEvents.set(name, events);

        events.on('completed', ({ jobId }) => {
            logger.debug(`Job ${jobId} completed in queue ${name}`);
        });

        events.on('failed', ({ jobId, failedReason }) => {
            logger.error(`Job ${jobId} failed in queue ${name}:`, failedReason);
        });
    }
    return queueEvents.get(name) as QueueEvents;
}

// ============================================
// AUDIT LOG QUEUE
// ============================================

export async function addAuditLogJob(data: AuditLogJob): Promise<void> {
    const queue = getQueue<AuditLogJob>(QUEUE_NAMES.AUDIT_LOG);
    await queue.add('audit-log-entry', data, {
        priority: 1, // Low priority - can be processed in background
    });
}

// ============================================
// IMPORT QUEUE
// ============================================

export async function addImportJob(data: ImportJob): Promise<string> {
    const queue = getQueue<ImportJob>(QUEUE_NAMES.IMPORT);
    const job = await queue.add('import-records', data, {
        priority: 2,
    });
    return job.id!;
}

// ============================================
// EXPORT QUEUE
// ============================================

export async function addExportJob(data: ExportJob): Promise<string> {
    const queue = getQueue<ExportJob>(QUEUE_NAMES.EXPORT);
    const job = await queue.add('export-records', data, {
        priority: 2,
    });
    return job.id!;
}

// ============================================
// EMAIL QUEUE
// ============================================

export async function addEmailJob(data: EmailJob): Promise<string> {
    const queue = getQueue<EmailJob>(QUEUE_NAMES.EMAIL);
    const job = await queue.add('send-email', data, {
        priority: 3,
    });
    return job.id!;
}

// ============================================
// AI PROCESSING QUEUE
// ============================================

export async function addAIProcessingJob(data: AIProcessingJob): Promise<string> {
    const queue = getQueue<AIProcessingJob>(QUEUE_NAMES.AI_PROCESSING);
    const job = await queue.add('ai-process', data, {
        priority: 4, // Lowest priority
    });
    return job.id!;
}

// ============================================
// SESSION CLEANUP QUEUE (Scheduled)
// ============================================

export async function addSessionCleanupJob(olderThanHours: number = 24): Promise<void> {
    const queue = getQueue<SessionCleanupJob>(QUEUE_NAMES.SESSION_CLEANUP);
    await queue.add('cleanup-sessions', { olderThanHours });
}

// ============================================
// CACHE WARMUP QUEUE
// ============================================

export async function addCacheWarmupJob(orgId: string): Promise<void> {
    const queue = getQueue<CacheWarmupJob>(QUEUE_NAMES.CACHE_WARMUP);
    await queue.add('warmup-cache', { orgId });
}

// ============================================
// CLOSE ALL QUEUES
// ============================================

export async function closeAllQueues(): Promise<void> {
    logger.info('Closing all queues...');

    // Close workers first
    for (const [name, worker] of workers) {
        await worker.close();
        logger.info(`Worker closed: ${name}`);
    }
    workers.clear();

    // Close queues
    for (const [name, queue] of queues) {
        await queue.close();
        logger.info(`Queue closed: ${name}`);
    }
    queues.clear();

    // Close queue events
    for (const [name, events] of queueEvents) {
        await events.close();
        logger.info(`Queue events closed: ${name}`);
    }
    queueEvents.clear();
}

// ============================================
// HEALTH CHECK
// ============================================

export async function getQueueHealth(): Promise<Record<string, { waiting: number; active: number; completed: number; failed: number }>> {
    const health: Record<string, { waiting: number; active: number; completed: number; failed: number }> = {};

    for (const [name, queue] of queues) {
        const [waiting, active, completed, failed] = await Promise.all([
            queue.getWaitingCount(),
            queue.getActiveCount(),
            queue.getCompletedCount(),
            queue.getFailedCount(),
        ]);

        health[name] = { waiting, active, completed, failed };
    }

    return health;
}

export default {
    getQueue,
    getQueueEvents,
    getQueueHealth,
    closeAllQueues,
    QUEUE_NAMES,
    addAuditLogJob,
    addImportJob,
    addExportJob,
    addEmailJob,
    addAIProcessingJob,
    addSessionCleanupJob,
    addCacheWarmupJob,
};
