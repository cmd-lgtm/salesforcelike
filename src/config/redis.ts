import { createClient, RedisClientType } from 'redis';
import config from './index';
import { logger } from '../shared/logger';

let redisClient: RedisClientType | null = null;

export async function getRedisClient(): Promise<RedisClientType> {
    if (redisClient && redisClient.isOpen) {
        return redisClient;
    }

    redisClient = createClient({
        url: config.redis.url,
    });

    redisClient.on('error', (err) => {
        logger.error('Redis Client Error:', err);
    });

    redisClient.on('connect', () => {
        logger.info('Redis connected successfully');
    });

    await redisClient.connect();
    return redisClient;
}

export async function closeRedisConnection(): Promise<void> {
    if (redisClient && redisClient.isOpen) {
        await redisClient.quit();
        logger.info('Redis connection closed');
    }
}

export const redis = {
    get client() {
        return redisClient;
    },
};

export default redis;
