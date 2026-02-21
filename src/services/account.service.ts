import { prisma } from '../config/database';
import { logger } from '../shared/logger';
import { ValidationError } from '../shared/errors/validation.error';
import { NotFoundError } from '../shared/errors/not-found.error';
import { Industry, Role, AuditAction, AuditOutcome, Prisma } from '@prisma/client';

// ============================================
// TYPES & INTERFACES
// ============================================

export interface CreateAccountDto {
    name: string;
    website?: string;
    industry?: Industry;
    phone?: string;
    annualRevenue?: number;
    employees?: number;
    billingAddress?: {
        street?: string;
        city?: string;
        state?: string;
        country?: string;
        zip?: string;
    };
    shippingAddress?: {
        street?: string;
        city?: string;
        state?: string;
        country?: string;
        zip?: string;
    };
}

export interface UpdateAccountDto {
    name?: string;
    website?: string;
    industry?: Industry;
    phone?: string;
    annualRevenue?: number;
    employees?: number;
    billingAddress?: {
        street?: string;
        city?: string;
        state?: string;
        country?: string;
        zip?: string;
    } | null;
    shippingAddress?: {
        street?: string;
        city?: string;
        state?: string;
        country?: string;
        zip?: string;
    } | null;
}

export interface AccountFilters {
    industry?: Industry;
    ownerId?: string;
    search?: string;
    sortBy?: 'createdAt' | 'updatedAt' | 'name';
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

export interface AccountWithRelations {
    id: string;
    name: string;
    website: string | null;
    industry: Industry;
    annualRevenue: Prisma.Decimal | null;
    employees: number | null;
    billingAddress: {
        street?: string;
        city?: string;
        state?: string;
        country?: string;
        zip?: string;
    } | null;
    shippingAddress: {
        street?: string;
        city?: string;
        state?: string;
        country?: string;
        zip?: string;
    } | null;
    phone: string | null;
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
    _count?: {
        contacts: number;
        opportunities: number;
    };
}

// ============================================
// VALIDATION
// ============================================

const VALID_INDUSTRIES = Object.values(Industry);

function validateAccountData(dto: CreateAccountDto | UpdateAccountDto): void {
    const errors: { field: string; message: string; code: string }[] = [];

    if ('name' in dto && dto.name !== undefined) {
        if (typeof dto.name !== 'string' || dto.name.trim().length === 0) {
            errors.push({ field: 'name', message: 'Account name is required', code: 'NAME_REQUIRED' });
        } else if (dto.name.length > 255) {
            errors.push({ field: 'name', message: 'Account name must be less than 255 characters', code: 'NAME_TOO_LONG' });
        }
    }

    if ('website' in dto && dto.website !== undefined) {
        if (dto.website !== null && dto.website !== '') {
            const urlPattern = /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/;
            if (!urlPattern.test(dto.website)) {
                errors.push({ field: 'website', message: 'Invalid URL format', code: 'INVALID_WEBSITE' });
            }
        }
    }

    if ('industry' in dto && dto.industry !== undefined) {
        if (dto.industry !== null && !VALID_INDUSTRIES.includes(dto.industry)) {
            errors.push({ field: 'industry', message: `Invalid industry. Must be one of: ${VALID_INDUSTRIES.join(', ')}`, code: 'INVALID_INDUSTRY' });
        }
    }

    if ('phone' in dto && dto.phone !== undefined) {
        if (dto.phone !== null && dto.phone !== '') {
            if (dto.phone.length > 50) {
                errors.push({ field: 'phone', message: 'Phone must be less than 50 characters', code: 'PHONE_TOO_LONG' });
            }
        }
    }

    if ('annualRevenue' in dto && dto.annualRevenue !== undefined) {
        if (dto.annualRevenue !== null && (isNaN(dto.annualRevenue) || dto.annualRevenue < 0)) {
            errors.push({ field: 'annualRevenue', message: 'Annual revenue must be a positive number', code: 'INVALID_REVENUE' });
        }
    }

    if ('employees' in dto && dto.employees !== undefined) {
        if (dto.employees !== null && (isNaN(dto.employees) || dto.employees < 0)) {
            errors.push({ field: 'employees', message: 'Employees must be a positive number', code: 'INVALID_EMPLOYEES' });
        }
    }

    if (errors.length > 0) {
        throw new ValidationError('Account validation failed', errors);
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
// ACCOUNT SERVICE
// ============================================

export const accountService = {
    /**
     * Create a new account
     */
    async create(
        orgId: string,
        userId: string,
        dto: CreateAccountDto,
        _userRole: Role
    ): Promise<AccountWithRelations> {
        validateAccountData(dto);

        const account = await prisma.account.create({
            data: {
                orgId,
                ownerId: userId,
                name: dto.name.trim(),
                website: dto.website?.trim() || null,
                industry: dto.industry || Industry.OTHER,
                phone: dto.phone?.trim() || null,
                annualRevenue: dto.annualRevenue ? new Prisma.Decimal(dto.annualRevenue) : null,
                employees: dto.employees || null,
                billingAddress: dto.billingAddress ?? Prisma.JsonNull,
                shippingAddress: dto.shippingAddress ?? Prisma.JsonNull,
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

        await logAudit(orgId, userId, AuditAction.CREATE, 'Account', account.id, { after: dto });

        logger.info(`Account created: ${account.id} by user ${userId}`);

        return account as AccountWithRelations;
    },

    /**
     * Get accounts with filtering, sorting, and pagination
     */
    async findAll(
        orgId: string,
        userId: string,
        _userRole: Role,
        filters: AccountFilters
    ): Promise<PaginatedResponse<AccountWithRelations>> {
        const {
            industry,
            ownerId,
            search,
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
        if (_userRole === Role.REP) {
            // Reps can only see their own accounts
            where.ownerId = userId;
        } else if (ownerId) {
            // Managers/Admins can filter by owner
            where.ownerId = ownerId;
        }

        if (industry) {
            where.industry = industry;
        }

        if (search) {
            const searchLower = search.toLowerCase();
            where.OR = [
                { name: { contains: searchLower, mode: 'insensitive' } },
                { website: { contains: searchLower, mode: 'insensitive' } },
            ];
        }

        // Calculate pagination
        const skip = (page - 1) * limit;
        const take = Math.min(limit, 100); // Max 100 per page

        // Get total count
        const total = await prisma.account.count({ where });

        // Get accounts
        const accounts = await prisma.account.findMany({
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
                _count: {
                    select: {
                        contacts: true,
                        opportunities: true,
                    },
                },
            },
            orderBy: {
                [sortBy]: sortOrder,
            },
            skip,
            take,
        });

        await logAudit(orgId, userId, AuditAction.READ, 'Account', null, undefined, AuditOutcome.SUCCESS, `Listed ${accounts.length} accounts`);

        return {
            data: accounts as AccountWithRelations[],
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    },

    /**
     * Get a single account by ID
     */
    async findById(
        orgId: string,
        userId: string,
        userRole: Role,
        accountId: string
    ): Promise<AccountWithRelations> {
        const account = await prisma.account.findFirst({
            where: {
                id: accountId,
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
                _count: {
                    select: {
                        contacts: true,
                        opportunities: true,
                    },
                },
            },
        });

        if (!account) {
            throw new NotFoundError('Account not found');
        }

        // Check ownership for reps
        if (userRole === Role.REP && account.ownerId !== userId) {
            throw new NotFoundError('Account not found'); // Don't reveal existence
        }

        await logAudit(orgId, userId, AuditAction.READ, 'Account', accountId);

        return account as AccountWithRelations;
    },

    /**
     * Update an account
     */
    async update(
        orgId: string,
        userId: string,
        userRole: Role,
        accountId: string,
        dto: UpdateAccountDto
    ): Promise<AccountWithRelations> {
        validateAccountData(dto);

        // Get existing account
        const existingAccount = await prisma.account.findFirst({
            where: {
                id: accountId,
                orgId,
            },
        });

        if (!existingAccount) {
            throw new NotFoundError('Account not found');
        }

        // Check ownership for reps
        if (userRole === Role.REP && existingAccount.ownerId !== userId) {
            throw new NotFoundError('Account not found');
        }

        const updatedAccount = await prisma.account.update({
            where: { id: accountId },
            data: {
                ...(dto.name && { name: dto.name.trim() }),
                ...(dto.website !== undefined && { website: dto.website?.trim() || null }),
                ...(dto.industry && { industry: dto.industry }),
                ...(dto.phone !== undefined && { phone: dto.phone?.trim() || null }),
                ...(dto.annualRevenue !== undefined && { annualRevenue: dto.annualRevenue ? new Prisma.Decimal(dto.annualRevenue) : null }),
                ...(dto.employees !== undefined && { employees: dto.employees }),
                ...(dto.billingAddress !== undefined && { billingAddress: dto.billingAddress ?? Prisma.JsonNull }),
                ...(dto.shippingAddress !== undefined && { shippingAddress: dto.shippingAddress ?? Prisma.JsonNull }),
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
                _count: {
                    select: {
                        contacts: true,
                        opportunities: true,
                    },
                },
            },
        });

        await logAudit(orgId, userId, AuditAction.UPDATE, 'Account', accountId, {
            before: existingAccount,
            after: dto,
        });

        logger.info(`Account updated: ${accountId} by user ${userId}`);

        return updatedAccount as AccountWithRelations;
    },

    /**
     * Delete an account
     */
    async delete(
        orgId: string,
        userId: string,
        userRole: Role,
        accountId: string
    ): Promise<void> {
        // Get existing account
        const existingAccount = await prisma.account.findFirst({
            where: {
                id: accountId,
                orgId,
            },
            include: {
                _count: {
                    select: {
                        contacts: true,
                        opportunities: true,
                    },
                },
            },
        });

        if (!existingAccount) {
            throw new NotFoundError('Account not found');
        }

        // Check ownership for reps
        if (userRole === Role.REP && existingAccount.ownerId !== userId) {
            throw new NotFoundError('Account not found');
        }

        // Check for related contacts and opportunities
        if (existingAccount._count.contacts > 0 || existingAccount._count.opportunities > 0) {
            throw new ValidationError('Cannot delete account with related contacts or opportunities', [
                {
                    field: 'account',
                    message: `This account has ${existingAccount._count.contacts} contact(s) and ${existingAccount._count.opportunities} opportunity(ies). Please remove them first.`,
                    code: 'ACCOUNT_HAS_RELATIONS'
                },
            ]);
        }

        await prisma.account.delete({
            where: { id: accountId },
        });

        await logAudit(orgId, userId, AuditAction.DELETE, 'Account', accountId, {
            before: existingAccount,
        });

        logger.info(`Account deleted: ${accountId} by user ${userId}`);
    },

    /**
     * Search accounts (free-text search)
     */
    async search(
        orgId: string,
        userId: string,
        userRole: Role,
        query: string,
        limit: number = 20
    ): Promise<AccountWithRelations[]> {
        const where: any = {
            orgId,
            OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { website: { contains: query, mode: 'insensitive' } },
            ],
        };

        // Role-based filtering
        if (userRole === Role.REP) {
            where.ownerId = userId;
        }

        const accounts = await prisma.account.findMany({
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
            take: Math.min(limit, 100),
            orderBy: {
                name: 'asc',
            },
        });

        await logAudit(orgId, userId, AuditAction.READ, 'Account', null, undefined, AuditOutcome.SUCCESS, `Searched accounts: ${query}`);

        return accounts as AccountWithRelations[];
    },

    /**
     * Get contacts for an account
     */
    async getContacts(
        orgId: string,
        userId: string,
        userRole: Role,
        accountId: string
    ): Promise<any[]> {
        // Verify account exists and user has access
        const account = await prisma.account.findFirst({
            where: {
                id: accountId,
                orgId,
            },
        });

        if (!account) {
            throw new NotFoundError('Account not found');
        }

        // Check ownership for reps
        if (userRole === Role.REP && account.ownerId !== userId) {
            throw new NotFoundError('Account not found');
        }

        const contacts = await prisma.contact.findMany({
            where: {
                accountId,
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
            },
            orderBy: {
                lastName: 'asc',
            },
        });

        await logAudit(orgId, userId, AuditAction.READ, 'Contact', null, undefined, AuditOutcome.SUCCESS, `Listed ${contacts.length} contacts for account ${accountId}`);

        return contacts;
    },

    /**
     * Get opportunities for an account
     */
    async getOpportunities(
        orgId: string,
        userId: string,
        userRole: Role,
        accountId: string
    ): Promise<any[]> {
        // Verify account exists and user has access
        const account = await prisma.account.findFirst({
            where: {
                id: accountId,
                orgId,
            },
        });

        if (!account) {
            throw new NotFoundError('Account not found');
        }

        // Check ownership for reps
        if (userRole === Role.REP && account.ownerId !== userId) {
            throw new NotFoundError('Account not found');
        }

        const opportunities = await prisma.opportunity.findMany({
            where: {
                accountId,
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
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        await logAudit(orgId, userId, AuditAction.READ, 'Opportunity', null, undefined, AuditOutcome.SUCCESS, `Listed ${opportunities.length} opportunities for account ${accountId}`);

        return opportunities;
    },
};
