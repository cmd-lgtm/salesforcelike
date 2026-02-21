import { prisma } from '../config/database';
import { logger } from '../shared/logger';
import { ValidationError } from '../shared/errors/validation.error';
import { NotFoundError } from '../shared/errors/not-found.error';
import { ActivityType, RelatedToType, Role, AuditAction, AuditOutcome } from '@prisma/client';

// ============================================
// TYPES & INTERFACES
// ============================================

export interface CreateActivityDto {
    type: ActivityType;
    subject: string;
    description?: string;
    activityDate: Date;
    relatedToType: RelatedToType;
    relatedToId: string;
    duration?: number;
    location?: string;
    attendees?: string[];
}

export interface UpdateActivityDto {
    type?: ActivityType;
    subject?: string;
    description?: string;
    activityDate?: Date;
    duration?: number;
    location?: string;
    attendees?: string[];
}

export interface ActivityFilters {
    type?: ActivityType;
    ownerId?: string;
    relatedToType?: RelatedToType;
    relatedToId?: string;
    activityDateFrom?: Date;
    activityDateTo?: Date;
    sortBy?: 'activityDate' | 'createdAt' | 'updatedAt';
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

export interface ActivityWithRelations {
    id: string;
    type: ActivityType;
    subject: string;
    description: string | null;
    activityDate: Date;
    relatedToType: RelatedToType;
    relatedToId: string;
    duration: number | null;
    location: string | null;
    attendees: string[];
    ownerId: string;
    orgId: string;
    createdAt: Date;
    updatedAt: Date;
    owner?: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
    };
}

// ============================================
// VALIDATION
// ============================================

const VALID_TYPES = Object.values(ActivityType);
const VALID_RELATED_TO_TYPES = Object.values(RelatedToType);

function validateActivityData(dto: CreateActivityDto | UpdateActivityDto): void {
    const errors: { field: string; message: string; code: string }[] = [];

    if ('type' in dto && dto.type !== undefined) {
        if (!VALID_TYPES.includes(dto.type)) {
            errors.push({ field: 'type', message: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`, code: 'INVALID_TYPE' });
        }
    }

    if ('subject' in dto && dto.subject !== undefined) {
        if (typeof dto.subject !== 'string' || dto.subject.trim().length === 0) {
            errors.push({ field: 'subject', message: 'Subject is required', code: 'SUBJECT_REQUIRED' });
        } else if (dto.subject.length > 255) {
            errors.push({ field: 'subject', message: 'Subject must be less than 255 characters', code: 'SUBJECT_TOO_LONG' });
        }
    }

    if ('activityDate' in dto && dto.activityDate !== undefined) {
        if (!(dto.activityDate instanceof Date) && isNaN(Date.parse(dto.activityDate as any))) {
            errors.push({ field: 'activityDate', message: 'Invalid activity date', code: 'INVALID_DATE' });
        }
    }

    if ('relatedToType' in dto && dto.relatedToType !== undefined) {
        if (!VALID_RELATED_TO_TYPES.includes(dto.relatedToType)) {
            errors.push({ field: 'relatedToType', message: `Invalid relatedToType. Must be one of: ${VALID_RELATED_TO_TYPES.join(', ')}`, code: 'INVALID_RELATED_TO_TYPE' });
        }
    }

    if ('relatedToId' in dto && dto.relatedToId !== undefined) {
        if (typeof dto.relatedToId !== 'string' || dto.relatedToId.trim().length === 0) {
            errors.push({ field: 'relatedToId', message: 'RelatedToId is required', code: 'RELATED_TO_ID_REQUIRED' });
        }
    }

    if ('duration' in dto && dto.duration !== undefined) {
        if (dto.duration !== null && (typeof dto.duration !== 'number' || dto.duration < 0)) {
            errors.push({ field: 'duration', message: 'Duration must be a positive number', code: 'INVALID_DURATION' });
        }
    }

    if ('location' in dto && dto.location !== undefined) {
        if (dto.location !== null && dto.location.length > 255) {
            errors.push({ field: 'location', message: 'Location must be less than 255 characters', code: 'LOCATION_TOO_LONG' });
        }
    }

    if (errors.length > 0) {
        throw new ValidationError('Activity validation failed', errors);
    }
}

// ============================================
// RELATED TO VALIDATION
// ============================================

async function validateRelatedTo(orgId: string, relatedToType: RelatedToType, relatedToId: string): Promise<boolean> {
    switch (relatedToType) {
        case RelatedToType.LEAD:
            const lead = await prisma.lead.findFirst({
                where: { id: relatedToId, orgId },
                select: { id: true },
            });
            return !!lead;
        case RelatedToType.ACCOUNT:
            const account = await prisma.account.findFirst({
                where: { id: relatedToId, orgId },
                select: { id: true },
            });
            return !!account;
        case RelatedToType.CONTACT:
            const contact = await prisma.contact.findFirst({
                where: { id: relatedToId, orgId },
                select: { id: true },
            });
            return !!contact;
        case RelatedToType.OPPORTUNITY:
            const opportunity = await prisma.opportunity.findFirst({
                where: { id: relatedToId, orgId },
                select: { id: true },
            });
            return !!opportunity;
        default:
            return false;
    }
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
// ACTIVITY SERVICE
// ============================================

export const activityService = {
    /**
     * Create a new activity
     */
    async create(
        orgId: string,
        userId: string,
        dto: CreateActivityDto,
        _userRole: Role
    ): Promise<ActivityWithRelations> {
        validateActivityData(dto);

        // Validate relatedTo exists
        const isValidRelatedTo = await validateRelatedTo(orgId, dto.relatedToType, dto.relatedToId);
        if (!isValidRelatedTo) {
            throw new ValidationError('RelatedTo record not found', [
                { field: 'relatedToId', message: 'The specified relatedTo record does not exist', code: 'RELATED_TO_NOT_FOUND' }
            ]);
        }

        const activity = await prisma.activity.create({
            data: {
                orgId,
                ownerId: userId,
                type: dto.type,
                subject: dto.subject.trim(),
                description: dto.description?.trim() || null,
                activityDate: new Date(dto.activityDate),
                relatedToType: dto.relatedToType,
                relatedToId: dto.relatedToId,
                duration: dto.duration || null,
                location: dto.location?.trim() || null,
                attendees: dto.attendees || [],
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
            },
        });

        await logAudit(orgId, userId, AuditAction.CREATE, 'Activity', activity.id, { after: dto });

        logger.info(`Activity created: ${activity.id} by user ${userId}`);

        return activity as ActivityWithRelations;
    },

    /**
     * Get activities with filtering, sorting, and pagination
     */
    async findAll(
        orgId: string,
        userId: string,
        _userRole: Role,
        filters: ActivityFilters
    ): Promise<PaginatedResponse<ActivityWithRelations>> {
        const {
            type,
            ownerId,
            relatedToType,
            relatedToId,
            activityDateFrom,
            activityDateTo,
            sortBy = 'activityDate',
            sortOrder = 'desc',
            page = 1,
            limit = 20,
        } = filters;

        // Build where clause
        const where: any = {
            orgId,
        };

        // Role-based filtering
        if (_userRole === Role.REP) {
            // Reps can only see their own activities
            where.ownerId = userId;
        } else if (ownerId) {
            // Managers/Admins can filter by owner
            where.ownerId = ownerId;
        }

        if (type) {
            where.type = type;
        }

        if (relatedToType) {
            where.relatedToType = relatedToType;
        }

        if (relatedToId) {
            where.relatedToId = relatedToId;
        }

        if (activityDateFrom || activityDateTo) {
            where.activityDate = {};
            if (activityDateFrom) {
                where.activityDate.gte = activityDateFrom;
            }
            if (activityDateTo) {
                where.activityDate.lte = activityDateTo;
            }
        }

        // Calculate pagination
        const skip = (page - 1) * limit;
        const take = Math.min(limit, 100); // Max 100 per page

        // Get total count
        const total = await prisma.activity.count({ where });

        // Get activities
        const activities = await prisma.activity.findMany({
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
            },
            orderBy: {
                [sortBy]: sortOrder,
            },
            skip,
            take,
        });

        return {
            data: activities as ActivityWithRelations[],
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    },

    /**
     * Get a single activity by ID
     */
    async findById(
        orgId: string,
        activityId: string,
        userId: string,
        _userRole: Role
    ): Promise<ActivityWithRelations> {
        const where: any = {
            id: activityId,
            orgId,
        };

        // Role-based filtering
        if (_userRole === Role.REP) {
            where.ownerId = userId;
        }

        const activity = await prisma.activity.findFirst({
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
            },
        });

        if (!activity) {
            throw new NotFoundError('Activity not found', 'ACTIVITY_NOT_FOUND');
        }

        return activity as ActivityWithRelations;
    },

    /**
     * Update an activity
     */
    async update(
        orgId: string,
        activityId: string,
        userId: string,
        _userRole: Role,
        dto: UpdateActivityDto
    ): Promise<ActivityWithRelations> {
        validateActivityData(dto);

        // Get existing activity
        const existing = await this.findById(orgId, activityId, userId, _userRole);

        const activity = await prisma.activity.update({
            where: { id: activityId },
            data: {
                ...(dto.type && { type: dto.type }),
                ...(dto.subject !== undefined && { subject: dto.subject.trim() }),
                ...(dto.description !== undefined && { description: dto.description?.trim() || null }),
                ...(dto.activityDate && { activityDate: new Date(dto.activityDate) }),
                ...(dto.duration !== undefined && { duration: dto.duration }),
                ...(dto.location !== undefined && { location: dto.location?.trim() || null }),
                ...(dto.attendees !== undefined && { attendees: dto.attendees }),
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
            },
        });

        await logAudit(orgId, userId, AuditAction.UPDATE, 'Activity', activity.id, { before: existing, after: dto });

        logger.info(`Activity updated: ${activity.id} by user ${userId}`);

        return activity as ActivityWithRelations;
    },

    /**
     * Delete an activity
     */
    async delete(
        orgId: string,
        activityId: string,
        userId: string,
        _userRole: Role
    ): Promise<void> {
        // Get existing activity
        const existing = await this.findById(orgId, activityId, userId, _userRole);

        await prisma.activity.delete({
            where: { id: activityId },
        });

        await logAudit(orgId, userId, AuditAction.DELETE, 'Activity', activityId, { before: existing });

        logger.info(`Activity deleted: ${activityId} by user ${userId}`);
    },

    /**
     * Get activities for a specific related record (timeline)
     */
    async getTimeline(
        orgId: string,
        relatedToType: RelatedToType,
        relatedToId: string,
        userId: string,
        _userRole: Role,
        limit: number = 50
    ): Promise<ActivityWithRelations[]> {
        const where: any = {
            orgId,
            relatedToType,
            relatedToId,
        };

        // Role-based filtering
        if (_userRole === Role.REP) {
            where.ownerId = userId;
        }

        const activities = await prisma.activity.findMany({
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
            },
            orderBy: {
                activityDate: 'desc',
            },
            take: limit,
        });

        return activities as ActivityWithRelations[];
    },
};
