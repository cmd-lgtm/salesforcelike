import { prisma } from '../config/database';
import { logger } from '../shared/logger';
import { NotFoundError } from '../shared/errors/not-found.error';

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
        prisma.opportunity.count({ where: { orgId, stage: { notIn: ['WON', 'LOST'] } } }),
        prisma.opportunity.count({ where: { orgId, stage: 'WON', ...(startDate || endDate ? { closeDate: dateFilter } : {}) } }),
        prisma.opportunity.count({ where: { orgId, stage: 'LOST' } }),
    ]);

    // Get revenue metrics
    const [totalRevenue, pipelineValue] = await Promise.all([
        prisma.opportunity.aggregate({
            where: { orgId, stage: 'WON' },
            _sum: { amount: true },
        }),
        prisma.opportunity.aggregate({
            where: { orgId, stage: { notIn: ['WON', 'LOST'] } },
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
            total: totalRevenue._sum.amount || 0,
            pipeline: pipelineValue._sum.amount || 0,
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
    const opportunities = await prisma.opportunity.findMany({
        where: { orgId },
        select: { stage: true, amount: true, probability: true },
    });

    const byStage: Record<string, { count: number; value: number; weighted: number }> = {};
    for (const opp of opportunities) {
        if (!byStage[opp.stage]) {
            byStage[opp.stage] = { count: 0, value: 0, weighted: 0 };
        }
        byStage[opp.stage].count++;
        byStage[opp.stage].value += opp.amount || 0;
        byStage[opp.stage].weighted += (opp.amount || 0) * (opp.probability || 0) / 100;
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

    const users = await prisma.user.findMany({
        where: { orgId },
        select: { id: true, firstName: true, lastName: true, email: true },
    });

    const repPerformance = await Promise.all(
        users.map(async (user) => {
            const [opportunities, activities] = await Promise.all([
                prisma.opportunity.findMany({
                    where: {
                        ownerId: user.id,
                        ...(startDate || endDate ? { createdAt: dateFilter } : {}),
                    },
                    select: { stage: true, amount: true, probability: true },
                }),
                prisma.activity.count({
                    where: {
                        ownerId: user.id,
                        ...(startDate || endDate ? { createdAt: dateFilter } : {}),
                    },
                }),
            ]);

            const won = opportunities.filter(o => o.stage === 'WON');
            let wonValue = 0;
            for (const o of won) {
                wonValue += o.amount || 0;
            }
            let pipelineValue = 0;
            for (const o of opportunities) {
                if (o.stage !== 'WON' && o.stage !== 'LOST') {
                    pipelineValue += o.amount || 0;
                }
            }

            return {
                user: { id: user.id, name: `${user.firstName} ${user.lastName}`, email: user.email },
                opportunities: opportunities.length,
                won: won.length,
                winRate: opportunities.length > 0 ? (won.length / opportunities.length) * 100 : 0,
                wonValue,
                pipelineValue,
                activities,
            };
        })
    );

    return repPerformance;
}
