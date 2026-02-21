import { prisma } from '../config/database';
import { logger } from '../shared/logger';
import { Role, OpportunityStage, LeadStatus, ActivityType, Prisma } from '@prisma/client';

// ============================================
// TYPES & INTERFACES
// ============================================

export interface ReportFilters {
    from?: string | Date;
    to?: string | Date;
    ownerId?: string;
    teamId?: string;
}

export interface PipelineByStage {
    stage: OpportunityStage;
    stageLabel: string;
    count: number;
    totalAmount: number;
    weightedAmount: number;
}

export interface WonLostByMonth {
    month: string;
    year: number;
    monthNumber: number;
    wonCount: number;
    wonAmount: number;
    lostCount: number;
    lostAmount: number;
    totalCount: number;
}

export interface LeadStatusDistribution {
    status: LeadStatus;
    statusLabel: string;
    count: number;
    percentage: number;
}

export interface LeadConversionReport {
    totalLeads: number;
    convertedLeads: number;
    conversionRate: number;
    statusDistribution: LeadStatusDistribution[];
}

export interface ActivityByUser {
    userId: string;
    userName: string;
    totalCount: number;
}

export interface ActivityByType {
    type: ActivityType;
    typeLabel: string;
    count: number;
}

export interface ActivitiesReport {
    byUser: ActivityByUser[];
    byType: ActivityByType[];
    totalCount: number;
}

// ============================================
// REPORT SERVICE
// ============================================

export class ReportService {
    /**
     * Build base where clause for multi-tenant isolation and filters
     */
    private buildBaseWhereClause(orgId: string, userId: string, role: Role, filters: ReportFilters): Prisma.OpportunityWhereInput {
        const where: Prisma.OpportunityWhereInput = {
            orgId,
        };

        // Reps can only see their own data
        if (role === Role.REP) {
            where.ownerId = userId;
        } else if (filters.ownerId) {
            // Managers/Admins can filter by owner
            where.ownerId = filters.ownerId;
        }

        // Date range filter
        if (filters.from || filters.to) {
            where.closeDate = {};
            if (filters.from) {
                where.closeDate.gte = new Date(filters.from);
            }
            if (filters.to) {
                where.closeDate.lte = new Date(filters.to);
            }
        }

        return where;
    }

    /**
     * Build lead where clause for multi-tenant isolation and filters
     */
    private buildLeadWhereClause(orgId: string, userId: string, role: Role, filters: ReportFilters): Prisma.LeadWhereInput {
        const where: Prisma.LeadWhereInput = {
            orgId,
        };

        // Reps can only see their own data
        if (role === Role.REP) {
            where.ownerId = userId;
        } else if (filters.ownerId) {
            where.ownerId = filters.ownerId;
        }

        // Date range filter (for createdAt)
        if (filters.from || filters.to) {
            where.createdAt = {};
            if (filters.from) {
                where.createdAt.gte = new Date(filters.from);
            }
            if (filters.to) {
                where.createdAt.lte = new Date(filters.to);
            }
        }

        return where;
    }

    /**
     * Build activity where clause for multi-tenant isolation and filters
     */
    private buildActivityWhereClause(orgId: string, userId: string, role: Role, filters: ReportFilters): Prisma.ActivityWhereInput {
        const where: Prisma.ActivityWhereInput = {
            orgId,
        };

        // Reps can only see their own data
        if (role === Role.REP) {
            where.ownerId = userId;
        } else if (filters.ownerId) {
            where.ownerId = filters.ownerId;
        }

        // Date range filter
        if (filters.from || filters.to) {
            where.activityDate = {};
            if (filters.from) {
                where.activityDate.gte = new Date(filters.from);
            }
            if (filters.to) {
                where.activityDate.lte = new Date(filters.to);
            }
        }

        return where;
    }

    /**
     * Get stage label for display
     */
    private getStageLabel(stage: OpportunityStage): string {
        const stageLabels: Record<OpportunityStage, string> = {
            [OpportunityStage.PROSPECTING]: 'Prospecting',
            [OpportunityStage.QUALIFICATION]: 'Qualification',
            [OpportunityStage.NEEDS_ANALYSIS]: 'Needs Analysis',
            [OpportunityStage.VALUE_PROPOSITION]: 'Value Proposition',
            [OpportunityStage.DECISION_MAKERS]: 'Decision Makers',
            [OpportunityStage.PROPOSAL]: 'Proposal',
            [OpportunityStage.NEGOTIATION]: 'Negotiation',
            [OpportunityStage.CLOSED_WON]: 'Closed Won',
            [OpportunityStage.CLOSED_LOST]: 'Closed Lost',
        };
        return stageLabels[stage] || stage;
    }

    /**
     * Get lead status label for display
     */
    private getLeadStatusLabel(status: LeadStatus): string {
        const statusLabels: Record<LeadStatus, string> = {
            [LeadStatus.NEW]: 'New',
            [LeadStatus.CONTACTED]: 'Contacted',
            [LeadStatus.QUALIFIED]: 'Qualified',
            [LeadStatus.UNQUALIFIED]: 'Unqualified',
            [LeadStatus.CONVERTED]: 'Converted',
        };
        return statusLabels[status] || status;
    }

    /**
     * Get activity type label for display
     */
    private getActivityTypeLabel(type: ActivityType): string {
        const typeLabels: Record<ActivityType, string> = {
            [ActivityType.CALL]: 'Call',
            [ActivityType.MEETING]: 'Meeting',
            [ActivityType.NOTE]: 'Note',
            [ActivityType.EMAIL]: 'Email',
        };
        return typeLabels[type] || type;
    }

    /**
     * Pipeline by Stage Report
     * Shows sum and weighted amounts by stage
     */
    async getPipelineByStage(
        orgId: string,
        userId: string,
        role: Role,
        filters: ReportFilters
    ): Promise<PipelineByStage[]> {
        try {
            const where = this.buildBaseWhereClause(orgId, userId, role, filters);

            const pipeline = await prisma.opportunity.groupBy({
                by: ['stage'],
                where: {
                    ...where,
                    // Exclude closed won/lost for active pipeline
                    stage: {
                        notIn: [OpportunityStage.CLOSED_WON, OpportunityStage.CLOSED_LOST],
                    },
                },
                _count: {
                    id: true,
                },
                _sum: {
                    amount: true,
                },
            });

            // Calculate weighted amount for each stage
            const stages = await prisma.opportunity.findMany({
                where: {
                    ...where,
                    stage: {
                        notIn: [OpportunityStage.CLOSED_WON, OpportunityStage.CLOSED_LOST],
                    },
                },
                select: {
                    stage: true,
                    amount: true,
                    probability: true,
                },
            });

            // Calculate weighted amounts by stage
            const weightedByStage: Record<string, number> = {};
            for (const stage of stages) {
                const amount = stage.amount ? parseFloat(stage.amount.toString()) : 0;
                const weighted = amount * (stage.probability / 100);
                weightedByStage[stage.stage] = (weightedByStage[stage.stage] || 0) + weighted;
            }

            const result: PipelineByStage[] = pipeline.map((item: { stage: OpportunityStage; _count: { id: number }; _sum: { amount: Prisma.Decimal | null } }) => ({
                stage: item.stage,
                stageLabel: this.getStageLabel(item.stage),
                count: item._count.id,
                totalAmount: item._sum.amount ? parseFloat(item._sum.amount.toString()) : 0,
                weightedAmount: weightedByStage[item.stage] || 0,
            }));

            // Sort by stage order
            const stageOrder: OpportunityStage[] = [
                OpportunityStage.PROSPECTING,
                OpportunityStage.QUALIFICATION,
                OpportunityStage.NEEDS_ANALYSIS,
                OpportunityStage.VALUE_PROPOSITION,
                OpportunityStage.DECISION_MAKERS,
                OpportunityStage.PROPOSAL,
                OpportunityStage.NEGOTIATION,
            ];

            result.sort((a, b) => stageOrder.indexOf(a.stage) - stageOrder.indexOf(b.stage));

            logger.info(`Pipeline by stage report generated for org ${orgId}`);
            return result;
        } catch (error) {
            logger.error('Error generating pipeline by stage report:', error);
            throw error;
        }
    }

    /**
     * Won vs Lost by Month Report
     * Monthly comparison of closed opportunities
     */
    async getWonLostByMonth(
        orgId: string,
        userId: string,
        role: Role,
        filters: ReportFilters
    ): Promise<WonLostByMonth[]> {
        try {
            const where = this.buildBaseWhereClause(orgId, userId, role, filters);

            const opportunities = await prisma.opportunity.findMany({
                where: {
                    ...where,
                    stage: {
                        in: [OpportunityStage.CLOSED_WON, OpportunityStage.CLOSED_LOST],
                    },
                },
                select: {
                    stage: true,
                    amount: true,
                    closeDate: true,
                },
            });

            // Group by month
            const monthlyData: Record<string, WonLostByMonth> = {};

            for (const opp of opportunities) {
                const date = new Date(opp.closeDate);
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                const amount = opp.amount ? parseFloat(opp.amount.toString()) : 0;

                if (!monthlyData[monthKey]) {
                    monthlyData[monthKey] = {
                        month: date.toLocaleString('default', { month: 'long' }),
                        year: date.getFullYear(),
                        monthNumber: date.getMonth() + 1,
                        wonCount: 0,
                        wonAmount: 0,
                        lostCount: 0,
                        lostAmount: 0,
                        totalCount: 0,
                    };
                }

                if (opp.stage === OpportunityStage.CLOSED_WON) {
                    monthlyData[monthKey].wonCount++;
                    monthlyData[monthKey].wonAmount += amount;
                } else {
                    monthlyData[monthKey].lostCount++;
                    monthlyData[monthKey].lostAmount += amount;
                }
                monthlyData[monthKey].totalCount++;
            }

            const result = Object.values(monthlyData).sort((a, b) => {
                if (a.year !== b.year) return a.year - b.year;
                return a.monthNumber - b.monthNumber;
            });

            logger.info(`Won vs Lost by month report generated for org ${orgId}`);
            return result;
        } catch (error) {
            logger.error('Error generating won vs lost report:', error);
            throw error;
        }
    }

    /**
     * Lead Status Distribution Report
     * Count by status with conversion rate
     */
    async getLeadStatusDistribution(
        orgId: string,
        userId: string,
        role: Role,
        filters: ReportFilters
    ): Promise<LeadConversionReport> {
        try {
            const where = this.buildLeadWhereClause(orgId, userId, role, filters);

            const statusCounts = await prisma.lead.groupBy({
                by: ['status'],
                where,
                _count: {
                    id: true,
                },
            });

            const totalLeads = statusCounts.reduce((sum: number, item: { _count: { id: number } }) => sum + item._count.id, 0);
            const convertedLeads = statusCounts.find((item: { status: LeadStatus }) => item.status === LeadStatus.CONVERTED)?._count.id || 0;

            const statusDistribution: LeadStatusDistribution[] = statusCounts.map((item: { status: LeadStatus; _count: { id: number } }) => ({
                status: item.status,
                statusLabel: this.getLeadStatusLabel(item.status),
                count: item._count.id,
                percentage: totalLeads > 0 ? (item._count.id / totalLeads) * 100 : 0,
            }));

            // Sort by status order
            const statusOrder = [
                LeadStatus.NEW,
                LeadStatus.CONTACTED,
                LeadStatus.QUALIFIED,
                LeadStatus.CONVERTED,
                LeadStatus.UNQUALIFIED,
            ];

            statusDistribution.sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status));

            logger.info(`Lead status distribution report generated for org ${orgId}`);

            return {
                totalLeads,
                convertedLeads,
                conversionRate: totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0,
                statusDistribution,
            };
        } catch (error) {
            logger.error('Error generating lead status distribution report:', error);
            throw error;
        }
    }

    /**
     * Activities by User and Type Report
     * Activity count by user and by type
     */
    async getActivitiesByUserAndType(
        orgId: string,
        userId: string,
        role: Role,
        filters: ReportFilters
    ): Promise<ActivitiesReport> {
        try {
            const where = this.buildActivityWhereClause(orgId, userId, role, filters);

            // Get activities grouped by user
            const byUser = await prisma.activity.groupBy({
                by: ['ownerId'],
                where,
                _count: {
                    id: true,
                },
            });

            // Get user details for the grouped results
            const userIds = byUser.map((item: { ownerId: string }) => item.ownerId);
            const users = await prisma.user.findMany({
                where: {
                    id: { in: userIds },
                },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                },
            });

            const userMap = new Map(users.map((u: { id: string; firstName: string; lastName: string }) => [u.id, `${u.firstName} ${u.lastName}`]));

            const activityByUser: ActivityByUser[] = byUser.map((item: { ownerId: string; _count: { id: number } }) => ({
                userId: item.ownerId,
                userName: userMap.get(item.ownerId) || 'Unknown',
                totalCount: item._count.id,
            }));

            // Sort by count descending
            activityByUser.sort((a, b) => b.totalCount - a.totalCount);

            // Get activities grouped by type
            const byType = await prisma.activity.groupBy({
                by: ['type'],
                where,
                _count: {
                    id: true,
                },
            });

            const activityByType: ActivityByType[] = byType.map((item: { type: ActivityType; _count: { id: number } }) => ({
                type: item.type,
                typeLabel: this.getActivityTypeLabel(item.type),
                count: item._count.id,
            }));

            // Sort by type order
            const typeOrder: ActivityType[] = [ActivityType.CALL, ActivityType.MEETING, ActivityType.EMAIL, ActivityType.NOTE];
            activityByType.sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type));

            const totalCount = byUser.reduce((sum: number, item: { _count: { id: number } }) => sum + item._count.id, 0);

            logger.info(`Activities by user and type report generated for org ${orgId}`);

            return {
                byUser: activityByUser,
                byType: activityByType,
                totalCount,
            };
        } catch (error) {
            logger.error('Error generating activities report:', error);
            throw error;
        }
    }

    /**
     * Export report data to CSV format
     */
    exportToCSV(data: Record<string, unknown>[], headers: string[]): string {
        const csvRows: string[] = [];

        // Add header row
        csvRows.push(headers.join(','));

        // Add data rows
        for (const row of data) {
            const values = headers.map((header) => {
                const key = header.toLowerCase().replace(/\s+/g, '');
                const value = row[key] ?? row[header] ?? '';

                // Escape quotes and wrap in quotes if contains comma
                const stringValue = String(value);
                if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
                    return `"${stringValue.replace(/"/g, '""')}"`;
                }
                return stringValue;
            });
            csvRows.push(values.join(','));
        }

        return '\uFEFF' + csvRows.join('\n'); // UTF-8 BOM for Excel compatibility
    }
}

// ============================================
// EXPORT INSTANCE
// ============================================

export const reportService = new ReportService();
