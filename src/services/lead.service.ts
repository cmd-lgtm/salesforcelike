import { prisma } from '../config/database';
import { logger } from '../shared/logger';
import { ValidationError } from '../shared/errors/validation.error';
import { NotFoundError } from '../shared/errors/not-found.error';
import { LeadStatus, LeadSource, Role, AuditAction, AuditOutcome, Prisma } from '@prisma/client';
import { cacheService, CACHE_KEYS } from '../shared/cache';

// ============================================
// TYPES & INTERFACES
// ============================================

export interface CreateLeadDto {
    firstName: string;
    lastName: string;
    company: string;
    email?: string;
    phone?: string;
    status?: LeadStatus;
    source?: LeadSource;
    notes?: string;
}

export interface UpdateLeadDto {
    firstName?: string;
    lastName?: string;
    company?: string;
    email?: string;
    phone?: string;
    status?: LeadStatus;
    source?: LeadSource;
    notes?: string;
}

export interface LeadFilters {
    status?: LeadStatus;
    source?: LeadSource;
    ownerId?: string;
    createdAtFrom?: Date;
    createdAtTo?: Date;
    search?: string;
    sortBy?: 'createdAt' | 'updatedAt' | 'firstName';
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

export interface LeadWithRelations {
    id: string;
    firstName: string;
    lastName: string;
    company: string;
    email: string | null;
    phone: string | null;
    status: LeadStatus;
    source: LeadSource;
    converted: boolean;
    convertedToAccountId: string | null;
    convertedToContactId: string | null;
    convertedToOpportunityId: string | null;
    convertedAt: Date | null;
    notes: string | null;
    ownerId: string | null;
    orgId: string;
    createdAt: Date;
    updatedAt: Date;
    owner?: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
    } | null;
    duplicateWarning?: DuplicateCheckResult | null;
}

export interface LeadConversionResult {
    lead: LeadWithRelations;
    account: {
        id: string;
        name: string;
    };
    contact: {
        id: string;
        firstName: string;
        lastName: string;
        email: string | null;
    };
    opportunity?: {
        id: string;
        name: string;
    } | null;
}

export interface DuplicateCheckResult {
    hasDuplicate: boolean;
    duplicates: {
        id: string;
        firstName: string;
        lastName: string;
        email: string | null;
        company: string;
    }[];
}

// ============================================
// VALIDATION
// ============================================

const VALID_STATUSES = Object.values(LeadStatus);
const VALID_SOURCES = Object.values(LeadSource);

function validateLeadData(dto: CreateLeadDto | UpdateLeadDto): void {
    const errors: { field: string; message: string; code: string }[] = [];

    if ('firstName' in dto && dto.firstName !== undefined) {
        if (typeof dto.firstName !== 'string' || dto.firstName.trim().length === 0) {
            errors.push({ field: 'firstName', message: 'First name is required', code: 'FIRST_NAME_REQUIRED' });
        } else if (dto.firstName.length > 100) {
            errors.push({ field: 'firstName', message: 'First name must be less than 100 characters', code: 'FIRST_NAME_TOO_LONG' });
        }
    }

    if ('lastName' in dto && dto.lastName !== undefined) {
        if (typeof dto.lastName !== 'string' || dto.lastName.trim().length === 0) {
            errors.push({ field: 'lastName', message: 'Last name is required', code: 'LAST_NAME_REQUIRED' });
        } else if (dto.lastName.length > 100) {
            errors.push({ field: 'lastName', message: 'Last name must be less than 100 characters', code: 'LAST_NAME_TOO_LONG' });
        }
    }

    if ('company' in dto && dto.company !== undefined) {
        if (typeof dto.company !== 'string' || dto.company.trim().length === 0) {
            errors.push({ field: 'company', message: 'Company is required', code: 'COMPANY_REQUIRED' });
        } else if (dto.company.length > 255) {
            errors.push({ field: 'company', message: 'Company must be less than 255 characters', code: 'COMPANY_TOO_LONG' });
        }
    }

    if ('email' in dto && dto.email !== undefined) {
        if (dto.email !== null && dto.email !== '') {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(dto.email)) {
                errors.push({ field: 'email', message: 'Invalid email format', code: 'INVALID_EMAIL' });
            }
        }
    }

    if ('phone' in dto && dto.phone !== undefined) {
        if (dto.phone !== null && dto.phone !== '') {
            if (dto.phone.length > 50) {
                errors.push({ field: 'phone', message: 'Phone must be less than 50 characters', code: 'PHONE_TOO_LONG' });
            }
        }
    }

    if ('status' in dto && dto.status !== undefined) {
        if (!VALID_STATUSES.includes(dto.status)) {
            errors.push({ field: 'status', message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`, code: 'INVALID_STATUS' });
        }
    }

    if ('source' in dto && dto.source !== undefined) {
        if (!VALID_SOURCES.includes(dto.source)) {
            errors.push({ field: 'source', message: `Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}`, code: 'INVALID_SOURCE' });
        }
    }

    if (errors.length > 0) {
        throw new ValidationError('Lead validation failed', errors);
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
// LEAD SERVICE
// ============================================

export const leadService = {
    /**
     * Create a new lead
     */
    async create(
        orgId: string,
        userId: string,
        dto: CreateLeadDto,
        _userRole: Role
    ): Promise<LeadWithRelations> {
        validateLeadData(dto);

        // Check for duplicates if email is provided
        const duplicateCheck = await this.checkDuplicates(orgId, dto.email || null);
        const duplicateWarning = duplicateCheck.hasDuplicate ? duplicateCheck : null;

        const lead = await prisma.lead.create({
            data: {
                orgId,
                ownerId: userId,
                firstName: dto.firstName.trim(),
                lastName: dto.lastName.trim(),
                company: dto.company.trim(),
                email: dto.email?.trim().toLowerCase() || null,
                phone: dto.phone?.trim() || null,
                status: dto.status || LeadStatus.NEW,
                source: dto.source || LeadSource.WEBSITE,
                notes: dto.notes || null,
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

        await logAudit(orgId, userId, AuditAction.CREATE, 'Lead', lead.id, { after: dto });

        logger.info(`Lead created: ${lead.id} by user ${userId}`);

        return {
            ...lead,
            duplicateWarning,
        };
    },

    /**
     * Get leads with filtering, sorting, and pagination
     */
    async findAll(
        orgId: string,
        userId: string,
        _userRole: Role,
        filters: LeadFilters
    ): Promise<PaginatedResponse<LeadWithRelations>> {
        const {
            status,
            source,
            ownerId,
            createdAtFrom,
            createdAtTo,
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
            // Reps can only see their own leads unless they have org-wide read
            where.ownerId = userId;
        } else if (ownerId) {
            // Managers/Admins can filter by owner
            where.ownerId = ownerId;
        }

        if (status) {
            where.status = status;
        }

        if (source) {
            where.source = source;
        }

        if (createdAtFrom || createdAtTo) {
            where.createdAt = {};
            if (createdAtFrom) {
                where.createdAt.gte = createdAtFrom;
            }
            if (createdAtTo) {
                where.createdAt.lte = createdAtTo;
            }
        }

        if (search) {
            const searchLower = search.toLowerCase();
            where.OR = [
                { firstName: { contains: searchLower, mode: 'insensitive' } },
                { lastName: { contains: searchLower, mode: 'insensitive' } },
                { company: { contains: searchLower, mode: 'insensitive' } },
                { email: { contains: searchLower, mode: 'insensitive' } },
            ];
        }

        // Calculate pagination
        const skip = (page - 1) * limit;
        const take = Math.min(limit, 100); // Max 100 per page

        // Get total count
        const total = await prisma.lead.count({ where });

        // Get leads
        const leads = await prisma.lead.findMany({
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

        await logAudit(orgId, userId, AuditAction.READ, 'Lead', null, undefined, AuditOutcome.SUCCESS, `Listed ${leads.length} leads`);

        return {
            data: leads,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    },

    /**
     * Get a single lead by ID
     */
    async findById(
        orgId: string,
        userId: string,
        userRole: Role,
        leadId: string
    ): Promise<LeadWithRelations> {
        const lead = await prisma.lead.findFirst({
            where: {
                id: leadId,
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
        });

        if (!lead) {
            throw new NotFoundError('Lead not found');
        }

        // Check ownership for reps
        if (userRole === Role.REP && lead.ownerId !== userId) {
            throw new NotFoundError('Lead not found'); // Don't reveal existence
        }

        await logAudit(orgId, userId, AuditAction.READ, 'Lead', leadId);

        return lead;
    },

    /**
     * Update a lead
     */
    async update(
        orgId: string,
        userId: string,
        userRole: Role,
        leadId: string,
        dto: UpdateLeadDto
    ): Promise<LeadWithRelations> {
        validateLeadData(dto);

        // Get existing lead
        const existingLead = await prisma.lead.findFirst({
            where: {
                id: leadId,
                orgId,
            },
        });

        if (!existingLead) {
            throw new NotFoundError('Lead not found');
        }

        // Check if lead is converted
        if (existingLead.converted) {
            throw new ValidationError('Cannot update a converted lead', [
                { field: 'lead', message: 'Lead has been converted and cannot be edited', code: 'LEAD_ALREADY_CONVERTED' },
            ]);
        }

        // Check ownership for reps
        if (userRole === Role.REP && existingLead.ownerId !== userId) {
            throw new NotFoundError('Lead not found');
        }

        // Check for duplicate email if email is being changed
        if (dto.email && dto.email !== existingLead.email) {
            const duplicateCheck = await this.checkDuplicates(orgId, dto.email);
            if (duplicateCheck.hasDuplicate) {
                throw new ValidationError('Duplicate email found', [
                    { field: 'email', message: 'A lead with this email already exists', code: 'DUPLICATE_EMAIL' },
                ]);
            }
        }

        const updatedLead = await prisma.lead.update({
            where: { id: leadId },
            data: {
                ...(dto.firstName && { firstName: dto.firstName.trim() }),
                ...(dto.lastName && { lastName: dto.lastName.trim() }),
                ...(dto.company && { company: dto.company.trim() }),
                ...(dto.email !== undefined && { email: dto.email?.trim().toLowerCase() || null }),
                ...(dto.phone !== undefined && { phone: dto.phone?.trim() || null }),
                ...(dto.status && { status: dto.status }),
                ...(dto.source && { source: dto.source }),
                ...(dto.notes !== undefined && { notes: dto.notes || null }),
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

        await logAudit(orgId, userId, AuditAction.UPDATE, 'Lead', leadId, {
            before: existingLead,
            after: dto,
        });

        logger.info(`Lead updated: ${leadId} by user ${userId}`);

        return updatedLead;
    },

    /**
     * Delete a lead (soft delete)
     */
    async delete(
        orgId: string,
        userId: string,
        userRole: Role,
        leadId: string
    ): Promise<void> {
        const existingLead = await prisma.lead.findFirst({
            where: {
                id: leadId,
                orgId,
            },
        });

        if (!existingLead) {
            throw new NotFoundError('Lead not found');
        }

        // Check ownership for reps
        if (userRole === Role.REP && existingLead.ownerId !== userId) {
            throw new NotFoundError('Lead not found');
        }

        // Soft delete by marking as unqualified (common CRM practice)
        // Or we can actually delete - let's do actual delete for this implementation
        await prisma.lead.delete({
            where: { id: leadId },
        });

        await logAudit(orgId, userId, AuditAction.DELETE, 'Lead', leadId, {
            before: existingLead,
        });

        logger.info(`Lead deleted: ${leadId} by user ${userId}`);
    },

    /**
     * Convert a lead to Account, Contact, and optionally Opportunity
     */
    async convert(
        orgId: string,
        userId: string,
        leadId: string,
        options: {
            createOpportunity?: boolean;
            opportunityName?: string;
            opportunityAmount?: number;
            opportunityStage?: string;
            opportunityCloseDate?: Date;
        } = {}
    ): Promise<LeadConversionResult> {
        // Get the lead
        const lead = await prisma.lead.findFirst({
            where: {
                id: leadId,
                orgId,
            },
        });

        if (!lead) {
            throw new NotFoundError('Lead not found');
        }

        if (lead.converted) {
            throw new ValidationError('Lead already converted', [
                { field: 'lead', message: 'This lead has already been converted', code: 'LEAD_ALREADY_CONVERTED' },
            ]);
        }

        if (!lead.company) {
            throw new ValidationError('Lead must have a company to convert', [
                { field: 'company', message: 'Company is required for conversion', code: 'COMPANY_REQUIRED_FOR_CONVERSION' },
            ]);
        }

        // Check ownership for reps
        if (lead.ownerId && lead.ownerId !== userId) {
            throw new NotFoundError('Lead not found');
        }

        // Start a transaction to create all records
        const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // 1. Create Account from lead's company
            const account = await tx.account.create({
                data: {
                    orgId,
                    ownerId: userId,
                    name: lead.company,
                    phone: lead.phone || undefined,
                },
                select: {
                    id: true,
                    name: true,
                },
            });

            // 2. Create Contact from lead's name and email
            const contact = await tx.contact.create({
                data: {
                    orgId,
                    ownerId: userId,
                    accountId: account.id,
                    firstName: lead.firstName,
                    lastName: lead.lastName,
                    email: lead.email || undefined,
                    phone: lead.phone || undefined,
                },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                },
            });

            // 3. Optionally create Opportunity
            let opportunity: { id: string; name: string } | null = null;

            if (options.createOpportunity && options.opportunityName) {
                opportunity = await tx.opportunity.create({
                    data: {
                        orgId,
                        ownerId: userId,
                        accountId: account.id,
                        contactId: contact.id,
                        name: options.opportunityName,
                        stage: (options.opportunityStage as any) || 'PROSPECTING',
                        amount: options.opportunityAmount ? Number(options.opportunityAmount) as any : undefined,
                        closeDate: options.opportunityCloseDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Default 30 days
                    },
                    select: {
                        id: true,
                        name: true,
                    },
                });
            }

            // 4. Update lead as converted
            const updatedLead = await tx.lead.update({
                where: { id: leadId },
                data: {
                    converted: true,
                    status: LeadStatus.CONVERTED,
                    convertedAt: new Date(),
                    convertedToAccountId: account.id,
                    convertedToContactId: contact.id,
                    convertedToOpportunityId: opportunity?.id || null,
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

            // 5. Log the conversion
            await tx.auditLog.create({
                data: {
                    orgId,
                    userId,
                    action: AuditAction.CONVERT,
                    objectType: 'Lead',
                    objectId: leadId,
                    changes: {
                        lead: { firstName: lead.firstName, lastName: lead.lastName, company: lead.company },
                        account: { id: account.id, name: account.name },
                        contact: { id: contact.id, email: contact.email },
                        opportunity: opportunity ? { id: opportunity.id, name: opportunity.name } : null,
                    },
                    outcome: AuditOutcome.SUCCESS,
                },
            });

            logger.info(`Lead converted: ${leadId} to Account ${account.id}, Contact ${contact.id}, Opportunity ${opportunity?.id || 'none'}`);

            return {
                lead: updatedLead,
                account,
                contact,
                opportunity,
            };
        });

        return result;
    },

    /**
     * Check for duplicate leads by email within org
     */
    async checkDuplicates(
        orgId: string,
        email: string | null
    ): Promise<DuplicateCheckResult> {
        if (!email) {
            return { hasDuplicate: false, duplicates: [] };
        }

        const duplicates = await prisma.lead.findMany({
            where: {
                orgId,
                email: email.toLowerCase(),
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                company: true,
            },
            take: 5, // Limit to 5 duplicates
        });

        return {
            hasDuplicate: duplicates.length > 0,
            duplicates,
        };
    },

    /**
     * Search leads (free-text search)
     */
    async search(
        orgId: string,
        userId: string,
        userRole: Role,
        query: string,
        limit: number = 20
    ): Promise<LeadWithRelations[]> {
        const searchLower = query.toLowerCase();

        const where: any = {
            orgId,
            OR: [
                { firstName: { contains: searchLower, mode: 'insensitive' } },
                { lastName: { contains: searchLower, mode: 'insensitive' } },
                { company: { contains: searchLower, mode: 'insensitive' } },
                { email: { contains: searchLower, mode: 'insensitive' } },
            ],
        };

        // Role-based filtering
        if (userRole === Role.REP) {
            where.ownerId = userId;
        }

        const leads = await prisma.lead.findMany({
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
                createdAt: 'desc',
            },
        });

        return leads;
    },

    /**
     * Get lead counts by status (cached)
     */
    async getCountsByStatus(orgId: string): Promise<Record<string, number>> {
        return cacheService.getCounts(orgId, 'leads', async () => {
            const counts = await prisma.lead.groupBy({
                by: ['status'],
                where: { orgId },
                _count: { id: true },
            });

            const result: Record<string, number> = {};
            for (const item of counts) {
                result[item.status] = item._count.id;
            }
            return result;
        });
    },

    /**
     * Invalidate lead cache for an organization
     */
    async invalidateCache(orgId: string): Promise<void> {
        await cacheService.delete(CACHE_KEYS.leadCounts(orgId));
    },
};

export default leadService;
