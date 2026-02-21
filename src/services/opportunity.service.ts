import { prisma } from '../config/database';
import { logger } from '../shared/logger';
import { ValidationError } from '../shared/errors/validation.error';
import { NotFoundError } from '../shared/errors/not-found.error';
import { OpportunityStage, Role, AuditAction, AuditOutcome, Prisma } from '@prisma/client';
import { cacheService, CACHE_KEYS } from '../shared/cache';

// ============================================
// TYPES & INTERFACES
// ============================================

export interface CreateOpportunityDto {
    name: string;
    stage?: OpportunityStage;
    amount?: number;
    closeDate: string | Date;
    accountId?: string;
    contactId?: string;
}

export interface UpdateOpportunityDto {
    name?: string;
    stage?: OpportunityStage;
    amount?: number | null;
    closeDate?: string | Date;
    accountId?: string | null;
    contactId?: string | null;
    lostReason?: string | null;
    wonNotes?: string | null;
}

export interface UpdateStageDto {
    stage: OpportunityStage;
}

export interface OpportunityFilters {
    stage?: OpportunityStage;
    ownerId?: string;
    accountId?: string;
    contactId?: string;
    closeDateFrom?: string | Date;
    closeDateTo?: string | Date;
    search?: string;
    minAmount?: number;
    maxAmount?: number;
    sortBy?: 'createdAt' | 'updatedAt' | 'name' | 'amount' | 'closeDate' | 'stage';
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number;
}

export interface PaginatedResponse<T> {
    data: T[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

export interface OpportunityWithRelations {
    id: string;
    name: string;
    stage: OpportunityStage;
    amount: Prisma.Decimal | null;
    probability: number;
    closeDate: Date;
    lostReason: string | null;
    wonNotes: string | null;
    ownerId: string;
    orgId: string;
    accountId: string | null;
    contactId: string | null;
    createdAt: Date;
    updatedAt: Date;
    owner?: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
    };
    account?: {
        id: string;
        name: string;
        website: string | null;
    } | null;
    contact?: {
        id: string;
        firstName: string;
        lastName: string;
        email: string | null;
    } | null;
    _count?: {
        activities: number;
        tasks: number;
    };
}

// Pipeline and Kanban types
export interface PipelineStageMetrics {
    stage: OpportunityStage;
    count: number;
    totalAmount: number;
    weightedAmount: number;
}

export interface PipelineMetrics {
    totalCount: number;
    totalAmount: number;
    weightedAmount: number;
    stages: PipelineStageMetrics[];
}

export interface KanbanBoard {
    stages: {
        stage: OpportunityStage;
        opportunities: OpportunityWithRelations[];
        totals: {
            count: number;
            amount: number;
            weightedAmount: number;
        };
    }[];
}

// ============================================
// STAGE PROBABILITY MAPPING
// ============================================

const STAGE_PROBABILITY_MAP: Record<OpportunityStage, number> = {
    [OpportunityStage.PROSPECTING]: 10,
    [OpportunityStage.QUALIFICATION]: 20,
    [OpportunityStage.NEEDS_ANALYSIS]: 30,
    [OpportunityStage.VALUE_PROPOSITION]: 40,
    [OpportunityStage.DECISION_MAKERS]: 50,
    [OpportunityStage.PROPOSAL]: 60,
    [OpportunityStage.NEGOTIATION]: 75,
    [OpportunityStage.CLOSED_WON]: 100,
    [OpportunityStage.CLOSED_LOST]: 0,
};

const VALID_STAGES = Object.values(OpportunityStage);

// ============================================
// VALIDATION
// ============================================

function validateOpportunityData(dto: CreateOpportunityDto | UpdateOpportunityDto): void {
    const errors: { field: string; message: string; code: string }[] = [];

    if ('name' in dto && dto.name !== undefined) {
        if (typeof dto.name !== 'string' || dto.name.trim().length === 0) {
            errors.push({ field: 'name', message: 'Opportunity name is required', code: 'NAME_REQUIRED' });
        } else if (dto.name.length > 255) {
            errors.push({ field: 'name', message: 'Opportunity name must be less than 255 characters', code: 'NAME_TOO_LONG' });
        }
    }

    if ('stage' in dto && dto.stage !== undefined) {
        if (dto.stage !== null && !VALID_STAGES.includes(dto.stage)) {
            errors.push({
                field: 'stage',
                message: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}`,
                code: 'INVALID_STAGE'
            });
        }
    }

    if ('amount' in dto && dto.amount !== undefined) {
        if (dto.amount !== null && (isNaN(dto.amount) || dto.amount < 0)) {
            errors.push({ field: 'amount', message: 'Amount must be a positive number', code: 'INVALID_AMOUNT' });
        }
    }

    if ('closeDate' in dto && dto.closeDate !== undefined) {
        if (typeof dto.closeDate === 'string') {
            const date = new Date(dto.closeDate);
            if (isNaN(date.getTime())) {
                errors.push({ field: 'closeDate', message: 'Invalid close date format', code: 'INVALID_DATE' });
            }
        }
    }

    if ('accountId' in dto && dto.accountId !== undefined && dto.accountId !== null) {
        if (typeof dto.accountId !== 'string' || dto.accountId.trim().length === 0) {
            errors.push({ field: 'accountId', message: 'Invalid account ID', code: 'INVALID_ACCOUNT_ID' });
        }
    }

    if ('contactId' in dto && dto.contactId !== undefined && dto.contactId !== null) {
        if (typeof dto.contactId !== 'string' || dto.contactId.trim().length === 0) {
            errors.push({ field: 'contactId', message: 'Invalid contact ID', code: 'INVALID_CONTACT_ID' });
        }
    }

    if (errors.length > 0) {
        throw new ValidationError('Opportunity validation failed', errors);
    }
}

function getProbabilityForStage(stage: OpportunityStage): number {
    return STAGE_PROBABILITY_MAP[stage] ?? 10;
}

// ============================================
// AUDIT LOGGING
// ============================================

async function logAudit(
    orgId: string,
    userId: string | null,
    action: AuditAction,
    objectType: string,
    objectId: string | null,
    changes?: { before?: object; after?: object },
    outcome: AuditOutcome = AuditOutcome.SUCCESS,
    errorMessage?: string
): Promise<void> {
    try {
        await prisma.auditLog.create({
            data: {
                orgId,
                userId,
                action,
                objectType,
                objectId,
                changes: changes ? { before: changes.before, after: changes.after } : undefined,
                outcome,
                errorMessage,
            },
        });
    } catch (error) {
        logger.error('Failed to create audit log:', error);
    }
}

// ============================================
// OPPORTUNITY SERVICE
// ============================================

export const opportunityService = {
    /**
     * Create a new opportunity
     */
    async create(
        orgId: string,
        userId: string,
        dto: CreateOpportunityDto,
        _userRole: Role
    ): Promise<OpportunityWithRelations> {
        validateOpportunityData(dto);

        const stage = dto.stage || OpportunityStage.PROSPECTING;
        const probability = getProbabilityForStage(stage);
        const closeDate = new Date(dto.closeDate);

        const opportunity = await prisma.opportunity.create({
            data: {
                orgId,
                ownerId: userId,
                name: dto.name.trim(),
                stage,
                probability,
                amount: dto.amount ? new Prisma.Decimal(dto.amount) : null,
                closeDate,
                accountId: dto.accountId || null,
                contactId: dto.contactId || null,
            },
            include: {
                owner: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
                account: {
                    select: {
                        id: true,
                        name: true,
                        website: true,
                    },
                },
                contact: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
            },
        });

        await logAudit(orgId, userId, AuditAction.CREATE, 'Opportunity', opportunity.id, { after: dto });

        logger.info(`Opportunity created: ${opportunity.id} by user ${userId}`);

        return opportunity as OpportunityWithRelations;
    },

    /**
     * Get opportunities with filtering, sorting, and pagination
     */
    async findAll(
        orgId: string,
        userId: string,
        userRole: Role,
        filters: OpportunityFilters
    ): Promise<PaginatedResponse<OpportunityWithRelations>> {
        const {
            stage,
            ownerId,
            accountId,
            contactId,
            closeDateFrom,
            closeDateTo,
            search,
            minAmount,
            maxAmount,
            sortBy = 'createdAt',
            sortOrder = 'desc',
            page = 1,
            limit = 20,
        } = filters;

        // Build where clause
        const where: any = {
            orgId,
        };

        // Role-based filtering
        if (userRole === Role.REP) {
            // Reps can only see their own opportunities
            where.ownerId = userId;
        } else if (ownerId) {
            // Managers/Admins can filter by owner
            where.ownerId = ownerId;
        }

        if (stage) {
            where.stage = stage;
        }

        if (accountId) {
            where.accountId = accountId;
        }

        if (contactId) {
            where.contactId = contactId;
        }

        if (closeDateFrom || closeDateTo) {
            where.closeDate = {};
            if (closeDateFrom) {
                where.closeDate.gte = new Date(closeDateFrom);
            }
            if (closeDateTo) {
                where.closeDate.lte = new Date(closeDateTo);
            }
        }

        if (search) {
            const searchLower = search.toLowerCase();
            where.name = { contains: searchLower, mode: 'insensitive' };
        }

        if (minAmount !== undefined || maxAmount !== undefined) {
            where.amount = {};
            if (minAmount !== undefined) {
                where.amount.gte = minAmount;
            }
            if (maxAmount !== undefined) {
                where.amount.lte = maxAmount;
            }
        }

        // Calculate pagination
        const skip = (page - 1) * limit;
        const take = Math.min(limit, 100); // Max 100 per page

        // Get total count
        const total = await prisma.opportunity.count({ where });

        // Get opportunities
        const opportunities = await prisma.opportunity.findMany({
            where,
            include: {
                owner: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
                account: {
                    select: {
                        id: true,
                        name: true,
                        website: true,
                    },
                },
                contact: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
                _count: {
                    select: {
                        activities: true,
                        tasks: true,
                    },
                },
            },
            orderBy: {
                [sortBy]: sortOrder,
            },
            skip,
            take,
        });

        await logAudit(
            orgId,
            userId,
            AuditAction.READ,
            'Opportunity',
            null,
            undefined,
            AuditOutcome.SUCCESS,
            `Listed ${opportunities.length} opportunities`
        );

        return {
            data: opportunities as OpportunityWithRelations[],
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    },

    /**
     * Get a single opportunity by ID
     */
    async findById(
        orgId: string,
        userId: string,
        userRole: Role,
        opportunityId: string
    ): Promise<OpportunityWithRelations> {
        const opportunity = await prisma.opportunity.findFirst({
            where: {
                id: opportunityId,
                orgId,
            },
            include: {
                owner: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
                account: {
                    select: {
                        id: true,
                        name: true,
                        website: true,
                    },
                },
                contact: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
                _count: {
                    select: {
                        activities: true,
                        tasks: true,
                    },
                },
            },
        });

        if (!opportunity) {
            throw new NotFoundError('Opportunity not found');
        }

        // Check ownership for reps
        if (userRole === Role.REP && opportunity.ownerId !== userId) {
            throw new NotFoundError('Opportunity not found'); // Don't reveal existence
        }

        await logAudit(orgId, userId, AuditAction.READ, 'Opportunity', opportunityId);

        return opportunity as OpportunityWithRelations;
    },

    /**
     * Update an opportunity
     */
    async update(
        orgId: string,
        userId: string,
        userRole: Role,
        opportunityId: string,
        dto: UpdateOpportunityDto
    ): Promise<OpportunityWithRelations> {
        validateOpportunityData(dto);

        // Get existing opportunity
        const existingOpportunity = await prisma.opportunity.findFirst({
            where: {
                id: opportunityId,
                orgId,
            },
        });

        if (!existingOpportunity) {
            throw new NotFoundError('Opportunity not found');
        }

        // Check ownership for reps
        if (userRole === Role.REP && existingOpportunity.ownerId !== userId) {
            throw new NotFoundError('Opportunity not found');
        }

        // Determine new stage and probability
        let newStage = existingOpportunity.stage;
        let newProbability = existingOpportunity.probability;

        if (dto.stage !== undefined) {
            newStage = dto.stage;
            newProbability = getProbabilityForStage(newStage);
        }

        const updatedOpportunity = await prisma.opportunity.update({
            where: { id: opportunityId },
            data: {
                ...(dto.name && { name: dto.name.trim() }),
                ...(dto.stage !== undefined && { stage: newStage, probability: newProbability }),
                ...(dto.amount !== undefined && { amount: dto.amount ? new Prisma.Decimal(dto.amount) : null }),
                ...(dto.closeDate !== undefined && { closeDate: new Date(dto.closeDate) }),
                ...(dto.accountId !== undefined && { accountId: dto.accountId }),
                ...(dto.contactId !== undefined && { contactId: dto.contactId }),
                ...(dto.lostReason !== undefined && { lostReason: dto.lostReason }),
                ...(dto.wonNotes !== undefined && { wonNotes: dto.wonNotes }),
            },
            include: {
                owner: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
                account: {
                    select: {
                        id: true,
                        name: true,
                        website: true,
                    },
                },
                contact: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
                _count: {
                    select: {
                        activities: true,
                        tasks: true,
                    },
                },
            },
        });

        await logAudit(orgId, userId, AuditAction.UPDATE, 'Opportunity', opportunityId, {
            before: existingOpportunity,
            after: dto,
        });

        logger.info(`Opportunity updated: ${opportunityId} by user ${userId}`);

        return updatedOpportunity as OpportunityWithRelations;
    },

    /**
     * Update opportunity stage (special endpoint for Kanban drag-and-drop)
     */
    async updateStage(
        orgId: string,
        userId: string,
        userRole: Role,
        opportunityId: string,
        dto: UpdateStageDto
    ): Promise<OpportunityWithRelations> {
        const errors: { field: string; message: string; code: string }[] = [];

        if (!dto.stage || !VALID_STAGES.includes(dto.stage)) {
            errors.push({
                field: 'stage',
                message: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}`,
                code: 'INVALID_STAGE'
            });
        }

        if (errors.length > 0) {
            throw new ValidationError('Stage update validation failed', errors);
        }

        // Get existing opportunity
        const existingOpportunity = await prisma.opportunity.findFirst({
            where: {
                id: opportunityId,
                orgId,
            },
        });

        if (!existingOpportunity) {
            throw new NotFoundError('Opportunity not found');
        }

        // Check ownership for reps
        if (userRole === Role.REP && existingOpportunity.ownerId !== userId) {
            throw new NotFoundError('Opportunity not found');
        }

        const newProbability = getProbabilityForStage(dto.stage);

        const updatedOpportunity = await prisma.opportunity.update({
            where: { id: opportunityId },
            data: {
                stage: dto.stage,
                probability: newProbability,
            },
            include: {
                owner: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
                account: {
                    select: {
                        id: true,
                        name: true,
                        website: true,
                    },
                },
                contact: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
                _count: {
                    select: {
                        activities: true,
                        tasks: true,
                    },
                },
            },
        });

        await logAudit(
            orgId,
            userId,
            AuditAction.UPDATE,
            'Opportunity',
            opportunityId,
            {
                before: { stage: existingOpportunity.stage, probability: existingOpportunity.probability },
                after: { stage: dto.stage, probability: newProbability },
            }
        );

        logger.info(`Opportunity stage updated: ${opportunityId} to ${dto.stage} by user ${userId}`);

        return updatedOpportunity as OpportunityWithRelations;
    },

    /**
     * Delete an opportunity
     */
    async delete(
        orgId: string,
        userId: string,
        userRole: Role,
        opportunityId: string
    ): Promise<void> {
        // Get existing opportunity
        const existingOpportunity = await prisma.opportunity.findFirst({
            where: {
                id: opportunityId,
                orgId,
            },
            include: {
                _count: {
                    select: {
                        activities: true,
                        tasks: true,
                    },
                },
            },
        });

        if (!existingOpportunity) {
            throw new NotFoundError('Opportunity not found');
        }

        // Check ownership for reps
        if (userRole === Role.REP && existingOpportunity.ownerId !== userId) {
            throw new NotFoundError('Opportunity not found');
        }

        // Check for related records
        if (existingOpportunity._count.activities > 0 || existingOpportunity._count.tasks > 0) {
            throw new ValidationError('Cannot delete opportunity with associated activities or tasks', [
                { field: 'id', message: 'Please delete associated activities and tasks first', code: 'HAS_RELATED_RECORDS' }
            ]);
        }

        await prisma.opportunity.delete({
            where: { id: opportunityId },
        });

        await logAudit(orgId, userId, AuditAction.DELETE, 'Opportunity', opportunityId, {
            before: existingOpportunity,
        });

        logger.info(`Opportunity deleted: ${opportunityId} by user ${userId}`);
    },

    /**
     * Get pipeline metrics
     */
    async getPipelineMetrics(
        orgId: string,
        userId: string,
        userRole: Role,
        filters: { closeDateFrom?: string | Date; closeDateTo?: string | Date; ownerId?: string }
    ): Promise<PipelineMetrics> {
        const { closeDateFrom, closeDateTo, ownerId } = filters;

        // Build where clause
        const where: any = {
            orgId,
            // Exclude closed won/lost from main pipeline view
            stage: {
                notIn: [OpportunityStage.CLOSED_WON, OpportunityStage.CLOSED_LOST],
            },
        };

        // Role-based filtering
        if (userRole === Role.REP) {
            where.ownerId = userId;
        } else if (ownerId) {
            where.ownerId = ownerId;
        }

        if (closeDateFrom || closeDateTo) {
            where.closeDate = {};
            if (closeDateFrom) {
                where.closeDate.gte = new Date(closeDateFrom);
            }
            if (closeDateTo) {
                where.closeDate.lte = new Date(closeDateTo);
            }
        }

        // Get all opportunities grouped by stage
        const opportunities = await prisma.opportunity.findMany({
            where,
            select: {
                stage: true,
                amount: true,
                probability: true,
            },
        });

        // Calculate metrics per stage
        const stageMetrics: Map<OpportunityStage, PipelineStageMetrics> = new Map();

        // Initialize all stages
        for (const stage of VALID_STAGES) {
            if (stage !== OpportunityStage.CLOSED_WON && stage !== OpportunityStage.CLOSED_LOST) {
                stageMetrics.set(stage, {
                    stage,
                    count: 0,
                    totalAmount: 0,
                    weightedAmount: 0,
                });
            }
        }

        // Calculate totals
        let totalCount = 0;
        let totalAmount = 0;
        let weightedAmountTotal = 0;

        for (const opp of opportunities) {
            const amount = opp.amount ? Number(opp.amount) : 0;
            const weighted = amount * (opp.probability / 100);

            const metrics = stageMetrics.get(opp.stage);
            if (metrics) {
                metrics.count++;
                metrics.totalAmount += amount;
                metrics.weightedAmount += weighted;
            }

            totalCount++;
            totalAmount += amount;
            weightedAmountTotal += weighted;
        }

        await logAudit(
            orgId,
            userId,
            AuditAction.READ,
            'Opportunity',
            null,
            undefined,
            AuditOutcome.SUCCESS,
            'Viewed pipeline metrics'
        );

        return {
            totalCount,
            totalAmount,
            weightedAmount: weightedAmountTotal,
            stages: Array.from(stageMetrics.values()),
        };
    },

    /**
     * Get Kanban board view
     */
    async getKanbanBoard(
        orgId: string,
        userId: string,
        userRole: Role,
        filters: { ownerId?: string; closeDateFrom?: string | Date; closeDateTo?: string | Date }
    ): Promise<KanbanBoard> {
        const { ownerId, closeDateFrom, closeDateTo } = filters;

        // Build where clause
        const where: any = {
            orgId,
            // Include all stages for Kanban view including closed
        };

        // Role-based filtering
        if (userRole === Role.REP) {
            where.ownerId = userId;
        } else if (ownerId) {
            where.ownerId = ownerId;
        }

        if (closeDateFrom || closeDateTo) {
            where.closeDate = {};
            if (closeDateFrom) {
                where.closeDate.gte = new Date(closeDateFrom);
            }
            if (closeDateTo) {
                where.closeDate.lte = new Date(closeDateTo);
            }
        }

        // Get all opportunities
        const opportunities = await prisma.opportunity.findMany({
            where,
            include: {
                owner: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
                account: {
                    select: {
                        id: true,
                        name: true,
                        website: true,
                    },
                },
                contact: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
            },
            orderBy: {
                closeDate: 'asc',
            },
        });

        // Group by stage
        const kanbanStages = VALID_STAGES.map(stage => {
            const stageOpps = opportunities.filter((o: typeof opportunities[0]) => o.stage === stage);

            const totals = stageOpps.reduce(
                (acc: { count: number; amount: number; weightedAmount: number }, opp: typeof opportunities[0]) => ({
                    count: acc.count + 1,
                    amount: acc.amount + (opp.amount ? Number(opp.amount) : 0),
                    weightedAmount: acc.weightedAmount + (opp.amount ? Number(opp.amount) * (opp.probability / 100) : 0),
                }),
                { count: 0, amount: 0, weightedAmount: 0 }
            );

            return {
                stage,
                opportunities: stageOpps as OpportunityWithRelations[],
                totals,
            };
        });

        await logAudit(
            orgId,
            userId,
            AuditAction.READ,
            'Opportunity',
            null,
            undefined,
            AuditOutcome.SUCCESS,
            'Viewed kanban board'
        );

        return {
            stages: kanbanStages,
        };
    },

    /**
     * Get opportunity counts with caching
     */
    async getCounts(orgId: string): Promise<{
        total: number;
        byStage: Record<string, number>;
        totalAmount: number;
    }> {
        return cacheService.getCounts(orgId, 'opps', async () => {
            const [total, stageCounts, amountSum] = await Promise.all([
                prisma.opportunity.count({ where: { orgId } }),
                prisma.opportunity.groupBy({
                    by: ['stage'],
                    where: { orgId },
                    _count: { id: true },
                }),
                prisma.opportunity.aggregate({
                    where: { orgId },
                    _sum: { amount: true },
                }),
            ]);

            const byStage = stageCounts.reduce((acc, item) => {
                acc[item.stage] = item._count.id;
                return acc;
            }, {} as Record<string, number>);

            return {
                total,
                byStage,
                totalAmount: amountSum._sum.amount ? Number(amountSum._sum.amount) : 0,
            };
        });
    },

    /**
     * Invalidate opportunity cache for an organization
     */
    async invalidateCache(orgId: string): Promise<void> {
        await cacheService.delete(CACHE_KEYS.oppCounts(orgId));
    },
};
