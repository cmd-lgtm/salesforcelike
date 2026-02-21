import { prisma } from '../config/database';
import { logger } from '../shared/logger';
import { ValidationError } from '../shared/errors/validation.error';
import { LeadStatus, LeadSource, Industry, OpportunityStage, AuditAction, AuditOutcome, Prisma } from '@prisma/client';
import { pipeline } from 'stream/promises';
import csvParser from 'csv-parser';
import { stringify } from 'csv-stringify/sync';
import { Readable } from 'stream';

// ============================================
// TYPES & INTERFACES
// ============================================

export type ImportEntity = 'leads' | 'accounts' | 'contacts' | 'opportunities';

export interface FieldMapping {
    [csvColumn: string]: string;
}

export interface ImportOptions {
    fieldMapping?: FieldMapping;
    skipDuplicates?: boolean;
    updateExisting?: boolean;
    batchSize?: number;
    ownerId?: string;
}

export interface ImportResult {
    success: boolean;
    totalRows: number;
    successCount: number;
    failureCount: number;
    duplicateCount: number;
    results: ImportRowResult[];
    errors: ImportError[];
    processingTimeMs: number;
}

export interface ImportRowResult {
    row: number;
    status: 'success' | 'failure' | 'duplicate';
    entityId?: string;
    message?: string;
    data?: Record<string, unknown>;
}

export interface ImportError {
    row: number;
    field: string;
    message: string;
    value?: string;
}

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

export interface EntityFields {
    entity: ImportEntity;
    requiredFields: string[];
    optionalFields: string[];
    validEnumFields: Record<string, string[]>;
    relationalFields: string[];
}

// ============================================
// ENTITY FIELD DEFINITIONS
// ============================================

const ENTITY_FIELD_DEFINITIONS: Record<ImportEntity, EntityFields> = {
    leads: {
        entity: 'leads',
        requiredFields: ['firstName', 'lastName', 'company'],
        optionalFields: ['email', 'phone', 'status', 'source', 'notes'],
        validEnumFields: {
            status: Object.values(LeadStatus),
            source: Object.values(LeadSource),
        },
        relationalFields: [],
    },
    accounts: {
        entity: 'accounts',
        requiredFields: ['name'],
        optionalFields: ['website', 'industry', 'phone', 'annualRevenue', 'employees'],
        validEnumFields: {
            industry: Object.values(Industry),
        },
        relationalFields: [],
    },
    contacts: {
        entity: 'contacts',
        requiredFields: ['firstName', 'lastName'],
        optionalFields: ['title', 'email', 'phone', 'department', 'accountId'],
        validEnumFields: {},
        relationalFields: ['accountId'],
    },
    opportunities: {
        entity: 'opportunities',
        requiredFields: ['name', 'stage', 'closeDate'],
        optionalFields: ['amount', 'accountId', 'contactId', 'probability', 'lostReason', 'wonNotes'],
        validEnumFields: {
            stage: Object.values(OpportunityStage),
        },
        relationalFields: ['accountId', 'contactId'],
    },
};

// ============================================
// VALIDATION HELPERS
// ============================================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email: string | null | undefined): boolean {
    if (!email || email === '') return true; // Email is optional
    return EMAIL_REGEX.test(email);
}

function isValidEnum(value: string, validValues: string[]): boolean {
    return validValues.includes(value);
}

function isValidRelationalId(id: string | null | undefined, orgId: string, entity: string): Promise<boolean> {
    if (!id || id === '') return Promise.resolve(true); // Optional field

    // Use type-safe access to Prisma models
    const entityLower = entity.toLowerCase() as 'lead' | 'account' | 'contact' | 'opportunity';
    const model = prisma[entityLower];
    if (!model) return Promise.resolve(false);

    return (model as unknown as { count: (args: { where: { id: string; orgId: string } }) => Promise<number> }).count({
        where: { id, orgId },
    }).then((count: number) => count > 0);
}

function isValidDate(dateStr: string | null | undefined): boolean {
    if (!dateStr || dateStr === '') return true; // Optional
    const date = new Date(dateStr);
    return !isNaN(date.getTime());
}

function isValidNumber(value: string | null | undefined): boolean {
    if (!value || value === '') return true; // Optional
    return !isNaN(parseFloat(value));
}

function isValidPositiveNumber(value: string | null | undefined): boolean {
    if (!value || value === '') return true; // Optional
    const num = parseFloat(value);
    return !isNaN(num) && num >= 0;
}

// ============================================
// IMPORT SERVICE
// ============================================

export const importService = {
    /**
     * Get available fields for an entity
     */
    getAvailableFields(entity: ImportEntity): EntityFields {
        const definition = ENTITY_FIELD_DEFINITIONS[entity];
        if (!definition) {
            throw new ValidationError(`Invalid entity: ${entity}`, [
                { field: 'entity', message: `Entity must be one of: ${Object.keys(ENTITY_FIELD_DEFINITIONS).join(', ')}`, code: 'INVALID_ENTITY' },
            ]);
        }
        return definition;
    },

    /**
     * Generate CSV template for an entity
     */
    generateTemplate(entity: ImportEntity): string {
        const definition = this.getAvailableFields(entity);

        const allFields = [
            ...definition.requiredFields.map(f => ({ name: f, required: true })),
            ...definition.optionalFields.map(f => ({ name: f, required: false })),
        ];

        const headers = allFields.map(f => f.name);
        const sampleData = allFields.map(f => {
            if (definition.validEnumFields[f.name]) {
                return definition.validEnumFields[f.name][0];
            }
            if (f.name === 'closeDate') {
                return '2024-12-31';
            }
            if (f.name === 'amount' || f.name === 'annualRevenue') {
                return '10000';
            }
            if (f.name === 'probability') {
                return '50';
            }
            return f.required ? `sample_${f.name}` : '';
        });

        const csvContent = stringify([headers, sampleData], {
            header: false,
            quoted_string: true,
        });

        return csvContent;
    },

    /**
     * Parse CSV data to records
     */
    async parseCSV(buffer: Buffer): Promise<Record<string, string>[]> {
        const results: Record<string, string>[] = [];

        const readable = new Readable();
        readable._read = () => { }; // Make it readable

        // Push buffer to stream
        readable.push(buffer);
        readable.push(null);

        await pipeline(
            readable,
            csvParser({
                mapHeaders: ({ header }: { header: string }) => header.trim(),
                mapValues: ({ value }: { value: string }) => value?.trim() || '',
            }),
            async function* (source: AsyncIterable<Record<string, string>>) {
                for await (const row of source) {
                    results.push(row);
                }
            }
        );

        return results;
    },

    /**
     * Validate a single row
     */
    async validateRow(
        entity: ImportEntity,
        row: Record<string, string>,
        rowNumber: number,
        orgId: string
    ): Promise<{ isValid: boolean; errors: ImportError[]; data?: Record<string, unknown> }> {
        const definition = ENTITY_FIELD_DEFINITIONS[entity];
        const errors: ImportError[] = [];

        // Check required fields
        for (const field of definition.requiredFields) {
            const value = row[field];
            if (!value || value.trim() === '') {
                errors.push({
                    row: rowNumber,
                    field,
                    message: `${field} is required`,
                    value,
                });
            }
        }

        // Validate enum fields
        for (const [field, validValues] of Object.entries(definition.validEnumFields)) {
            const value = row[field];
            if (value && !isValidEnum(value, validValues)) {
                errors.push({
                    row: rowNumber,
                    field,
                    message: `Invalid ${field}. Must be one of: ${validValues.join(', ')}`,
                    value,
                });
            }
        }

        // Validate email fields
        const emailFields = ['email'];
        for (const field of emailFields) {
            const value = row[field];
            if (value && !isValidEmail(value)) {
                errors.push({
                    row: rowNumber,
                    field,
                    message: `Invalid email format`,
                    value,
                });
            }
        }

        // Validate date fields
        const dateFields = entity === 'opportunities' ? ['closeDate'] : [];
        for (const field of dateFields) {
            const value = row[field];
            if (value && !isValidDate(value)) {
                errors.push({
                    row: rowNumber,
                    field,
                    message: `Invalid date format. Use YYYY-MM-DD`,
                    value,
                });
            }
        }

        // Validate number fields
        const numberFields = ['amount', 'annualRevenue', 'employees', 'probability'];
        for (const field of numberFields) {
            const value = row[field];
            if (value && !isValidNumber(value)) {
                errors.push({
                    row: rowNumber,
                    field,
                    message: `Invalid number format`,
                    value,
                });
            }
            if (value && (field === 'probability' || field === 'employees') && !isValidPositiveNumber(value)) {
                errors.push({
                    row: rowNumber,
                    field,
                    message: `Must be a positive number`,
                    value,
                });
            }
        }

        // Validate relational fields (accountId, contactId)
        for (const field of definition.relationalFields) {
            const value = row[field];
            if (value && value.trim() !== '') {
                const relatedEntity = field.replace('Id', '').toLowerCase() + 's'; // accountId -> accounts
                const isValid = await isValidRelationalId(value, orgId, relatedEntity);
                if (!isValid) {
                    errors.push({
                        row: rowNumber,
                        field,
                        message: `Invalid ${field}: Record not found`,
                        value,
                    });
                }
            }
        }

        if (errors.length > 0) {
            return { isValid: false, errors };
        }

        // Transform data
        const data = this.transformData(entity, row, orgId);
        return { isValid: true, errors: [], data };
    },

    /**
     * Transform row data to proper types
     */
    transformData(entity: ImportEntity, row: Record<string, string>, orgId: string): Record<string, unknown> {
        const definition = ENTITY_FIELD_DEFINITIONS[entity];
        const data: Record<string, unknown> = { orgId };

        for (const [key, value] of Object.entries(row)) {
            if (!value || value.trim() === '') continue;

            // Handle enum fields
            if (definition.validEnumFields[key]) {
                data[key] = value;
                continue;
            }

            // Handle date fields
            if (key === 'closeDate') {
                data[key] = new Date(value);
                continue;
            }

            // Handle number fields
            if (['amount', 'annualRevenue', 'probability', 'employees'].includes(key)) {
                data[key] = parseFloat(value);
                continue;
            }

            // Handle relational fields (keep as-is, already validated)
            if (definition.relationalFields.includes(key)) {
                data[key] = value;
                continue;
            }

            // Default: trim strings
            data[key] = value.trim();
        }

        return data;
    },

    /**
     * Check for duplicate email within org
     */
    async checkDuplicate(
        entity: ImportEntity,
        orgId: string,
        data: Record<string, unknown>
    ): Promise<{ isDuplicate: boolean; existingId?: string }> {
        let emailField: string | null = null;

        switch (entity) {
            case 'leads':
            case 'contacts':
                emailField = 'email';
                break;
            case 'accounts':
                emailField = 'website'; // Check by website as unique identifier
                break;
            default:
                return { isDuplicate: false };
        }

        if (!emailField || !data[emailField]) {
            return { isDuplicate: false };
        }

        const whereClause: Prisma.LeadWhereInput | Prisma.ContactWhereInput | Prisma.AccountWhereInput = {
            orgId,
            [emailField]: data[emailField] as string,
        };

        switch (entity) {
            case 'leads': {
                const existing = await prisma.lead.findFirst({ where: whereClause as Prisma.LeadWhereInput });
                return { isDuplicate: !!existing, existingId: existing?.id };
            }
            case 'contacts': {
                const existing = await prisma.contact.findFirst({ where: whereClause as Prisma.ContactWhereInput });
                return { isDuplicate: !!existing, existingId: existing?.id };
            }
            case 'accounts': {
                const existing = await prisma.account.findFirst({ where: whereClause as Prisma.AccountWhereInput });
                return { isDuplicate: !!existing, existingId: existing?.id };
            }
            default:
                return { isDuplicate: false };
        }
    },

    /**
     * Import leads
     */
    async importLeads(
        orgId: string,
        userId: string,
        buffer: Buffer,
        options: ImportOptions = {}
    ): Promise<ImportResult> {
        return this.importRecords('leads', orgId, userId, buffer, {
            ...options,
            ownerId: options.ownerId || userId,
        });
    },

    /**
     * Import accounts
     */
    async importAccounts(
        orgId: string,
        userId: string,
        buffer: Buffer,
        options: ImportOptions = {}
    ): Promise<ImportResult> {
        return this.importRecords('accounts', orgId, userId, buffer, {
            ...options,
            ownerId: options.ownerId || userId,
        });
    },

    /**
     * Import contacts
     */
    async importContacts(
        orgId: string,
        userId: string,
        buffer: Buffer,
        options: ImportOptions = {}
    ): Promise<ImportResult> {
        return this.importRecords('contacts', orgId, userId, buffer, {
            ...options,
            ownerId: options.ownerId || userId,
        });
    },

    /**
     * Import opportunities
     */
    async importOpportunities(
        orgId: string,
        userId: string,
        buffer: Buffer,
        options: ImportOptions = {}
    ): Promise<ImportResult> {
        return this.importRecords('opportunities', orgId, userId, buffer, {
            ...options,
            ownerId: options.ownerId || userId,
        });
    },

    /**
     * Core import logic with batch processing
     */
    async importRecords(
        entity: ImportEntity,
        orgId: string,
        userId: string,
        buffer: Buffer,
        options: ImportOptions = {}
    ): Promise<ImportResult> {
        const startTime = Date.now();
        const batchSize = options.batchSize || 100;
        const ownerId = options.ownerId || userId;

        const results: ImportRowResult[] = [];
        const errors: ImportError[] = [];
        let successCount = 0;
        let failureCount = 0;
        let duplicateCount = 0;

        // Parse CSV
        let records: Record<string, string>[];
        try {
            records = await this.parseCSV(buffer);
        } catch (error) {
            throw new ValidationError('Failed to parse CSV file', [
                { field: 'file', message: 'Invalid CSV format', code: 'INVALID_CSV' },
            ]);
        }

        if (records.length === 0) {
            throw new ValidationError('CSV file is empty', [
                { field: 'file', message: 'No data rows found in CSV', code: 'EMPTY_CSV' },
            ]);
        }

        if (records.length > 10000) {
            throw new ValidationError('File too large', [
                { field: 'file', message: 'Maximum 10,000 rows allowed', code: 'FILE_TOO_LARGE' },
            ]);
        }

        const definition = ENTITY_FIELD_DEFINITIONS[entity];

        // Process in batches
        for (let i = 0; i < records.length; i += batchSize) {
            const batch = records.slice(i, i + batchSize);
            const batchResults = await this.processBatch(
                entity,
                orgId,
                userId,
                batch,
                i + 1, // Starting row number
                { ...options, ownerId },
                definition
            );

            results.push(...batchResults.results);
            errors.push(...batchResults.errors);
            successCount += batchResults.successCount;
            failureCount += batchResults.failureCount;
            duplicateCount += batchResults.duplicateCount;
        }

        // Log audit
        await prisma.auditLog.create({
            data: {
                orgId,
                userId,
                action: AuditAction.IMPORT,
                objectType: entity,
                outcome: errors.length > 0 ? AuditOutcome.FAILURE : AuditOutcome.SUCCESS,
            },
        });

        return {
            success: failureCount === 0,
            totalRows: records.length,
            successCount,
            failureCount,
            duplicateCount,
            results,
            errors,
            processingTimeMs: Date.now() - startTime,
        };
    },

    /**
     * Process a batch of records
     */
    async processBatch(
        entity: ImportEntity,
        orgId: string,
        userId: string,
        batch: Record<string, string>[],
        startRow: number,
        options: ImportOptions & { ownerId: string },
        _definition: EntityFields
    ): Promise<{
        results: ImportRowResult[];
        errors: ImportError[];
        successCount: number;
        failureCount: number;
        duplicateCount: number;
    }> {
        const results: ImportRowResult[] = [];
        const errors: ImportError[] = [];
        let successCount = 0;
        let failureCount = 0;
        let duplicateCount = 0;

        // Validate all rows first
        const validatedData: Array<{
            rowNumber: number;
            data: Record<string, unknown>;
            isValid: boolean;
            rowErrors: ImportError[];
        }> = [];

        for (let i = 0; i < batch.length; i++) {
            const rowNumber = startRow + i;
            const row = batch[i];

            const validation = await this.validateRow(entity, row, rowNumber, orgId);
            validatedData.push({
                rowNumber,
                data: validation.data!,
                isValid: validation.isValid,
                rowErrors: validation.errors,
            });

            if (!validation.isValid) {
                errors.push(...validation.errors);
                failureCount++;
                results.push({
                    row: rowNumber,
                    status: 'failure',
                    message: validation.errors.map(e => e.message).join('; '),
                    data: row,
                });
            }
        }

        // Get valid records
        const validRecords = validatedData.filter(v => v.isValid);

        // Check for duplicates
        const recordsToInsert: Array<{
            rowNumber: number;
            data: Record<string, unknown>;
        }> = [];

        for (const valid of validRecords) {
            if (entity === 'leads' || entity === 'contacts' || entity === 'accounts') {
                const duplicate = await this.checkDuplicate(entity, orgId, valid.data);

                if (duplicate.isDuplicate) {
                    duplicateCount++;

                    if (options.skipDuplicates) {
                        results.push({
                            row: valid.rowNumber,
                            status: 'duplicate',
                            entityId: duplicate.existingId,
                            message: 'Skipped - duplicate found',
                        });
                        continue;
                    }

                    if (options.updateExisting && duplicate.existingId) {
                        // Update existing record
                        try {
                            await this.updateRecord(entity, duplicate.existingId, valid.data);
                            successCount++;
                            results.push({
                                row: valid.rowNumber,
                                status: 'success',
                                entityId: duplicate.existingId,
                                message: 'Updated existing record',
                            });
                        } catch (error) {
                            failureCount++;
                            results.push({
                                row: valid.rowNumber,
                                status: 'failure',
                                message: 'Failed to update record',
                            });
                        }
                        continue;
                    }

                    // Default: warn but allow import
                    results.push({
                        row: valid.rowNumber,
                        status: 'duplicate',
                        entityId: duplicate.existingId,
                        message: 'Warning - duplicate found, record created',
                    });
                }
            }

            recordsToInsert.push(valid);
        }

        // Insert valid records in batch
        if (recordsToInsert.length > 0) {
            const insertData = recordsToInsert.map(r => ({
                ...r.data,
                ownerId: options.ownerId || userId,
            }));

            try {
                await this.batchInsert(entity, insertData);

                for (const record of recordsToInsert) {
                    if (!results.find(r => r.row === record.rowNumber)) {
                        successCount++;
                        results.push({
                            row: record.rowNumber,
                            status: 'success',
                            message: 'Record created',
                        });
                    }
                }
            } catch (error) {
                logger.error(`Batch insert failed for ${entity}:`, error);

                // Mark all as failed
                for (const record of recordsToInsert) {
                    if (!results.find(r => r.row === record.rowNumber)) {
                        failureCount++;
                        results.push({
                            row: record.rowNumber,
                            status: 'failure',
                            message: 'Batch insert failed',
                        });
                    }
                }
            }
        }

        // Sort results by row number
        results.sort((a, b) => a.row - b.row);

        return {
            results,
            errors,
            successCount,
            failureCount,
            duplicateCount,
        };
    },

    /**
     * Batch insert records
     */
    async batchInsert(entity: ImportEntity, data: Record<string, unknown>[]): Promise<void> {
        switch (entity) {
            case 'leads':
                await prisma.lead.createMany({
                    data: data as Prisma.LeadCreateManyInput[],
                    skipDuplicates: true,
                });
                break;
            case 'accounts':
                await prisma.account.createMany({
                    data: data as Prisma.AccountCreateManyInput[],
                    skipDuplicates: true,
                });
                break;
            case 'contacts':
                await prisma.contact.createMany({
                    data: data as Prisma.ContactCreateManyInput[],
                    skipDuplicates: true,
                });
                break;
            case 'opportunities':
                await prisma.opportunity.createMany({
                    data: data as Prisma.OpportunityCreateManyInput[],
                    skipDuplicates: true,
                });
                break;
        }
    },

    /**
     * Update existing record
     */
    async updateRecord(entity: ImportEntity, id: string, data: Record<string, unknown>): Promise<void> {
        const { orgId, ownerId, ...updateData } = data;

        switch (entity) {
            case 'leads':
                await prisma.lead.update({
                    where: { id },
                    data: updateData as Prisma.LeadUpdateInput,
                });
                break;
            case 'accounts':
                await prisma.account.update({
                    where: { id },
                    data: updateData as Prisma.AccountUpdateInput,
                });
                break;
            case 'contacts':
                await prisma.contact.update({
                    where: { id },
                    data: updateData as Prisma.ContactUpdateInput,
                });
                break;
            case 'opportunities':
                await prisma.opportunity.update({
                    where: { id },
                    data: updateData as Prisma.OpportunityUpdateInput,
                });
                break;
        }
    },

    /**
     * Generate error report CSV
     */
    generateErrorReport(result: ImportResult): string {
        const errors = result.errors.map(e => ({
            row: e.row,
            field: e.field,
            message: e.message,
            value: e.value || '',
        }));

        return stringify(errors, {
            header: true,
            quoted_string: true,
        });
    },
};
