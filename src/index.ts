import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import config from './config';
import { logger } from './shared/logger';
import { prisma, db } from './config/database';
import { getRedisClient } from './config/redis';
import { startWorkers, stopWorkers } from './shared/workers';
import { closeAllQueues } from './shared/queue';
import { startSessionCleanupScheduler, stopSessionCleanupScheduler } from './services/session-cleanup.service';

// Import routes
import authRoutes from './api/routes/auth.routes';
import userRoutes from './api/routes/user.routes';
import leadRoutes from './api/routes/lead.routes';
import accountRoutes from './api/routes/account.routes';
import contactRoutes from './api/routes/contact.routes';
import opportunityRoutes from './api/routes/opportunity.routes';
import activityRoutes from './api/routes/activity.routes';
import taskRoutes from './api/routes/task.routes';
import adminRoutes from './api/routes/admin.routes';
import organizationRoutes from './api/routes/organization.routes';
import reportRoutes from './api/routes/report.routes';
import importRoutes from './api/routes/import.routes';
import exportRoutes from './api/routes/export.routes';
import apiKeyRoutes from './api/routes/api-key.routes';
import auditRoutes from './api/routes/audit.routes';
import billingRoutes from './api/routes/billing.routes';
import aiRoutes from './api/routes/ai.routes';
import healthRoutes from './api/routes/health.routes';

// Import middleware
import { errorHandler } from './api/middleware/error-handler';

const app: Application = express();

// ============================================
// SECURITY MIDDLEWARE
// ============================================

// Helmet for security headers
app.use(helmet());

// CORS configuration
app.use(cors({
    origin: config.cors.origin,
    credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later.' } },
});
app.use(limiter);

// ============================================
// BODY PARSING
// ============================================

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', async (_req: Request, res: Response) => {
    try {
        // Check primary database connection
        await prisma.$queryRaw`SELECT 1`;

        // Check replica connection if configured
        let replicaStatus = db.hasReplica ? 'not_configured' : 'no_replica';
        if (db.hasReplica && db.replica) {
            try {
                await db.replica.$queryRaw`SELECT 1`;
                replicaStatus = 'connected';
            } catch {
                replicaStatus = 'disconnected';
            }
        }

        // Check Redis connection
        const redis = await getRedisClient();
        await redis.ping();

        res.status(200).json({
            success: true,
            data: {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                services: {
                    database: 'connected',
                    databaseReplica: replicaStatus,
                    redis: 'connected',
                },
            },
        });
    } catch (error) {
        logger.error('Health check failed:', error);
        res.status(503).json({
            success: false,
            error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'One or more services are unavailable',
            },
        });
    }
});

// ============================================
// API ROUTES
// ============================================

// API v1 routes
const apiPrefix = '/api/v1';

app.use(`${apiPrefix}/auth`, authRoutes);
app.use(`${apiPrefix}/users`, userRoutes);
app.use(`${apiPrefix}/leads`, leadRoutes);
app.use(`${apiPrefix}/accounts`, accountRoutes);
app.use(`${apiPrefix}/contacts`, contactRoutes);
app.use(`${apiPrefix}/opportunities`, opportunityRoutes);
app.use(`${apiPrefix}/activities`, activityRoutes);
app.use(`${apiPrefix}/tasks`, taskRoutes);
app.use(`${apiPrefix}/admin`, adminRoutes);
app.use(`${apiPrefix}/organizations`, organizationRoutes);
app.use(`${apiPrefix}/reports`, reportRoutes);
app.use(`${apiPrefix}/import`, importRoutes);
app.use(`${apiPrefix}/export`, exportRoutes);
app.use(`${apiPrefix}/api-keys`, apiKeyRoutes);
app.use(`${apiPrefix}/audit-logs`, auditRoutes);
app.use(`${apiPrefix}/billing`, billingRoutes);
app.use(`${apiPrefix}/ai`, aiRoutes);
app.use(`${apiPrefix}/health`, healthRoutes);

// ============================================
// ERROR HANDLING
// ============================================

// 404 handler
app.use((_req: Request, res: Response) => {
    res.status(404).json({
        success: false,
        error: {
            code: 'NOT_FOUND',
            message: `Route ${_req.method} ${_req.path} not found`,
        },
    });
});

// Global error handler
app.use(errorHandler);

// ============================================
// SERVER STARTUP
// ============================================

async function startServer() {
    try {
        // Connect to database
        await prisma.$connect();
        logger.info('Database connected successfully');

        // Connect to Redis
        await getRedisClient();
        logger.info('Redis connected successfully');

        // Start background job workers
        startWorkers();
        logger.info('Background workers started');

        // Start session cleanup scheduler
        startSessionCleanupScheduler();
        logger.info('Session cleanup scheduler started');

        // Start server
        app.listen(config.app.port, () => {
            logger.info(`Server running on port ${config.app.port} in ${config.app.nodeEnv} mode`);
            logger.info(`Health check available at http://localhost:${config.app.port}/health`);
        });
    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    stopSessionCleanupScheduler();
    await stopWorkers();
    await closeAllQueues();
    await prisma.$disconnect();
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully');
    stopSessionCleanupScheduler();
    await stopWorkers();
    await closeAllQueues();
    await prisma.$disconnect();
    process.exit(0);
});

startServer();

export default app;
