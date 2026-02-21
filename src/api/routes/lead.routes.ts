import { Router, Request, Response, NextFunction } from 'express';
import { leadService, CreateLeadDto, UpdateLeadDto, LeadFilters } from '../../services/lead.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireLeadRead, requireLeadCreate, requireLeadUpdate, requireLeadDelete, requireLeadConvert } from '../middleware/rbac.middleware';
import { LeadStatus, LeadSource } from '@prisma/client';

const router = Router();

// All lead routes require authentication
router.use(authMiddleware);

// ============================================
// GET /leads - List leads (paginated, filtered, searchable)
// ============================================
router.get('/', requireLeadRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const {
            status,
            source,
            ownerId,
            from,
            to,
            search,
            sortBy,
            sortOrder,
            page,
            limit
        } = req.query;

        const filters: LeadFilters = {
            status: status as LeadStatus | undefined,
            source: source as LeadSource | undefined,
            ownerId: ownerId as string | undefined,
            createdAtFrom: from ? new Date(from as string) : undefined,
            createdAtTo: to ? new Date(to as string) : undefined,
            search: search as string | undefined,
            sortBy: (sortBy as 'createdAt' | 'updatedAt' | 'firstName') || 'createdAt',
            sortOrder: (sortOrder as 'asc' | 'desc') || 'desc',
            page: page ? parseInt(page as string, 10) : 1,
            limit: limit ? parseInt(limit as string, 10) : 20,
        };

        const result = await leadService.findAll(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            filters
        );

        res.status(200).json({
            success: true,
            data: result.data,
            pagination: result.pagination,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// GET /leads/search - Search leads (free-text)
// ============================================
router.get('/search', requireLeadRead, async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const { q, limit } = req.query;

        if (!q || typeof q !== 'string') {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Search query (q) is required',
                },
            });
        }

        const leads = await leadService.search(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            q,
            limit ? parseInt(limit as string, 10) : 20
        );

        return res.status(200).json({
            success: true,
            data: leads,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// GET /leads/duplicates - Check for duplicate emails
// ============================================
router.get('/duplicates', requireLeadRead, async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const { email } = req.query;

        if (!email || typeof email !== 'string') {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Email parameter is required',
                },
            });
        }

        const result = await leadService.checkDuplicates(req.user!.orgId, email as string);

        res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// POST /leads - Create lead
// ============================================
router.post('/', requireLeadCreate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const dto: CreateLeadDto = {
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            company: req.body.company,
            email: req.body.email,
            phone: req.body.phone,
            status: req.body.status,
            source: req.body.source,
            notes: req.body.notes,
        };

        const lead = await leadService.create(
            req.user!.orgId,
            req.user!.id,
            dto,
            req.user!.role
        );

        res.status(201).json({
            success: true,
            data: lead,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// GET /leads/:id - Get lead by ID
// ============================================
router.get('/:id', requireLeadRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const lead = await leadService.findById(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            req.params.id
        );

        res.status(200).json({
            success: true,
            data: lead,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// PATCH /leads/:id - Update lead
// ============================================
router.patch('/:id', requireLeadUpdate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const dto: UpdateLeadDto = {
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            company: req.body.company,
            email: req.body.email,
            phone: req.body.phone,
            status: req.body.status,
            source: req.body.source,
            notes: req.body.notes,
        };

        const lead = await leadService.update(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            req.params.id,
            dto
        );

        res.status(200).json({
            success: true,
            data: lead,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// DELETE /leads/:id - Delete lead
// ============================================
router.delete('/:id', requireLeadDelete, async (req: Request, res: Response, next: NextFunction) => {
    try {
        await leadService.delete(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            req.params.id
        );

        res.status(200).json({
            success: true,
            message: 'Lead deleted successfully',
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// POST /leads/:id/convert - Convert lead
// ============================================
router.post('/:id/convert', requireLeadConvert, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const {
            createOpportunity,
            opportunityName,
            opportunityAmount,
            opportunityStage,
            opportunityCloseDate,
        } = req.body;

        const result = await leadService.convert(
            req.user!.orgId,
            req.user!.id,
            req.params.id,
            {
                createOpportunity: createOpportunity || false,
                opportunityName,
                opportunityAmount,
                opportunityStage,
                opportunityCloseDate: opportunityCloseDate ? new Date(opportunityCloseDate) : undefined,
            }
        );

        res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// POST /leads/import - Bulk import leads (placeholder)
// ============================================
router.post('/import', requireLeadCreate, (_req: Request, res: Response) => {
    res.status(501).json({
        success: false,
        error: {
            code: 'NOT_IMPLEMENTED',
            message: 'Bulk import not implemented yet'
        }
    });
});

// ============================================
// GET /leads/export - Export leads (CSV) (placeholder)
// ============================================
router.get('/export', requireLeadRead, (_req: Request, res: Response) => {
    res.status(501).json({
        success: false,
        error: {
            code: 'NOT_IMPLEMENTED',
            message: 'Export not implemented yet'
        }
    });
});

export default router;
