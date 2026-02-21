import { prisma } from '../config/database';
import { ValidationError } from '../shared/errors/validation.error';
import { LeadStatus, LeadSource, Industry, OpportunityStage, Role, AuditAction, AuditOutcome, Prisma } from '@prisma/client';
import { stringify } from 'csv-stringify/sync';

// ============================================
// TYPES & INTERFACES
// ============================================

export type ExportEntity = 'leads' | 'accounts' | 'contacts' | 'opportunities';

export interface ExportOptions {
    columns?: string[];
    filters?: Record<string, unknown>;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number;
}

export interface ExportResult {
    data: Record<string, unknown>[];
    columns: string[];
    total: number;
}

export interface EntityExportConfig {
    entity: ExportEntity;
    defaultColumns: string[];
    allColumns: string[];
    allowedFilters: string[];
    sortOptions: string[];
    relationColumns: string[];
}

// ============================================
// ENTITY EXPORT CONFIGURATIONS
// ============================================

const ENTITY_EXPORT_CONFIGS: Record<ExportEntity, EntityExportConfig> = {
    leads: {
        entity: 'leads',
        defaultColumns: ['id', 'firstName', 'lastName', 'company', 'email', 'phone', 'status', 'source', 'createdAt'],
        allColumns: ['id', 'firstName', 'lastName', 'company', 'email', 'phone', 'status', 'source', 'converted', 'notes', 'createdAt', 'updatedAt', 'ownerId'],
        allowedFilters: ['status', 'source', 'ownerId', 'createdAtFrom', 'createdAtTo', 'search', 'converted'],
        sortOptions: ['createdAt', 'updatedAt', 'firstName', 'lastName', 'company'],
        relationColumns: ['ownerId'],
    },
    accounts: {
        entity: 'accounts',
        defaultColumns: ['id', 'name', 'website', 'industry', 'phone', 'createdAt'],
        allColumns: ['id', 'name', 'website', 'industry', 'phone', 'annualRevenue', 'employees', 'createdAt', 'updatedAt', 'ownerId'],
        allowedFilters: ['industry', 'ownerId', 'createdAtFrom', 'createdAtTo', 'search'],
        sortOptions: ['createdAt', 'updatedAt', 'name', 'industry'],
        relationColumns: ['ownerId'],
    },
    contacts: {
        entity: 'contacts',
        defaultColumns: ['id', 'firstName', 'lastName', 'title', 'email', 'phone', 'accountId', 'createdAt'],
        allColumns: ['id', 'firstName', 'lastName', 'title', 'email', 'phone', 'department', 'accountId', 'createdAt', 'updatedAt', 'ownerId'],
        allowedFilters: ['accountId', 'ownerId', 'createdAtFrom', 'createdAtTo', 'search'],
        sortOptions: ['createdAt', 'updatedAt', 'firstName', 'lastName', 'email'],
        relationColumns: ['ownerId', 'accountId'],
    },
    opportunities: {
        entity: 'opportunities',
        defaultColumns: ['id', 'name', 'stage', 'amount', 'closeDate', 'accountId', 'createdAt'],
        allColumns: ['id', 'name', 'stage', 'amount', 'probability', 'closeDate', 'accountId', 'contactId', 'lostReason', 'wonNotes', 'createdAt', 'updatedAt', 'ownerId'],
        allowedFilters: ['stage', 'accountId', 'ownerId', 'createdAtFrom', 'createdAtTo', 'closeDateFrom', 'closeDateTo', 'search'],
        sortOptions: ['createdAt', 'updatedAt', 'closeDate', 'amount', 'name', 'stage'],
        relationColumns: ['ownerId', 'accountId', 'contactId'],
    },
};

// ============================================
// EXPORT SERVICE
// ============================================

export const exportService = {
    /**
     * Get export configuration for an entity
     */
    getExportConfig(entity: ExportEntity): EntityExportConfig {
        const config = ENTITY_EXPORT_CONFIGS[entity];
        if (!config) {
            throw new ValidationError(`Invalid entity: ${entity}`, [
                { field: 'entity', message: `Entity must be one of: ${Object.keys(ENTITY_EXPORT_CONFIGS).join(', ')}`, code: 'INVALID_ENTITY' },
            ]);
        }
        return config;
    },

    /**
     * Get available columns for an entity
     */
    getAvailableColumns(entity: ExportEntity): string[] {
        return this.getExportConfig(entity).allColumns;
    },

    /**
     * Validate and normalize export options
     */
    validateOptions(entity: ExportEntity, options: ExportOptions): ExportOptions {
        const config = this.getExportConfig(entity);

        // Validate columns
        let columns = options.columns || config.defaultColumns;

        // Filter to only valid columns
        columns = columns.filter(col => config.allColumns.includes(col));

        // Ensure at least one column
        if (columns.length === 0) {
            columns = config.defaultColumns;
        }

        // Validate sortBy
        let sortBy = options.sortBy || 'createdAt';
        if (!config.sortOptions.includes(sortBy)) {
            sortBy = 'createdAt';
        }

        // Validate sortOrder
        let sortOrder = options.sortOrder || 'desc';
        if (!['asc', 'desc'].includes(sortOrder)) {
            sortOrder = 'desc';
        }

        // Validate pagination
        let page = options.page || 1;
        let limit = options.limit || 1000;

        // Enforce max limit for exports
        limit = Math.min(limit, 10000);
        page = Math.max(page, 1);

        return {
            ...options,
            columns,
            sortBy,
            sortOrder,
            page,
            limit,
        };
    },

    /**
     * Build where clause from filters
     */
    buildWhereClause(entity: ExportEntity, orgId: string, userId: string, userRole: Role, filters: Record<string, unknown>): Prisma.LeadWhereInput | Prisma.AccountWhereInput | Prisma.ContactWhereInput | Prisma.OpportunityWhereInput {
        const where: Record<string, unknown> = { orgId };

        // Role-based filtering
        if (userRole === Role.REP) {
            where.ownerId = userId;
        } else if (filters.ownerId) {
            where.ownerId = filters.ownerId;
        }

        // Entity-specific filters
        switch (entity) {
            case 'leads': {
                const leadWhere = where as Prisma.LeadWhereInput;
                if (filters.status) leadWhere.status = filters.status as LeadStatus;
                if (filters.source) leadWhere.source = filters.source as LeadSource;
                if (filters.converted !== undefined) leadWhere.converted = filters.converted as boolean;
                if (filters.search) {
                    const search = filters.search as string;
                    leadWhere.OR = [
                        { firstName: { contains: search, mode: 'insensitive' } },
                        { lastName: { contains: search, mode: 'insensitive' } },
                        { company: { contains: search, mode: 'insensitive' } },
                        { email: { contains: search, mode: 'insensitive' } },
                    ];
                }
                // Date range
                if (filters.createdAtFrom || filters.createdAtTo) {
                    leadWhere.createdAt = {};
                    if (filters.createdAtFrom) leadWhere.createdAt.gte = new Date(filters.createdAtFrom as string);
                    if (filters.createdAtTo) leadWhere.createdAt.lte = new Date(filters.createdAtTo as string);
                }
                return leadWhere;
            }

            case 'accounts': {
                const accountWhere = where as Prisma.AccountWhereInput;
                if (filters.industry) accountWhere.industry = filters.industry as Industry;
                if (filters.search) {
                    const search = filters.search as string;
                    accountWhere.OR = [
                        { name: { contains: search, mode: 'insensitive' } },
                        { website: { contains: search, mode: 'insensitive' } },
                    ];
                }
                // Date range
                if (filters.createdAtFrom || filters.createdAtTo) {
                    accountWhere.createdAt = {};
                    if (filters.createdAtFrom) accountWhere.createdAt.gte = new Date(filters.createdAtFrom as string);
                    if (filters.createdAtTo) accountWhere.createdAt.lte = new Date(filters.createdAtTo as string);
                }
                return accountWhere;
            }

            case 'contacts': {
                const contactWhere = where as Prisma.ContactWhereInput;
                if (filters.accountId) contactWhere.accountId = filters.accountId as string;
                if (filters.search) {
                    const search = filters.search as string;
                    contactWhere.OR = [
                        { firstName: { contains: search, mode: 'insensitive' } },
                        { lastName: { contains: search, mode: 'insensitive' } },
                        { email: { contains: search, mode: 'insensitive' } },
                    ];
                }
                // Date range
                if (filters.createdAtFrom || filters.createdAtTo) {
                    contactWhere.createdAt = {};
                    if (filters.createdAtFrom) contactWhere.createdAt.gte = new Date(filters.createdAtFrom as string);
                    if (filters.createdAtTo) contactWhere.createdAt.lte = new Date(filters.createdAtTo as string);
                }
                return contactWhere;
            }

            case 'opportunities': {
                const oppWhere = where as Prisma.OpportunityWhereInput;
                if (filters.stage) oppWhere.stage = filters.stage as OpportunityStage;
                if (filters.accountId) oppWhere.accountId = filters.accountId as string;
                if (filters.search) {
                    const search = filters.search as string;
                    oppWhere.OR = [
                        { name: { contains: search, mode: 'insensitive' } },
                    ];
                }
                // Date range
                if (filters.createdAtFrom || filters.createdAtTo) {
                    oppWhere.createdAt = {};
                    if (filters.createdAtFrom) oppWhere.createdAt.gte = new Date(filters.createdAtFrom as string);
                    if (filters.createdAtTo) oppWhere.createdAt.lte = new Date(filters.createdAtTo as string);
                }
                // Close date range
                if (filters.closeDateFrom || filters.closeDateTo) {
                    oppWhere.closeDate = {};
                    if (filters.closeDateFrom) oppWhere.closeDate.gte = new Date(filters.closeDateFrom as string);
                    if (filters.closeDateTo) oppWhere.closeDate.lte = new Date(filters.closeDateTo as string);
                }
                return oppWhere;
            }

            default:
                return where as Prisma.LeadWhereInput;
        }
    },

    /**
     * Export leads
     */
    async exportLeads(
        orgId: string,
        userId: string,
        userRole: Role,
        options: ExportOptions = {}
    ): Promise<ExportResult> {
        return this.exportRecords('leads', orgId, userId, userRole, options);
    },

    /**
     * Export accounts
     */
    async exportAccounts(
        orgId: string,
        userId: string,
        userRole: Role,
        options: ExportOptions = {}
    ): Promise<ExportResult> {
        return this.exportRecords('accounts', orgId, userId, userRole, options);
    },

    /**
     * Export contacts
     */
    async exportContacts(
        orgId: string,
        userId: string,
        userRole: Role,
        options: ExportOptions = {}
    ): Promise<ExportResult> {
        return this.exportRecords('contacts', orgId, userId, userRole, options);
    },

    /**
     * Export opportunities
     */
    async exportOpportunities(
        orgId: string,
        userId: string,
        userRole: Role,
        options: ExportOptions = {}
    ): Promise<ExportResult> {
        return this.exportRecords('opportunities', orgId, userId, userRole, options);
    },

    /**
     * Core export logic
     */
    async exportRecords(
        entity: ExportEntity,
        orgId: string,
        userId: string,
        userRole: Role,
        options: ExportOptions = {}
    ): Promise<ExportResult> {
        const config = this.getExportConfig(entity);
        const validatedOptions = this.validateOptions(entity, options);

        const where = this.buildWhereClause(entity, orgId, userId, userRole, options.filters || {});

        // Get total count
        let total = 0;
        switch (entity) {
            case 'leads':
                total = await prisma.lead.count({ where: where as Prisma.LeadWhereInput });
                break;
            case 'accounts':
                total = await prisma.account.count({ where: where as Prisma.AccountWhereInput });
                break;
            case 'contacts':
                total = await prisma.contact.count({ where: where as Prisma.ContactWhereInput });
                break;
            case 'opportunities':
                total = await prisma.opportunity.count({ where: where as Prisma.OpportunityWhereInput });
                break;
        }

        // Get pagination
        const skip = (validatedOptions.page! - 1) * validatedOptions.limit!;

        // Fetch data based on entity
        let records: Record<string, unknown>[] = [];

        switch (entity) {
            case 'leads':
                records = await prisma.lead.findMany({
                    where: where as Prisma.LeadWhereInput,
                    select: this.buildSelectClause(validatedOptions.columns!, config),
                    orderBy: { [validatedOptions.sortBy!]: validatedOptions.sortOrder },
                    skip,
                    take: validatedOptions.limit,
                });
                break;

            case 'accounts':
                records = await prisma.account.findMany({
                    where: where as Prisma.AccountWhereInput,
                    select: this.buildSelectClause(validatedOptions.columns!, config),
                    orderBy: { [validatedOptions.sortBy!]: validatedOptions.sortOrder },
                    skip,
                    take: validatedOptions.limit,
                });
                break;

            case 'contacts':
                records = await prisma.contact.findMany({
                    where: where as Prisma.ContactWhereInput,
                    select: this.buildSelectClause(validatedOptions.columns!, config),
                    orderBy: { [validatedOptions.sortBy!]: validatedOptions.sortOrder },
                    skip,
                    take: validatedOptions.limit,
                });
                break;

            case 'opportunities':
                records = await prisma.opportunity.findMany({
                    where: where as Prisma.OpportunityWhereInput,
                    select: this.buildSelectClause(validatedOptions.columns!, config),
                    orderBy: { [validatedOptions.sortBy!]: validatedOptions.sortOrder },
                    skip,
                    take: validatedOptions.limit,
                });
                break;
        }

        // Log audit
        await prisma.auditLog.create({
            data: {
                orgId,
                userId,
                action: AuditAction.EXPORT,
                objectType: entity,
                outcome: AuditOutcome.SUCCESS,
            },
        });

        return {
            data: records,
            columns: validatedOptions.columns!,
            total,
        };
    },

    /**
     * Build Prisma select clause from columns
     */
    buildSelectClause(columns: string[], config: EntityExportConfig): Record<string, boolean> {
        const select: Record<string, boolean> = {};

        for (const col of columns) {
            if (config.relationColumns.includes(col)) {
                // For relation columns, we'll just include the ID for now
                select[col] = true;
            } else {
                select[col] = true;
            }
        }

        return select;
    },

    /**
     * Convert records to CSV
     */
    toCSV(data: Record<string, unknown>[], columns: string[]): string {
        // Handle special types (dates, decimals)
        const normalizedData = data.map(row => {
            const normalized: Record<string, unknown> = {};

            for (const col of columns) {
                let value = row[col];

                // Handle Date objects
                if (value instanceof Date) {
                    value = value.toISOString();
                }
                // Handle Decimal (Prisma)
                else if (value && typeof value === 'object' && 'toNumber' in value) {
                    value = (value as { toNumber(): number }).toNumber();
                }

                normalized[col] = value;
            }

            return normalized;
        });

        return stringify(normalizedData, {
            header: true,
            quoted_string: true,
        });
    },

    /**
     * Generate CSV with headers
     */
    generateCSV(result: ExportResult): string {
        return this.toCSV(result.data, result.columns);
    },

    /**
     * Get filtered data with relation names
     */
    async enrichRecordsWithRelations(
        entity: ExportEntity,
        orgId: string,
        data: Record<string, unknown>[],
        columns: string[]
    ): Promise<Record<string, unknown>[]> {
        const config = this.getExportConfig(entity);

        // If no relation columns, just return data
        const relationCols = columns.filter(col => config.relationColumns.includes(col));
        if (relationCols.length === 0) {
            return data;
        }

        // Get unique owner IDs
        const ownerIds = new Set<string>();
        const accountIds = new Set<string>();
        const contactIds = new Set<string>();

        for (const record of data) {
            if (record.ownerId) ownerIds.add(record.ownerId as string);
            if (record.accountId) accountIds.add(record.accountId as string);
            if (record.contactId) contactIds.add(record.contactId as string);
        }

        // Fetch relation data
        const owners = ownerIds.size > 0 ? await prisma.user.findMany({
            where: { id: { in: Array.from(ownerIds) }, orgId },
            select: { id: true, firstName: true, lastName: true, email: true },
        }) : [];

        const accounts = accountIds.size > 0 ? await prisma.account.findMany({
            where: { id: { in: Array.from(accountIds) }, orgId },
            select: { id: true, name: true },
        }) : [];

        const contacts = contactIds.size > 0 ? await prisma.contact.findMany({
            where: { id: { in: Array.from(contactIds) }, orgId },
            select: { id: true, firstName: true, lastName: true, email: true },
        }) : [];

        // Create lookup maps with explicit typing
        const ownerMap = new Map<string, { id: string; firstName: string; lastName: string }>();
        for (const o of owners) {
            ownerMap.set(o.id, o);
        }
        const accountMap = new Map<string, { id: string; name: string }>();
        for (const a of accounts) {
            accountMap.set(a.id, a);
        }
        const contactMap = new Map<string, { id: string; firstName: string; lastName: string }>();
        for (const c of contacts) {
            contactMap.set(c.id, c);
        }

        // Enrich records
        return data.map(record => {
            const enriched = { ...record };

            // Add owner name
            if (record.ownerId && ownerMap.has(record.ownerId as string)) {
                const owner = ownerMap.get(record.ownerId as string)!;
                enriched.ownerName = `${owner.firstName} ${owner.lastName}`;
            }

            // Add account name
            if (record.accountId && accountMap.has(record.accountId as string)) {
                const account = accountMap.get(record.accountId as string)!;
                enriched.accountName = account.name;
            }

            // Add contact name
            if (record.contactId && contactMap.has(record.contactId as string)) {
                const contact = contactMap.get(record.contactId as string)!;
                enriched.contactName = `${contact.firstName} ${contact.lastName}`;
            }

            return enriched;
        });
    },
};
