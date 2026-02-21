import { prisma } from '../config/database';
import { logger } from '../shared/logger';
import { ValidationError } from '../shared/errors/validation.error';
import { NotFoundError } from '../shared/errors/not-found.error';
import { Role, AuditAction, AuditOutcome } from '@prisma/client';

// ============================================
// TYPES & INTERFACES
// ============================================

export interface CreateContactDto {
    firstName: string;
    lastName: string;
    title?: string;
    email?: string;
    phone?: string;
    department?: string;
    accountId?: string;
}

export interface UpdateContactDto {
    firstName?: string;
    lastName?: string;
    title?: string;
    email?: string;
    phone?: string;
    department?: string;
    accountId?: string | null; // null to unlink from account
}

export interface ContactFilters {
    accountId?: string;
    ownerId?: string;
    search?: string;
    sortBy?: 'createdAt' | 'updatedAt' | 'lastName' | 'firstName';
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

export interface ContactWithRelations {
    id: string;
    firstName: string;
    lastName: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    department: string | null;
    accountId: string | null;
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
    account?: {
        id: string;
        name: string;
        website: string | null;
    } | null;
}

// ============================================
// VALIDATION
// ============================================

function validateContactData(dto: CreateContactDto | UpdateContactDto): void {
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

    if ('title' in dto && dto.title !== undefined) {
        if (dto.title !== null && dto.title.length > 100) {
            errors.push({ field: 'title', message: 'Title must be less than 100 characters', code: 'TITLE_TOO_LONG' });
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

    if ('department' in dto && dto.department !== undefined) {
        if (dto.department !== null && dto.department.length > 100) {
            errors.push({ field: 'department', message: 'Department must be less than 100 characters', code: 'DEPARTMENT_TOO_LONG' });
        }
    }

    if (errors.length > 0) {
        throw new ValidationError('Contact validation failed', errors);
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
// CONTACT SERVICE
// ============================================

export const contactService = {
    /**
     * Create a new contact
     */
    async create(
        orgId: string,
        userId: string,
        dto: CreateContactDto,
        _userRole: Role
    ): Promise<ContactWithRelations> {
        validateContactData(dto);

        // Verify account exists if provided
        if (dto.accountId) {
            const account = await prisma.account.findFirst({
                where: {
                    id: dto.accountId,
                    orgId,
                },
            });

            if (!account) {
                throw new ValidationError('Account not found', [
                    { field: 'accountId', message: 'The specified account does not exist', code: 'INVALID_ACCOUNT' },
                ]);
            }
        }

        const contact = await prisma.contact.create({
            data: {
                orgId,
                ownerId: userId,
                firstName: dto.firstName.trim(),
                lastName: dto.lastName.trim(),
                title: dto.title?.trim() || null,
                email: dto.email?.trim().toLowerCase() || null,
                phone: dto.phone?.trim() || null,
                department: dto.department?.trim() || null,
                accountId: dto.accountId || null,
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
            },
        });

        await logAudit(orgId, userId, AuditAction.CREATE, 'Contact', contact.id, { after: dto });

        logger.info(`Contact created: ${contact.id} by user ${userId}`);

        return contact as ContactWithRelations;
    },

    /**
     * Get contacts with filtering, sorting, and pagination
     */
    async findAll(
        orgId: string,
        userId: string,
        _userRole: Role,
        filters: ContactFilters
    ): Promise<PaginatedResponse<ContactWithRelations>> {
        const {
            accountId,
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
            // Reps can only see their own contacts
            where.ownerId = userId;
        } else if (ownerId) {
            // Managers/Admins can filter by owner
            where.ownerId = ownerId;
        }

        if (accountId) {
            where.accountId = accountId;
        }

        if (search) {
            const searchLower = search.toLowerCase();
            where.OR = [
                { firstName: { contains: searchLower, mode: 'insensitive' } },
                { lastName: { contains: searchLower, mode: 'insensitive' } },
                { email: { contains: searchLower, mode: 'insensitive' } },
                { company: { contains: searchLower, mode: 'insensitive' } },
            ];
        }

        // Calculate pagination
        const skip = (page - 1) * limit;
        const take = Math.min(limit, 100); // Max 100 per page

        // Get total count
        const total = await prisma.contact.count({ where });

        // Get contacts
        const contacts = await prisma.contact.findMany({
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
            },
            orderBy: {
                [sortBy]: sortOrder,
            },
            skip,
            take,
        });

        await logAudit(orgId, userId, AuditAction.READ, 'Contact', null, undefined, AuditOutcome.SUCCESS, `Listed ${contacts.length} contacts`);

        return {
            data: contacts as ContactWithRelations[],
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    },

    /**
     * Get a single contact by ID
     */
    async findById(
        orgId: string,
        userId: string,
        userRole: Role,
        contactId: string
    ): Promise<ContactWithRelations> {
        const contact = await prisma.contact.findFirst({
            where: {
                id: contactId,
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
            },
        });

        if (!contact) {
            throw new NotFoundError('Contact not found');
        }

        // Check ownership for reps
        if (userRole === Role.REP && contact.ownerId !== userId) {
            throw new NotFoundError('Contact not found'); // Don't reveal existence
        }

        await logAudit(orgId, userId, AuditAction.READ, 'Contact', contactId);

        return contact as ContactWithRelations;
    },

    /**
     * Update a contact
     */
    async update(
        orgId: string,
        userId: string,
        userRole: Role,
        contactId: string,
        dto: UpdateContactDto
    ): Promise<ContactWithRelations> {
        validateContactData(dto);

        // Get existing contact
        const existingContact = await prisma.contact.findFirst({
            where: {
                id: contactId,
                orgId,
            },
        });

        if (!existingContact) {
            throw new NotFoundError('Contact not found');
        }

        // Check ownership for reps
        if (userRole === Role.REP && existingContact.ownerId !== userId) {
            throw new NotFoundError('Contact not found');
        }

        // Verify account exists if provided (and not null)
        if (dto.accountId) {
            const account = await prisma.account.findFirst({
                where: {
                    id: dto.accountId,
                    orgId,
                },
            });

            if (!account) {
                throw new ValidationError('Account not found', [
                    { field: 'accountId', message: 'The specified account does not exist', code: 'INVALID_ACCOUNT' },
                ]);
            }
        }

        // Check for duplicate email if email is being changed
        if (dto.email && dto.email !== existingContact.email) {
            const existingWithEmail = await prisma.contact.findFirst({
                where: {
                    orgId,
                    email: dto.email.toLowerCase(),
                    id: { not: contactId },
                },
            });

            if (existingWithEmail) {
                throw new ValidationError('Duplicate email found', [
                    { field: 'email', message: 'A contact with this email already exists', code: 'DUPLICATE_EMAIL' },
                ]);
            }
        }

        const updatedContact = await prisma.contact.update({
            where: { id: contactId },
            data: {
                ...(dto.firstName && { firstName: dto.firstName.trim() }),
                ...(dto.lastName && { lastName: dto.lastName.trim() }),
                ...(dto.title !== undefined && { title: dto.title?.trim() || null }),
                ...(dto.email !== undefined && { email: dto.email?.trim().toLowerCase() || null }),
                ...(dto.phone !== undefined && { phone: dto.phone?.trim() || null }),
                ...(dto.department !== undefined && { department: dto.department?.trim() || null }),
                ...(dto.accountId !== undefined && { accountId: dto.accountId }),
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
            },
        });

        await logAudit(orgId, userId, AuditAction.UPDATE, 'Contact', contactId, {
            before: existingContact,
            after: dto,
        });

        logger.info(`Contact updated: ${contactId} by user ${userId}`);

        return updatedContact as ContactWithRelations;
    },

    /**
     * Delete a contact
     */
    async delete(
        orgId: string,
        userId: string,
        userRole: Role,
        contactId: string
    ): Promise<void> {
        // Get existing contact
        const existingContact = await prisma.contact.findFirst({
            where: {
                id: contactId,
                orgId,
            },
            include: {
                opportunities: {
                    select: {
                        id: true,
                    },
                },
            },
        });

        if (!existingContact) {
            throw new NotFoundError('Contact not found');
        }

        // Check ownership for reps
        if (userRole === Role.REP && existingContact.ownerId !== userId) {
            throw new NotFoundError('Contact not found');
        }

        // Check for related opportunities
        if (existingContact.opportunities.length > 0) {
            throw new ValidationError('Cannot delete contact with related opportunities', [
                {
                    field: 'contact',
                    message: `This contact is associated with ${existingContact.opportunities.length} opportunity(ies). Please remove them first.`,
                    code: 'CONTACT_HAS_RELATIONS'
                },
            ]);
        }

        await prisma.contact.delete({
            where: { id: contactId },
        });

        await logAudit(orgId, userId, AuditAction.DELETE, 'Contact', contactId, {
            before: existingContact,
        });

        logger.info(`Contact deleted: ${contactId} by user ${userId}`);
    },

    /**
     * Search contacts (free-text search)
     */
    async search(
        orgId: string,
        userId: string,
        userRole: Role,
        query: string,
        limit: number = 20
    ): Promise<ContactWithRelations[]> {
        const where: any = {
            orgId,
            OR: [
                { firstName: { contains: query, mode: 'insensitive' } },
                { lastName: { contains: query, mode: 'insensitive' } },
                { email: { contains: query, mode: 'insensitive' } },
            ],
        };

        // Role-based filtering
        if (userRole === Role.REP) {
            where.ownerId = userId;
        }

        const contacts = await prisma.contact.findMany({
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
            },
            take: Math.min(limit, 100),
            orderBy: {
                lastName: 'asc',
            },
        });

        await logAudit(orgId, userId, AuditAction.READ, 'Contact', null, undefined, AuditOutcome.SUCCESS, `Searched contacts: ${query}`);

        return contacts as ContactWithRelations[];
    },

    /**
     * Link contact to an account
     */
    async linkToAccount(
        orgId: string,
        userId: string,
        userRole: Role,
        contactId: string,
        accountId: string
    ): Promise<ContactWithRelations> {
        // Get existing contact
        const contact = await prisma.contact.findFirst({
            where: {
                id: contactId,
                orgId,
            },
        });

        if (!contact) {
            throw new NotFoundError('Contact not found');
        }

        // Check ownership for reps
        if (userRole === Role.REP && contact.ownerId !== userId) {
            throw new NotFoundError('Contact not found');
        }

        // Verify account exists
        const account = await prisma.account.findFirst({
            where: {
                id: accountId,
                orgId,
            },
        });

        if (!account) {
            throw new ValidationError('Account not found', [
                { field: 'accountId', message: 'The specified account does not exist', code: 'INVALID_ACCOUNT' },
            ]);
        }

        const updatedContact = await prisma.contact.update({
            where: { id: contactId },
            data: {
                accountId,
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
            },
        });

        await logAudit(orgId, userId, AuditAction.UPDATE, 'Contact', contactId, {
            before: { accountId: contact.accountId },
            after: { accountId },
        });

        logger.info(`Contact ${contactId} linked to account ${accountId} by user ${userId}`);

        return updatedContact as ContactWithRelations;
    },

    /**
     * Unlink contact from an account
     */
    async unlinkFromAccount(
        orgId: string,
        userId: string,
        userRole: Role,
        contactId: string
    ): Promise<ContactWithRelations> {
        // Get existing contact
        const contact = await prisma.contact.findFirst({
            where: {
                id: contactId,
                orgId,
            },
        });

        if (!contact) {
            throw new NotFoundError('Contact not found');
        }

        // Check ownership for reps
        if (userRole === Role.REP && contact.ownerId !== userId) {
            throw new NotFoundError('Contact not found');
        }

        const updatedContact = await prisma.contact.update({
            where: { id: contactId },
            data: {
                accountId: null,
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
            },
        });

        await logAudit(orgId, userId, AuditAction.UPDATE, 'Contact', contactId, {
            before: { accountId: contact.accountId },
            after: { accountId: null },
        });

        logger.info(`Contact ${contactId} unlinked from account by user ${userId}`);

        return updatedContact as ContactWithRelations;
    },
};
