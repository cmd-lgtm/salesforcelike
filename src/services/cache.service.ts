import { getRedisClient } from '../config/redis';
import { logger } from '../shared/logger';

// ============================================
// CACHE CONFIGURATION
// ============================================

export interface CacheOptions {
    /** Time to live in seconds (default: 5 minutes) */
    ttl?: number;
    /** If true, skips cache on this request */
    bypass?: boolean;
}

export interface CacheStats {
    hits: number;
    misses: number;
    sets: number;
    errors: number;
}

// Default TTL values (in seconds)
export const CACHE_TTL = {
    // Short-lived: data that changes frequently
    USER_SESSION: 300,        // 5 minutes
    ORG_CONFIG: 600,          // 10 minutes
    PIPELINE_STAGES: 3600,    // 1 hour

    // Medium-lived: data that changes occasionally
    USER_ROLES: 1800,         // 30 minutes
    LEAD_COUNTS: 300,         // 5 minutes
    OPPORTUNITY_COUNTS: 300,  // 5 minutes
    PIPELINE_METRICS: 600,    // 10 minutes

    // Long-lived: static reference data
    ENUM_VALUES: 86400,       // 24 hours
    FIELD_OPTIONS: 86400,     // 24 hours
};

// ============================================
// CACHE STATS (in-memory for monitoring)
// ============================================

const stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    errors: 0,
};

// ============================================
// CACHE KEYS
// ============================================

export const CacheKeys = {
    user: (userId: string) => `user:${userId}`,
    userOrg: (orgId: string) => `org:${orgId}:users`,
    orgConfig: (orgId: string) => `org:${orgId}:config`,
    leadCount: (orgId: string, filters?: string) => `lead:${orgId}:count${filters ? `:${filters}` : ''}`,
    opportunityCount: (orgId: string, filters?: string) => `opp:${orgId}:count${filters ? `:${filters}` : ''}`,
    pipelineMetrics: (orgId: string, ownerId?: string) => `pipeline:${orgId}${ownerId ? `:${ownerId}` : ''}`,
    pipelineStages: () => 'enum:opportunityStages',
    leadStatus: () => 'enum:leadStatus',
    taskStatus: () => 'enum:taskStatus',
    taskPriority: () => 'enum:taskPriority',
    userRole: (userId: string) => `user:${userId}:role`,
};

// ============================================
// CACHE SERVICE
// ============================================

export const cacheService = {
    /**
     * Get a value from cache
     */
    async get<T>(key: string): Promise<T | null> {
        try {
            const redis = await getRedisClient();
            const value = await redis.get(key);

            if (value === null) {
                stats.misses++;
                return null;
            }

            stats.hits++;
            return JSON.parse(value) as T;
        } catch (error) {
            stats.errors++;
            logger.error(`Cache get error for key ${key}:`, error);
            return null;
        }
    },

    /**
     * Set a value in cache with TTL
     */
    async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<boolean> {
        try {
            const redis = await getRedisClient();
            const ttl = options.ttl || CACHE_TTL.ORG_CONFIG;

            await redis.setEx(key, ttl, JSON.stringify(value));
            stats.sets++;
            return true;
        } catch (error) {
            stats.errors++;
            logger.error(`Cache set error for key ${key}:`, error);
            return false;
        }
    },

    /**
     * Delete a specific key from cache
     */
    async delete(key: string): Promise<boolean> {
        try {
            const redis = await getRedisClient();
            await redis.del(key);
            return true;
        } catch (error) {
            stats.errors++;
            logger.error(`Cache delete error for key ${key}:`, error);
            return false;
        }
    },

    /**
     * Delete keys matching a pattern (use with caution)
     */
    async deletePattern(pattern: string): Promise<number> {
        try {
            const redis = await getRedisClient();
            const keys = await redis.keys(pattern);

            if (keys.length === 0) {
                return 0;
            }

            await redis.del(keys);
            return keys.length;
        } catch (error) {
            stats.errors++;
            logger.error(`Cache delete pattern error for ${pattern}:`, error);
            return 0;
        }
    },

    /**
     * Delete all cache for an organization (useful when org settings change)
     */
    async invalidateOrgCache(orgId: string): Promise<void> {
        const patterns = [
            `user:${orgId}:*`,
            `org:${orgId}:*`,
            `lead:${orgId}:*`,
            `opp:${orgId}:*`,
            `pipeline:${orgId}*`,
        ];

        for (const pattern of patterns) {
            await this.deletePattern(pattern);
        }

        logger.info(`Invalidated cache for organization: ${orgId}`);
    },

    /**
     * Delete all cache for a user
     */
    async invalidateUserCache(userId: string): Promise<void> {
        await this.delete(CacheKeys.user(userId));
        await this.delete(CacheKeys.userRole(userId));
    },

    /**
     * Warm up cache with frequently accessed data
     */
    async warmUp(): Promise<void> {
        try {
            const redis = await getRedisClient();

            // Cache enum values (rarely change)
            const { OpportunityStage, LeadStatus, TaskStatus, TaskPriority } = await import('@prisma/client');

            await redis.setEx(
                CacheKeys.pipelineStages(),
                CACHE_TTL.ENUM_VALUES,
                JSON.stringify(Object.values(OpportunityStage))
            );

            await redis.setEx(
                CacheKeys.leadStatus(),
                CACHE_TTL.ENUM_VALUES,
                JSON.stringify(Object.values(LeadStatus))
            );

            await redis.setEx(
                CacheKeys.taskStatus(),
                CACHE_TTL.ENUM_VALUES,
                JSON.stringify(Object.values(TaskStatus))
            );

            await redis.setEx(
                CacheKeys.taskPriority(),
                CACHE_TTL.ENUM_VALUES,
                JSON.stringify(Object.values(TaskPriority))
            );

            logger.info('Cache warm-up completed');
        } catch (error) {
            logger.error('Cache warm-up failed:', error);
        }
    },

    /**
     * Get cache statistics
     */
    getStats(): CacheStats & { hitRate: number } {
        const total = stats.hits + stats.misses;
        const hitRate = total > 0 ? (stats.hits / total) * 100 : 0;

        return {
            ...stats,
            hitRate: Math.round(hitRate * 100) / 100,
        };
    },

    /**
     * Reset cache statistics
     */
    resetStats(): void {
        stats.hits = 0;
        stats.misses = 0;
        stats.sets = 0;
        stats.errors = 0;
    },

    /**
     * Get or fetch pattern - convenient wrapper for cache-aside pattern
     */
    async getOrFetch<T>(
        key: string,
        fetchFn: () => Promise<T>,
        options: CacheOptions = {}
    ): Promise<T> {
        // Check if bypass is set
        if (options.bypass) {
            return fetchFn();
        }

        // Try to get from cache first
        const cached = await this.get<T>(key);
        if (cached !== null) {
            return cached;
        }

        // Fetch from source
        const value = await fetchFn();

        // Store in cache (don't await to not block the response)
        if (value !== null && value !== undefined) {
            this.set(key, value, options).catch((err) => {
                logger.error(`Failed to cache key ${key}:`, err);
            });
        }

        return value;
    },
};

export default cacheService;
