import { Router, Request, Response, NextFunction } from 'express';
import {
    opportunityService,
    CreateOpportunityDto,
    UpdateOpportunityDto,
    UpdateStageDto,
    OpportunityFilters,
} from '../../services/opportunity.service';
import { authMiddleware } from '../middleware/auth.middleware';
import {
    requireOpportunityRead,
    requireOpportunityCreate,
    requireOpportunityUpdate,
    requireOpportunityDelete,
    requireOpportunityChangeStage,
} from '../middleware/rbac.middleware';
import { OpportunityStage } from '@prisma/client';

const router = Router();

// All opportunity routes require authentication
router.use(authMiddleware);

// ============================================
// GET /opportunities - List opportunities (paginated, filtered)
// ============================================
router.get('/', requireOpportunityRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
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
            sortBy,
            sortOrder,
            page,
            limit,
        } = req.query;

        const filters: OpportunityFilters = {
            stage: stage as OpportunityStage | undefined,
            ownerId: ownerId as string | undefined,
            accountId: accountId as string | undefined,
            contactId: contactId as string | undefined,
            closeDateFrom: closeDateFrom as string | undefined,
            closeDateTo: closeDateTo as string | undefined,
            search: search as string | undefined,
            minAmount: minAmount ? parseFloat(minAmount as string) : undefined,
            maxAmount: maxAmount ? parseFloat(maxAmount as string) : undefined,
            sortBy: (sortBy as 'createdAt' | 'updatedAt' | 'name' | 'amount' | 'closeDate' | 'stage') || 'createdAt',
            sortOrder: (sortOrder as 'asc' | 'desc') || 'desc',
            page: page ? parseInt(page as string, 10) : 1,
            limit: limit ? parseInt(limit as string, 10) : 20,
        };

        const result = await opportunityService.findAll(
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
// GET /opportunities/kanban - Get Kanban board view
// ============================================
router.get('/kanban', requireOpportunityRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { ownerId, closeDateFrom, closeDateTo, stagePage, stageLimit } = req.query;

        const result = await opportunityService.getKanbanBoard(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            {
                ownerId: ownerId as string | undefined,
                closeDateFrom: closeDateFrom as string | undefined,
                closeDateTo: closeDateTo as string | undefined,
                stagePage: stagePage ? parseInt(stagePage as string, 10) : 1,
                stageLimit: stageLimit ? Math.min(parseInt(stageLimit as string, 10), 100) : 50,
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
// GET /opportunities/pipeline - Get pipeline metrics
// ============================================
router.get('/pipeline', requireOpportunityRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { ownerId, closeDateFrom, closeDateTo } = req.query;

        const result = await opportunityService.getPipelineMetrics(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            {
                ownerId: ownerId as string | undefined,
                closeDateFrom: closeDateFrom as string | undefined,
                closeDateTo: closeDateTo as string | undefined,
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
// POST /opportunities - Create opportunity
// ============================================
router.post('/', requireOpportunityCreate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const dto: CreateOpportunityDto = req.body;

        // Validate required fields
        if (!dto.name || !dto.closeDate) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Name and close date are required',
                },
            });
            return;
        }

        const opportunity = await opportunityService.create(
            req.user!.orgId,
            req.user!.id,
            dto,
            req.user!.role
        );

        res.status(201).json({
            success: true,
            data: opportunity,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// GET /opportunities/:id - Get opportunity by ID
// ============================================
router.get('/:id', requireOpportunityRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        const opportunity = await opportunityService.findById(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            id
        );

        res.status(200).json({
            success: true,
            data: opportunity,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// PATCH /opportunities/:id - Update opportunity
// ============================================
router.patch('/:id', requireOpportunityUpdate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const dto: UpdateOpportunityDto = req.body;

        const opportunity = await opportunityService.update(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            id,
            dto
        );

        res.status(200).json({
            success: true,
            data: opportunity,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// PATCH /opportunities/:id/stage - Update stage (for Kanban drag-and-drop)
// ============================================
router.patch('/:id/stage', requireOpportunityChangeStage, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const dto: UpdateStageDto = req.body;

        if (!dto.stage) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Stage is required',
                },
            });
            return;
        }

        const opportunity = await opportunityService.updateStage(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            id,
            dto
        );

        res.status(200).json({
            success: true,
            data: opportunity,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// DELETE /opportunities/:id - Delete opportunity
// ============================================
router.delete('/:id', requireOpportunityDelete, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        await opportunityService.delete(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            id
        );

        res.status(204).send();
    } catch (error) {
        next(error);
    }
});

// ============================================
// POST /opportunities/import - Bulk import (stub)
// ============================================
router.post('/import', requireOpportunityCreate, async (_req: Request, res: Response, next: NextFunction) => {
    try {
        res.status(501).json({
            success: false,
            error: {
                code: 'NOT_IMPLEMENTED',
                message: 'Bulk import not yet implemented',
            },
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// GET /opportunities/export - Export (CSV) (stub)
// ============================================
router.get('/export', requireOpportunityRead, async (_req: Request, res: Response, next: NextFunction) => {
    try {
        res.status(501).json({
            success: false,
            error: {
                code: 'NOT_IMPLEMENTED',
                message: 'Export not yet implemented',
            },
        });
    } catch (error) {
        next(error);
    }
});

export default router;
