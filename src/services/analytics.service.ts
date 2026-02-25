import { prisma } from '../config/database';
import { logger } from '../shared/logger';
import { NotFoundError } from '../shared/errors/not-found.error';
import { cacheService, CACHE_TTL } from '../shared/cache';

// OpportunityStage enum (matching Prisma schema)
export const OpportunityStage = {
    PROSPECTING: 'PROSPECTING',
    QUALIFICATION: 'QUALIFICATION',
    NEEDS_ANALYSIS: 'NEEDS_ANALYSIS',
    VALUE_PROPOSITION: 'VALUE_PROPOSITION',
    DECISION_MAKERS: 'DECISION_MAKERS',
    PROPOSAL: 'PROPOSAL',
    NEGOTIATION: 'NEGOTIATION',
    CLOSED_WON: 'CLOSED_WON',
    CLOSED_LOST: 'CLOSED_LOST',
} as const;

export type OpportunityStage = typeof OpportunityStage[keyof typeof OpportunityStage];

// Type definitions
export type ForecastPeriodType = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';

export interface CreateForecastDto {
    forecastPeriod: string;
    forecastType: ForecastPeriodType;
    repForecast?: number;
    managerForecast?: number;
}

export interface UpdateForecastDto {
    repForecast?: number;
    managerForecast?: number;
    actualRevenue?: number;
}

// ============================================
// REVENUE FORECASTS
// ============================================

export async function createForecast(orgId: string, userId: string, data: CreateForecastDto) {
    // Generate AI predictions (mock for now)
    const aiBestCase = (data.repForecast || 0) * 1.3;
    const aiMostLikely = data.repForecast || 0;
    const aiWorstCase = (data.repForecast || 0) * 0.7;
    const aiConfidence = 0.85;

    const forecast = await prisma.revenueForecast.create({
        data: {
            orgId,
            forecastPeriod: data.forecastPeriod,
            forecastType: data.forecastType,
            repForecast: data.repForecast,
            managerForecast: data.managerForecast,
            aiBestCase,
            aiMostLikely,
            aiWorstCase,
            aiConfidence,
        },
    });

    logger.info('Revenue forecast created', { forecastId: forecast.id, orgId, userId });
    return forecast;
}

export async function getForecastById(orgId: string, forecastId: string) {
    const forecast = await prisma.revenueForecast.findFirst({
        where: { id: forecastId, orgId },
    });

    if (!forecast) {
        throw new NotFoundError('Forecast not found');
    }

    return forecast;
}

export async function getForecasts(
    orgId: string,
    filters: { forecastPeriod?: string; forecastType?: ForecastPeriodType; page?: number; limit?: number } = {}
) {
    const { forecastPeriod, forecastType, page = 1, limit = 20 } = filters;

    const where: any = { orgId };
    if (forecastPeriod) where.forecastPeriod = forecastPeriod;
    if (forecastType) where.forecastType = forecastType;

    const [forecasts, total] = await Promise.all([
        prisma.revenueForecast.findMany({
            where,
            orderBy: { generatedAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.revenueForecast.count({ where }),
    ]);

    return {
        data: forecasts,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
}

export async function updateForecast(orgId: string, forecastId: string, data: UpdateForecastDto) {
    const forecast = await prisma.revenueForecast.findFirst({
        where: { id: forecastId, orgId },
    });

    if (!forecast) {
        throw new NotFoundError('Forecast not found');
    }

    const updated = await prisma.revenueForecast.update({
        where: { id: forecastId },
        data,
    });

    logger.info('Revenue forecast updated', { forecastId, orgId });
    return updated;
}

// ============================================
// ANALYTICS DASHBOARD (with caching)
// ============================================

// Define return type interfaces for caching
interface DashboardMetrics {
    opportunities: {
        total: number;
        open: number;
        won: number;
        lost: number;
        winRate: number;
    };
    revenue: {
        total: number;
        pipeline: number;
    };
    activities: {
        total: number;
        meetingsThisWeek: number;
        tasksCompleted: number;
    };
}

interface PipelineAnalytics {
    [stage: string]: { count: number; value: number; weighted: number };
}

interface RepPerformanceItem {
    user: { id: string; name: string; email: string };
    opportunities: number;
    won: number;
    winRate: number;
    wonValue: number;
    pipelineValue: number;
    activities: number;
}

export async function getDashboardMetrics(orgId: string, startDate?: Date, endDate?: Date): Promise<DashboardMetrics> {
    // Build cache key based on filters
    const cacheKey = `analytics:dashboard:${orgId}:${startDate?.getTime() || 'none'}:${endDate?.getTime() || 'none'}`;

    // Try to get from cache first (short TTL = 1 minute)
    const cached = await cacheService.get<DashboardMetrics>(cacheKey);
    if (cached) {
        logger.debug(`Dashboard metrics cache hit for org ${orgId}`);
        return cached;
    }

    const dateFilter: any = {};
    if (startDate) dateFilter.gte = startDate;
    if (endDate) dateFilter.lte = endDate;

    // Get opportunity metrics
    const [totalOpportunities, openOpportunities, wonOpportunities, lostOpportunities] = await Promise.all([
        prisma.opportunity.count({ where: { orgId, ...(startDate || endDate ? { createdAt: dateFilter } : {}) } }),
        prisma.opportunity.count({ where: { orgId, stage: { notIn: [OpportunityStage.CLOSED_WON, OpportunityStage.CLOSED_LOST] } } }),
        prisma.opportunity.count({ where: { orgId, stage: OpportunityStage.CLOSED_WON, ...(startDate || endDate ? { closeDate: dateFilter } : {}) } }),
        prisma.opportunity.count({ where: { orgId, stage: OpportunityStage.CLOSED_LOST } }),
    ]);

    // Get revenue metrics
    const [totalRevenue, pipelineValue] = await Promise.all([
        prisma.opportunity.aggregate({
            where: { orgId, stage: OpportunityStage.CLOSED_WON },
            _sum: { amount: true },
        }),
        prisma.opportunity.aggregate({
            where: { orgId, stage: { notIn: [OpportunityStage.CLOSED_WON, OpportunityStage.CLOSED_LOST] } },
            _sum: { amount: true },
        }),
    ]);

    // Get activity metrics
    const [totalActivities, meetingsThisWeek, tasksCompleted] = await Promise.all([
        prisma.activity.count({ where: { orgId, ...(startDate || endDate ? { createdAt: dateFilter } : {}) } }),
        prisma.meeting.count({
            where: {
                orgId,
                startTime: {
                    gte: new Date(new Date().setDate(new Date().getDate() - 7)),
                },
            },
        }),
        prisma.task.count({
            where: {
                orgId,
                status: 'COMPLETED',
                ...(startDate || endDate ? { completedAt: dateFilter } : {}),
            },
        }),
    ]);

    const result = {
        opportunities: {
            total: totalOpportunities,
            open: openOpportunities,
            won: wonOpportunities,
            lost: lostOpportunities,
            winRate: totalOpportunities > 0 ? (wonOpportunities / totalOpportunities) * 100 : 0,
        },
        revenue: {
            total: totalRevenue._sum.amount ? Number(totalRevenue._sum.amount) : 0,
            pipeline: pipelineValue._sum.amount ? Number(pipelineValue._sum.amount) : 0,
        },
        activities: {
            total: totalActivities,
            meetingsThisWeek,
            tasksCompleted,
        },
    };

    // Cache for 1 minute ( SHORT TTL = 60s )
    await cacheService.set(cacheKey, result, CACHE_TTL.SHORT);

    return result;
}

// ============================================
// PIPELINE ANALYTICS (with caching)
// ============================================

export async function getPipelineAnalytics(orgId: string): Promise<PipelineAnalytics> {
    const cacheKey = `analytics:pipeline:${orgId}`;

    // Try cache first
    const cached = await cacheService.get<PipelineAnalytics>(cacheKey);
    if (cached) {
        logger.debug(`Pipeline analytics cache hit for org ${orgId}`);
        return cached;
    }

    // Use database-side aggregation instead of loading all records into memory
    const stageAggregation = await prisma.opportunity.groupBy({
        by: ['stage'],
        where: { orgId },
        _count: { id: true },
        _sum: { amount: true },
    });

    // Calculate weighted values in memory (much faster than loading all records)
    const byStage: Record<string, { count: number; value: number; weighted: number }> = {};

    for (const stageData of stageAggregation) {
        const count = stageData._count.id;
        const value = stageData._sum.amount ? Number(stageData._sum.amount) : 0;

        // Get average probability for this stage
        const probability = await prisma.opportunity.aggregate({
            where: { orgId, stage: stageData.stage },
            _avg: { probability: true },
        });

        const weighted = value * ((probability._avg.probability || 0) / 100);

        byStage[stageData.stage] = { count, value, weighted };
    }

    // Cache for 2 minutes
    await cacheService.set(cacheKey, byStage, CACHE_TTL.SHORT * 2);

    return byStage;
}

// ============================================
// SALES REP PERFORMANCE (with caching)
// ============================================

export async function getRepPerformance(orgId: string, startDate?: Date, endDate?: Date): Promise<RepPerformanceItem[]> {
    // Build cache key
    const cacheKey = `analytics:reps:${orgId}:${startDate?.getTime() || 'none'}:${endDate?.getTime() || 'none'}`;

    // Try cache first
    const cached = await cacheService.get<RepPerformanceItem[]>(cacheKey);
    if (cached) {
        logger.debug(`Rep performance cache hit for org ${orgId}`);
        return cached;
    }

    // Build date filter once
    const dateFilter: any = {};
    if (startDate) dateFilter.gte = startDate;
    if (endDate) dateFilter.lte = endDate;

    // Single query to get all users (no N+1)
    const users = await prisma.user.findMany({
        where: { orgId },
        select: { id: true, firstName: true, lastName: true, email: true },
    });

    if (users.length === 0) {
        return [];
    }

    const userIds = users.map(u => u.id);

    // Batch fetch all opportunities in ONE query with aggregation
    const opportunityAggregation = await prisma.opportunity.groupBy({
        by: ['ownerId', 'stage'],
        where: {
            ownerId: { in: userIds },
            ...(startDate || endDate ? { createdAt: dateFilter } : {}),
        },
        _count: { id: true },
        _sum: { amount: true },
    });

    // Batch fetch all activities in ONE query
    const activityCounts = await prisma.activity.groupBy({
        by: ['ownerId'],
        where: {
            ownerId: { in: userIds },
            ...(startDate || endDate ? { createdAt: dateFilter } : {}),
        },
        _count: { id: true },
    });

    // Create lookup maps for O(1) access
    const activityByOwner = new Map(activityCounts.map(a => [a.ownerId, a._count.id]));
    const opportunitiesByOwner = new Map<string, typeof opportunityAggregation>();

    for (const agg of opportunityAggregation) {
        if (!opportunitiesByOwner.has(agg.ownerId)) {
            opportunitiesByOwner.set(agg.ownerId, []);
        }
        opportunitiesByOwner.get(agg.ownerId)!.push(agg);
    }

    // Build result in memory (fast - no additional DB calls)
    const repPerformance = users.map(user => {
        const userOpps = opportunitiesByOwner.get(user.id) || [];
        const activityCount = activityByOwner.get(user.id) || 0;

        // Calculate metrics from aggregated data
        let won = 0;
        let wonValue = 0;
        let pipelineValue = 0;
        let total = 0;

        for (const agg of userOpps) {
            const count = agg._count.id;
            const value = agg._sum.amount ? Number(agg._sum.amount) : 0;
            total += count;

            if (agg.stage === OpportunityStage.CLOSED_WON) {
                won += count;
                wonValue += value;
            } else if (agg.stage !== OpportunityStage.CLOSED_LOST) {
                pipelineValue += value;
            }
        }

        return {
            user: { id: user.id, name: `${user.firstName} ${user.lastName}`, email: user.email },
            opportunities: total,
            won,
            winRate: total > 0 ? (won / total) * 100 : 0,
            wonValue,
            pipelineValue,
            activities: activityCount,
        };
    });

    // Cache for 2 minutes
    await cacheService.set(cacheKey, repPerformance, CACHE_TTL.SHORT * 2);

    return repPerformance;
}

// ============================================
// CACHE INVALIDATION (call when data changes)
// ============================================

export async function invalidateAnalyticsCache(orgId: string): Promise<void> {
    // Invalidate all analytics cache for this organization
    await cacheService.deletePattern(`analytics:dashboard:${orgId}:*`);
    await cacheService.deletePattern(`analytics:pipeline:${orgId}`);
    await cacheService.deletePattern(`analytics:reps:${orgId}:*`);
    logger.info(`Analytics cache invalidated for org ${orgId}`);
}
