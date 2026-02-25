import { prisma } from '../config/database';
import { logger } from '../shared/logger';
import { NotFoundError } from '../shared/errors/not-found.error';

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
// ANALYTICS DASHBOARD
// ============================================

export async function getDashboardMetrics(orgId: string, startDate?: Date, endDate?: Date) {
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

    return {
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
}

// ============================================
// PIPELINE ANALYTICS
// ============================================

export async function getPipelineAnalytics(orgId: string) {
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

    return byStage;
}

// ============================================
// SALES REP PERFORMANCE
// ============================================

export async function getRepPerformance(orgId: string, startDate?: Date, endDate?: Date) {
    const dateFilter: any = {};
    if (startDate) dateFilter.gte = startDate;
    if (endDate) dateFilter.lte = endDate;

    // Get all users in a single query
    const users = await prisma.user.findMany({
        where: { orgId },
        select: { id: true, firstName: true, lastName: true, email: true },
    });

    if (users.length === 0) {
        return [];
    }

    const userIds = users.map(u => u.id);

    // Batch all queries together - only 3 queries total instead of 2*N queries
    const [opportunitiesByOwner, activitiesByOwner, wonAggregation] = await Promise.all([
        // Get all opportunities grouped by owner in one query
        prisma.opportunity.groupBy({
            by: ['ownerId', 'stage'],
            where: {
                ownerId: { in: userIds },
                ...(startDate || endDate ? { createdAt: dateFilter } : {}),
            },
            _count: { id: true },
            _sum: { amount: true },
        }),
        // Get activity counts grouped by owner in one query
        prisma.activity.groupBy({
            by: ['ownerId'],
            where: {
                ownerId: { in: userIds },
                ...(startDate || endDate ? { createdAt: dateFilter } : {}),
            },
            _count: { id: true },
        }),
        // Get won opportunities total value per owner
        prisma.opportunity.groupBy({
            by: ['ownerId'],
            where: {
                ownerId: { in: userIds },
                stage: OpportunityStage.CLOSED_WON,
                ...(startDate || endDate ? { closeDate: dateFilter } : {}),
            },
            _sum: { amount: true },
        }),
    ]);

    // Pre-compute maps for O(1) lookups
    const oppMap = new Map<string, { total: number; won: number; wonValue: number; pipelineValue: number }>();
    const activityMap = new Map<string, number>();
    const wonValueMap = new Map<string, number>();

    // Process opportunities
    for (const opp of opportunitiesByOwner) {
        const ownerId = opp.ownerId;
        if (!oppMap.has(ownerId)) {
            oppMap.set(ownerId, { total: 0, won: 0, wonValue: 0, pipelineValue: 0 });
        }
        const entry = oppMap.get(ownerId)!;
        entry.total += opp._count.id;

        const amount = opp._sum.amount ? Number(opp._sum.amount) : 0;

        if (opp.stage === OpportunityStage.CLOSED_WON) {
            entry.won += opp._count.id;
            entry.wonValue += amount;
        } else if (opp.stage !== OpportunityStage.CLOSED_LOST) {
            entry.pipelineValue += amount;
        }
    }

    // Process activities
    for (const act of activitiesByOwner) {
        activityMap.set(act.ownerId, act._count.id);
    }

    // Process won values
    for (const won of wonAggregation) {
        wonValueMap.set(won.ownerId, won._sum.amount ? Number(won._sum.amount) : 0);
    }

    // Build final result - O(N) instead of O(N*M)
    const repPerformance = users.map(user => {
        const opps = oppMap.get(user.id) || { total: 0, won: 0, wonValue: 0, pipelineValue: 0 };
        const activities = activityMap.get(user.id) || 0;
        const wonValue = wonValueMap.get(user.id) || opps.wonValue;

        return {
            user: { id: user.id, name: `${user.firstName} ${user.lastName}`, email: user.email },
            opportunities: opps.total,
            won: opps.won,
            winRate: opps.total > 0 ? (opps.won / opps.total) * 100 : 0,
            wonValue,
            pipelineValue: opps.pipelineValue,
            activities,
        };
    });

    return repPerformance;
}
