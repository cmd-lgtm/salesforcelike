import { PrismaClient } from '@prisma/client';
import { logger } from '../shared/logger';

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

export const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
        log: [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'error' },
            { emit: 'event', level: 'warn' },
        ],
    });

// Cast to any to access $on for logging
const prismaAny = prisma as any;

// Log queries in development
if (process.env.NODE_ENV === 'development') {
    prismaAny.$on('query', (e: any) => {
        logger.debug(`Query: ${e.query}`);
        logger.debug(`Duration: ${e.duration}ms`);
    });
}

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

export default prisma;
