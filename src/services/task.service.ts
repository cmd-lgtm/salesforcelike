import { prisma } from '../config/database';
import { logger } from '../shared/logger';
import { ValidationError } from '../shared/errors/validation.error';
import { NotFoundError } from '../shared/errors/not-found.error';
import { TaskStatus, TaskPriority, RelatedToType, Role, AuditAction, AuditOutcome } from '@prisma/client';

// ============================================
// TYPES & INTERFACES
// ============================================

export interface CreateTaskDto {
    subject: string;
    description?: string;
    dueDate?: Date;
    status?: TaskStatus;
    priority?: TaskPriority;
    relatedToType: RelatedToType;
    relatedToId: string;
}

export interface UpdateTaskDto {
    subject?: string;
    description?: string;
    dueDate?: Date | null;
    status?: TaskStatus;
    priority?: TaskPriority;
}

export interface TaskFilters {
    status?: TaskStatus;
    priority?: TaskPriority;
    ownerId?: string;
    relatedToType?: RelatedToType;
    relatedToId?: string;
    dueDateFrom?: Date;
    dueDateTo?: Date;
    sortBy?: 'dueDate' | 'createdAt' | 'updatedAt' | 'priority';
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

export interface TaskWithRelations {
    id: string;
    subject: string;
    description: string | null;
    dueDate: Date | null;
    status: TaskStatus;
    priority: TaskPriority;
    completedAt: Date | null;
    relatedToType: RelatedToType;
    relatedToId: string;
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

const VALID_STATUSES = Object.values(TaskStatus);
const VALID_PRIORITIES = Object.values(TaskPriority);
const VALID_RELATED_TO_TYPES = Object.values(RelatedToType);

function validateTaskData(dto: CreateTaskDto | UpdateTaskDto): void {
    const errors: { field: string; message: string; code: string }[] = [];

    if ('subject' in dto && dto.subject !== undefined) {
        if (typeof dto.subject !== 'string' || dto.subject.trim().length === 0) {
            errors.push({ field: 'subject', message: 'Subject is required', code: 'SUBJECT_REQUIRED' });
        } else if (dto.subject.length > 255) {
            errors.push({ field: 'subject', message: 'Subject must be less than 255 characters', code: 'SUBJECT_TOO_LONG' });
        }
    }

    if ('status' in dto && dto.status !== undefined) {
        if (!VALID_STATUSES.includes(dto.status)) {
            errors.push({ field: 'status', message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`, code: 'INVALID_STATUS' });
        }
    }

    if ('priority' in dto && dto.priority !== undefined) {
        if (!VALID_PRIORITIES.includes(dto.priority)) {
            errors.push({ field: 'priority', message: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}`, code: 'INVALID_PRIORITY' });
        }
    }

    if ('dueDate' in dto && dto.dueDate !== undefined) {
        if (dto.dueDate !== null && !(dto.dueDate instanceof Date) && isNaN(Date.parse(dto.dueDate as any))) {
            errors.push({ field: 'dueDate', message: 'Invalid due date', code: 'INVALID_DATE' });
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

    if (errors.length > 0) {
        throw new ValidationError('Task validation failed', errors);
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
// TASK SERVICE
// ============================================

export const taskService = {
    /**
     * Create a new task
     */
    async create(
        orgId: string,
        userId: string,
        dto: CreateTaskDto,
        _userRole: Role
    ): Promise<TaskWithRelations> {
        validateTaskData(dto);

        // Validate relatedTo exists
        const isValidRelatedTo = await validateRelatedTo(orgId, dto.relatedToType, dto.relatedToId);
        if (!isValidRelatedTo) {
            throw new ValidationError('RelatedTo record not found', [
                { field: 'relatedToId', message: 'The specified relatedTo record does not exist', code: 'RELATED_TO_NOT_FOUND' }
            ]);
        }

        const task = await prisma.task.create({
            data: {
                orgId,
                ownerId: userId,
                subject: dto.subject.trim(),
                description: dto.description?.trim() || null,
                dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
                status: dto.status || TaskStatus.NOT_STARTED,
                priority: dto.priority || TaskPriority.MEDIUM,
                relatedToType: dto.relatedToType,
                relatedToId: dto.relatedToId,
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

        await logAudit(orgId, userId, AuditAction.CREATE, 'Task', task.id, { after: dto });

        logger.info(`Task created: ${task.id} by user ${userId}`);

        return task as TaskWithRelations;
    },

    /**
     * Get tasks with filtering, sorting, and pagination
     */
    async findAll(
        orgId: string,
        userId: string,
        _userRole: Role,
        filters: TaskFilters
    ): Promise<PaginatedResponse<TaskWithRelations>> {
        const {
            status,
            priority,
            ownerId,
            relatedToType,
            relatedToId,
            dueDateFrom,
            dueDateTo,
            sortBy = 'dueDate',
            sortOrder = 'asc',
            page = 1,
            limit = 20,
        } = filters;

        // Build where clause
        const where: any = {
            orgId,
        };

        // Role-based filtering
        if (_userRole === Role.REP) {
            // Reps can only see their own tasks
            where.ownerId = userId;
        } else if (ownerId) {
            // Managers/Admins can filter by owner
            where.ownerId = ownerId;
        }

        if (status) {
            where.status = status;
        }

        if (priority) {
            where.priority = priority;
        }

        if (relatedToType) {
            where.relatedToType = relatedToType;
        }

        if (relatedToId) {
            where.relatedToId = relatedToId;
        }

        if (dueDateFrom || dueDateTo) {
            where.dueDate = {};
            if (dueDateFrom) {
                where.dueDate.gte = dueDateFrom;
            }
            if (dueDateTo) {
                where.dueDate.lte = dueDateTo;
            }
        }

        // Calculate pagination
        const skip = (page - 1) * limit;
        const take = Math.min(limit, 100); // Max 100 per page

        // Get total count
        const total = await prisma.task.count({ where });

        // Get tasks
        const tasks = await prisma.task.findMany({
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
            orderBy: [
                // Sort by priority first (HIGH/URGENT first), then by the requested sort field
                { status: 'asc' }, // NOT_STARTED first, then IN_PROGRESS, then COMPLETED
                { priority: 'desc' }, // URGENT first
                { [sortBy]: sortOrder },
            ],
            skip,
            take,
        });

        return {
            data: tasks as TaskWithRelations[],
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    },

    /**
     * Get a single task by ID
     */
    async findById(
        orgId: string,
        taskId: string,
        userId: string,
        _userRole: Role
    ): Promise<TaskWithRelations> {
        const where: any = {
            id: taskId,
            orgId,
        };

        // Role-based filtering
        if (_userRole === Role.REP) {
            where.ownerId = userId;
        }

        const task = await prisma.task.findFirst({
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

        if (!task) {
            throw new NotFoundError('Task not found', 'TASK_NOT_FOUND');
        }

        return task as TaskWithRelations;
    },

    /**
     * Update a task
     */
    async update(
        orgId: string,
        taskId: string,
        userId: string,
        _userRole: Role,
        dto: UpdateTaskDto
    ): Promise<TaskWithRelations> {
        validateTaskData(dto);

        // Get existing task
        const existing = await this.findById(orgId, taskId, userId, _userRole);

        const task = await prisma.task.update({
            where: { id: taskId },
            data: {
                ...(dto.subject !== undefined && { subject: dto.subject.trim() }),
                ...(dto.description !== undefined && { description: dto.description?.trim() || null }),
                ...(dto.dueDate !== undefined && { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }),
                ...(dto.status !== undefined && { status: dto.status }),
                ...(dto.priority !== undefined && { priority: dto.priority }),
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

        await logAudit(orgId, userId, AuditAction.UPDATE, 'Task', task.id, { before: existing, after: dto });

        logger.info(`Task updated: ${task.id} by user ${userId}`);

        return task as TaskWithRelations;
    },

    /**
     * Delete a task
     */
    async delete(
        orgId: string,
        taskId: string,
        userId: string,
        _userRole: Role
    ): Promise<void> {
        // Get existing task
        const existing = await this.findById(orgId, taskId, userId, _userRole);

        await prisma.task.delete({
            where: { id: taskId },
        });

        await logAudit(orgId, userId, AuditAction.DELETE, 'Task', taskId, { before: existing });

        logger.info(`Task deleted: ${taskId} by user ${userId}`);
    },

    /**
     * Mark a task as complete
     */
    async markComplete(
        orgId: string,
        taskId: string,
        userId: string,
        _userRole: Role
    ): Promise<TaskWithRelations> {
        // Get existing task
        const existing = await this.findById(orgId, taskId, userId, _userRole);

        if (existing.status === TaskStatus.COMPLETED) {
            throw new ValidationError('Task already completed', [
                { field: 'status', message: 'This task is already marked as completed', code: 'ALREADY_COMPLETED' }
            ]);
        }

        const task = await prisma.task.update({
            where: { id: taskId },
            data: {
                status: TaskStatus.COMPLETED,
                completedAt: new Date(),
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

        await logAudit(orgId, userId, AuditAction.UPDATE, 'Task', task.id, {
            before: { status: existing.status, completedAt: existing.completedAt },
            after: { status: TaskStatus.COMPLETED, completedAt: task.completedAt }
        });

        logger.info(`Task marked complete: ${task.id} by user ${userId}`);

        return task as TaskWithRelations;
    },

    /**
     * Reopen a task (mark as incomplete)
     */
    async reopen(
        orgId: string,
        taskId: string,
        userId: string,
        _userRole: Role
    ): Promise<TaskWithRelations> {
        // Get existing task
        const existing = await this.findById(orgId, taskId, userId, _userRole);

        if (existing.status !== TaskStatus.COMPLETED) {
            throw new ValidationError('Task is not completed', [
                { field: 'status', message: 'Only completed tasks can be reopened', code: 'NOT_COMPLETED' }
            ]);
        }

        const task = await prisma.task.update({
            where: { id: taskId },
            data: {
                status: TaskStatus.NOT_STARTED,
                completedAt: null,
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

        await logAudit(orgId, userId, AuditAction.UPDATE, 'Task', task.id, {
            before: { status: existing.status, completedAt: existing.completedAt },
            after: { status: TaskStatus.NOT_STARTED, completedAt: null }
        });

        logger.info(`Task reopened: ${task.id} by user ${userId}`);

        return task as TaskWithRelations;
    },

    /**
     * Get tasks for a specific related record
     */
    async getTasksForRelated(
        orgId: string,
        relatedToType: RelatedToType,
        relatedToId: string,
        userId: string,
        _userRole: Role,
        limit: number = 50
    ): Promise<TaskWithRelations[]> {
        const where: any = {
            orgId,
            relatedToType,
            relatedToId,
        };

        // Role-based filtering
        if (_userRole === Role.REP) {
            where.ownerId = userId;
        }

        const tasks = await prisma.task.findMany({
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
            orderBy: [
                { status: 'asc' },
                { priority: 'desc' },
                { dueDate: 'asc' },
            ],
            take: limit,
        });

        return tasks as TaskWithRelations[];
    },

    /**
     * Get overdue tasks
     */
    async getOverdueTasks(
        orgId: string,
        userId: string,
        _userRole: Role
    ): Promise<TaskWithRelations[]> {
        const where: any = {
            orgId,
            status: { not: TaskStatus.COMPLETED },
            dueDate: { lt: new Date() },
        };

        // Role-based filtering
        if (_userRole === Role.REP) {
            where.ownerId = userId;
        }

        const tasks = await prisma.task.findMany({
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
            orderBy: [
                { priority: 'desc' },
                { dueDate: 'asc' },
            ],
        });

        return tasks as TaskWithRelations[];
    },
};
