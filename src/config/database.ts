import { PrismaClient } from '@prisma/client';
import { logger } from '../shared/logger';

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

export const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
        // PgBouncer-compatible settings
        datasources: {
            db: {
                url: process.env.DATABASE_URL?.includes('pgbouncer')
                    ? process.env.DATABASE_URL
                    : process.env.DATABASE_URL,
            },
        },
        log: [
            { emit: 'event', level: 'error' },
            { emit: 'event', level: 'warn' },
        ],
    });

// Cast to any to access $on for logging
const prismaAny = prisma as any;

prismaAny.$on('error', (e: any) => {
    logger.error(`Prisma Error: ${e.message}`);
});

prismaAny.$on('warn', (e: any) => {
    logger.warn(`Prisma Warning: ${e.message}`);
});

// Prevent multiple instances of Prisma Client in development
if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

// Graceful shutdown
const gracefulShutdown = async () => {
    await prisma.$disconnect();
    logger.info('Prisma disconnected');
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

export default prisma;
