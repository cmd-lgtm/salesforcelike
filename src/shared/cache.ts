import { getRedisClient } from '../config/redis';
import { logger } from '../shared/logger';

export interface CacheOptions {
    /** Time to live in seconds (default: 300 = 5 minutes) */
    ttl?: number;
    /** Whether to skip cache and always fetch fresh (default: false) */
    bypass?: boolean;
}

// Default TTL values
export const CACHE_TTL = {
    SHORT: 60,          // 1 minute - for frequently changing data
    MEDIUM: 300,        // 5 minutes - for standard caching
    LONG: 3600,         // 1 hour - for slowly changing data
    DAY: 86400,         // 24 hours - for static reference data
} as const;

// Cache key prefixes for organization
export const CACHE_KEYS = {
    org: (orgId: string) => `org:${orgId}`,
    orgConfig: (orgId: string) => `org:${orgId}:config`,
    orgPlan: (orgId: string) => `org:${orgId}:plan`,
    user: (userId: string) => `user:${userId}`,
    userRole: (userId: string) => `user:${userId}:role`,
    pipelineStages: (orgId: string) => `pipeline:${orgId}:stages`,
    leadCounts: (orgId: string) => `leads:${orgId}:counts`,
    oppCounts: (orgId: string) => `opps:${orgId}:counts`,
    dashboard: (orgId: string, userId: string) => `dashboard:${orgId}:${userId}`,
    searchResults: (orgId: string, query: string) => `search:${orgId}:${query}`,
} as const;

export const cacheService = {
    /**
     * Get a value from cache
     */
    async get<T>(key: string): Promise<T | null> {
        try {
            const redis = await getRedisClient();
            const value = await redis.get(key);
            if (!value) return null;
            return JSON.parse(value) as T;
        } catch (error) {
            logger.error(`Cache get error for key ${key}:`, error);
            return null;
        }
    },

    /**
     * Set a value in cache
     */
    async set<T>(key: string, value: T, ttl: number = CACHE_TTL.MEDIUM): Promise<boolean> {
        try {
            const redis = await getRedisClient();
            await redis.set(key, JSON.stringify(value), { EX: ttl });
            return true;
        } catch (error) {
            logger.error(`Cache set error for key ${key}:`, error);
            return false;
        }
    },

    /**
     * Delete a value from cache
     */
    async delete(key: string): Promise<boolean> {
        try {
            const redis = await getRedisClient();
            await redis.del(key);
            return true;
        } catch (error) {
            logger.error(`Cache delete error for key ${key}:`, error);
            return false;
        }
    },

    /**
     * Delete keys matching a pattern (for bulk invalidation)
     */
    async deletePattern(pattern: string): Promise<number> {
        try {
            const redis = await getRedisClient();
            const keys = await redis.keys(pattern);
            if (keys.length === 0) return 0;
            return await redis.del(keys);
        } catch (error) {
            logger.error(`Cache delete pattern error for ${pattern}:`, error);
            return 0;
        }
    },

    /**
     * Invalidate all cache for an organization
     */
    async invalidateOrgCache(orgId: string): Promise<void> {
        await this.deletePattern(`org:${orgId}:*`);
        await this.deletePattern(`pipeline:${orgId}:*`);
        await this.deletePattern(`leads:${orgId}:*`);
        await this.deletePattern(`opps:${orgId}:*`);
        await this.deletePattern(`dashboard:${orgId}:*`);
        await this.deletePattern(`search:${orgId}:*`);
    },

    /**
     * Invalidate user cache
     */
    async invalidateUserCache(userId: string): Promise<void> {
        await this.delete(CACHE_KEYS.user(userId));
        await this.delete(CACHE_KEYS.userRole(userId));
    },

    /**
     * Get or set cached value with fetch function
     * This is a convenience method that handles cache hit/miss pattern
     */
    async remember<T>(
        key: string,
        fetchFn: () => Promise<T>,
        options: CacheOptions = {}
    ): Promise<T> {
        const { ttl = CACHE_TTL.MEDIUM, bypass = false } = options;

        // If bypass is true, always fetch fresh data
        if (bypass) {
            return fetchFn();
        }

        // Try to get from cache
        const cached = await this.get<T>(key);
        if (cached !== null) {
            return cached;
        }

        // Fetch fresh data
        const fresh = await fetchFn();

        // Store in cache
        if (fresh !== undefined && fresh !== null) {
            await this.set(key, fresh, ttl);
        }

        return fresh;
    },

    /**
     * Get cached organization config or fetch if not cached
     */
    async getOrgConfig<T>(
        orgId: string,
        fetchFn: () => Promise<T>,
        bypass: boolean = false
    ): Promise<T> {
        return this.remember(
            CACHE_KEYS.orgConfig(orgId),
            fetchFn,
            { ttl: CACHE_TTL.LONG, bypass }
        );
    },

    /**
     * Get cached pipeline stages or fetch if not cached
     */
    async getPipelineStages<T>(
        orgId: string,
        fetchFn: () => Promise<T>
    ): Promise<T> {
        return this.remember(
            CACHE_KEYS.pipelineStages(orgId),
            fetchFn,
            { ttl: CACHE_TTL.DAY } // Stages rarely change
        );
    },

    /**
     * Get cached counts or fetch if not cached
     */
    async getCounts<T>(
        orgId: string,
        countType: 'leads' | 'opps',
        fetchFn: () => Promise<T>
    ): Promise<T> {
        const key = countType === 'leads'
            ? CACHE_KEYS.leadCounts(orgId)
            : CACHE_KEYS.oppCounts(orgId);

        return this.remember(key, fetchFn, { ttl: CACHE_TTL.SHORT });
    },

    /**
     * Warm up cache for an organization (prefetch commonly used data)
     */
    async warmUpOrgCache(
        orgId: string,
        fetchFns: {
            orgConfig: () => Promise<unknown>;
            pipelineStages: () => Promise<unknown>;
            leadCounts: () => Promise<unknown>;
            oppCounts: () => Promise<unknown>;
        }
    ): Promise<void> {
        try {
            await Promise.all([
                this.getOrgConfig(orgId, fetchFns.orgConfig),
                this.getPipelineStages(orgId, fetchFns.pipelineStages),
                this.getCounts(orgId, 'leads', fetchFns.leadCounts),
                this.getCounts(orgId, 'opps', fetchFns.oppCounts),
            ]);
            logger.info(`Cache warmed up for org ${orgId}`);
        } catch (error) {
            logger.error(`Cache warm-up failed for org ${orgId}:`, error);
        }
    },
};

export default cacheService;
