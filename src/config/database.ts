import { PrismaClient } from '@prisma/client';
import { logger } from '../shared/logger';

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
    prismaReplica: PrismaClient | undefined;
};

// Primary database (for writes)
export const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
        datasources: {
            db: {
                url: process.env.DATABASE_URL,
            },
        },
        log: [
            { emit: 'event', level: 'error' },
            { emit: 'event', level: 'warn' },
        ],
    });

// Read replica database (for reads) - optional, falls back to primary if not configured
const replicaUrl = process.env.DATABASE_REPLICA_URL || process.env.DATABASE_URL;

export const prismaReplica =
    globalForPrisma.prismaReplica ??
    (replicaUrl
        ? new PrismaClient({
            datasources: {
                db: {
                    url: replicaUrl,
                },
            },
            log: [
                { emit: 'event', level: 'error' },
                { emit: 'event', level: 'warn' },
            ],
        })
        : null);

// Cast to any to access $on for logging
const prismaAny = prisma as any;
const prismaReplicaAny = prismaReplica as any;

prismaAny.$on('error', (e: any) => {
    logger.error(`Prisma Error: ${e.message}`);
});

prismaAny.$on('warn', (e: any) => {
    logger.warn(`Prisma Warning: ${e.message}`);
});

if (prismaReplicaAny) {
    prismaReplicaAny.$on('error', (e: any) => {
        logger.error(`Prisma Replica Error: ${e.message}`);
    });

    prismaReplicaAny.$on('warn', (e: any) => {
        logger.warn(`Prisma Replica Warning: ${e.message}`);
    });
}

// Prevent multiple instances of Prisma Client in development
if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
    if (prismaReplica) {
        globalForPrisma.prismaReplica = prismaReplica;
    }
}

// Graceful shutdown
const gracefulShutdown = async () => {
    await prisma.$disconnect();
    if (prismaReplica) {
        await prismaReplica.$disconnect();
    }
    logger.info('Prisma clients disconnected');
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

/**
 * Database helper for read/write splitting
 * Use for SELECT queries to route to replica
 * Use for INSERT/UPDATE/DELETE to route to primary
 */
export const db = {
    /**
     * Get primary database client (for writes)
     */
    primary: prisma,

    /**
     * Get replica database client (for reads) - may be null if not configured
     */
    replica: prismaReplica,

    /**
     * Check if replica is configured and available
     */
    hasReplica: !!prismaReplica,

    /**
     * Execute a read query on replica (falls back to primary if replica unavailable)
     */
    async read<T>(queryFn: (client: PrismaClient) => Promise<T>): Promise<T> {
        if (prismaReplica) {
            try {
                return await queryFn(prismaReplica);
            } catch (error) {
                logger.warn('Replica query failed, falling back to primary:', error);
                return await queryFn(prisma);
            }
        }
        // No replica configured, use primary
        return await queryFn(prisma);
    },

    /**
     * Execute a write query on primary (always)
     */
    async write<T>(queryFn: (client: PrismaClient) => Promise<T>): Promise<T> {
        return await queryFn(prisma);
    },

    /**
     * Get appropriate client based on operation type
     * For backward compatibility - preferReplica defaults to true for SELECT queries
     */
    getClient(preferReplica: boolean = false): PrismaClient {
        if (preferReplica && prismaReplica) {
            return prismaReplica;
        }
        return prisma;
    },
};

export default prisma;
