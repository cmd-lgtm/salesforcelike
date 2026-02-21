import { Router, Request, Response, NextFunction } from 'express';
import { exportService } from '../../services/export.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireLeadRead, requireAccountRead, requireContactRead, requireOpportunityRead } from '../middleware/rbac.middleware';
import { LeadStatus, LeadSource, Industry, OpportunityStage } from '@prisma/client';

const router = Router();

// All export routes require authentication
router.use(authMiddleware);

// Helper to parse query filters
function parseFilters(query: Record<string, unknown>): Record<string, unknown> {
    const filters: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(query)) {
        // Skip pagination and sorting params
        if (['page', 'limit', 'sortBy', 'sortOrder', 'columns'].includes(key)) {
            continue;
        }

        // Skip empty values
        if (value === '' || value === undefined || value === null) {
            continue;
        }

        // Parse specific filter types
        if (key === 'status' && Object.values(LeadStatus).includes(value as LeadStatus)) {
            filters.status = value;
        } else if (key === 'source' && Object.values(LeadSource).includes(value as LeadSource)) {
            filters.source = value;
        } else if (key === 'industry' && Object.values(Industry).includes(value as Industry)) {
            filters.industry = value;
        } else if (key === 'stage' && Object.values(OpportunityStage).includes(value as OpportunityStage)) {
            filters.stage = value;
        } else if (key === 'converted') {
            filters.converted = value === 'true';
        } else if (key === 'page' || key === 'limit') {
            // Skip, handled separately
        } else {
            // Pass through as-is
            filters[key] = value;
        }
    }

    return filters;
}

// ============================================
// GET /export/leads - Export leads
// ============================================
router.get('/leads', requireLeadRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const {
            columns,
            sortBy,
            sortOrder,
            page,
            limit,
            format = 'csv',
            ...filterParams
        } = req.query;

        const options: {
            columns?: string[];
            sortBy?: string;
            sortOrder?: 'asc' | 'desc';
            page?: number;
            limit?: number;
            filters?: Record<string, unknown>;
        } = {};

        // Parse columns
        if (columns) {
            options.columns = (columns as string).split(',').map(c => c.trim());
        }

        // Parse sorting
        if (sortBy) {
            options.sortBy = sortBy as string;
        }
        if (sortOrder && ['asc', 'desc'].includes(sortOrder as string)) {
            options.sortOrder = sortOrder as 'asc' | 'desc';
        }

        // Parse pagination
        options.page = page ? parseInt(page as string, 10) : 1;
        options.limit = limit ? parseInt(limit as string, 10) : 1000;

        // Parse filters
        options.filters = parseFilters(filterParams);

        const result = await exportService.exportLeads(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            options
        );

        // Return CSV or JSON based on format
        if (format === 'csv') {
            const csv = exportService.generateCSV(result);

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=leads_export.csv`);
            res.status(200).send(csv);
        } else {
            res.status(200).json({
                success: true,
                data: result.data,
                columns: result.columns,
                pagination: {
                    page: options.page,
                    limit: options.limit,
                    total: result.total,
                    totalPages: Math.ceil(result.total / options.limit!),
                },
            });
        }
    } catch (error) {
        next(error);
    }
});

// ============================================
// GET /export/accounts - Export accounts
// ============================================
router.get('/accounts', requireAccountRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const {
            columns,
            sortBy,
            sortOrder,
            page,
            limit,
            format = 'csv',
            ...filterParams
        } = req.query;

        const options: {
            columns?: string[];
            sortBy?: string;
            sortOrder?: 'asc' | 'desc';
            page?: number;
            limit?: number;
            filters?: Record<string, unknown>;
        } = {};

        // Parse columns
        if (columns) {
            options.columns = (columns as string).split(',').map(c => c.trim());
        }

        // Parse sorting
        if (sortBy) {
            options.sortBy = sortBy as string;
        }
        if (sortOrder && ['asc', 'desc'].includes(sortOrder as string)) {
            options.sortOrder = sortOrder as 'asc' | 'desc';
        }

        // Parse pagination
        options.page = page ? parseInt(page as string, 10) : 1;
        options.limit = limit ? parseInt(limit as string, 10) : 1000;

        // Parse filters
        options.filters = parseFilters(filterParams);

        const result = await exportService.exportAccounts(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            options
        );

        // Return CSV or JSON based on format
        if (format === 'csv') {
            const csv = exportService.generateCSV(result);

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=accounts_export.csv`);
            res.status(200).send(csv);
        } else {
            res.status(200).json({
                success: true,
                data: result.data,
                columns: result.columns,
                pagination: {
                    page: options.page,
                    limit: options.limit,
                    total: result.total,
                    totalPages: Math.ceil(result.total / options.limit!),
                },
            });
        }
    } catch (error) {
        next(error);
    }
});

// ============================================
// GET /export/contacts - Export contacts
// ============================================
router.get('/contacts', requireContactRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const {
            columns,
            sortBy,
            sortOrder,
            page,
            limit,
            format = 'csv',
            ...filterParams
        } = req.query;

        const options: {
            columns?: string[];
            sortBy?: string;
            sortOrder?: 'asc' | 'desc';
            page?: number;
            limit?: number;
            filters?: Record<string, unknown>;
        } = {};

        // Parse columns
        if (columns) {
            options.columns = (columns as string).split(',').map(c => c.trim());
        }

        // Parse sorting
        if (sortBy) {
            options.sortBy = sortBy as string;
        }
        if (sortOrder && ['asc', 'desc'].includes(sortOrder as string)) {
            options.sortOrder = sortOrder as 'asc' | 'desc';
        }

        // Parse pagination
        options.page = page ? parseInt(page as string, 10) : 1;
        options.limit = limit ? parseInt(limit as string, 10) : 1000;

        // Parse filters
        options.filters = parseFilters(filterParams);

        const result = await exportService.exportContacts(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            options
        );

        // Return CSV or JSON based on format
        if (format === 'csv') {
            const csv = exportService.generateCSV(result);

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=contacts_export.csv`);
            res.status(200).send(csv);
        } else {
            res.status(200).json({
                success: true,
                data: result.data,
                columns: result.columns,
                pagination: {
                    page: options.page,
                    limit: options.limit,
                    total: result.total,
                    totalPages: Math.ceil(result.total / options.limit!),
                },
            });
        }
    } catch (error) {
        next(error);
    }
});

// ============================================
// GET /export/opportunities - Export opportunities
// ============================================
router.get('/opportunities', requireOpportunityRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const {
            columns,
            sortBy,
            sortOrder,
            page,
            limit,
            format = 'csv',
            ...filterParams
        } = req.query;

        const options: {
            columns?: string[];
            sortBy?: string;
            sortOrder?: 'asc' | 'desc';
            page?: number;
            limit?: number;
            filters?: Record<string, unknown>;
        } = {};

        // Parse columns
        if (columns) {
            options.columns = (columns as string).split(',').map(c => c.trim());
        }

        // Parse sorting
        if (sortBy) {
            options.sortBy = sortBy as string;
        }
        if (sortOrder && ['asc', 'desc'].includes(sortOrder as string)) {
            options.sortOrder = sortOrder as 'asc' | 'desc';
        }

        // Parse pagination
        options.page = page ? parseInt(page as string, 10) : 1;
        options.limit = limit ? parseInt(limit as string, 10) : 1000;

        // Parse filters
        options.filters = parseFilters(filterParams);

        const result = await exportService.exportOpportunities(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            options
        );

        // Return CSV or JSON based on format
        if (format === 'csv') {
            const csv = exportService.generateCSV(result);

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=opportunities_export.csv`);
            res.status(200).send(csv);
        } else {
            res.status(200).json({
                success: true,
                data: result.data,
                columns: result.columns,
                pagination: {
                    page: options.page,
                    limit: options.limit,
                    total: result.total,
                    totalPages: Math.ceil(result.total / options.limit!),
                },
            });
        }
    } catch (error) {
        next(error);
    }
});

export default router;
