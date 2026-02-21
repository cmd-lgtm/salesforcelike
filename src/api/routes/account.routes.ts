import { Router, Request, Response, NextFunction } from 'express';
import { accountService, CreateAccountDto, UpdateAccountDto, AccountFilters } from '../../services/account.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireAccountRead, requireAccountCreate, requireAccountUpdate, requireAccountDelete } from '../middleware/rbac.middleware';
import { Industry } from '@prisma/client';

const router = Router();

// All account routes require authentication
router.use(authMiddleware);

// ============================================
// GET /accounts - List accounts (paginated, filtered, searchable)
// ============================================
router.get('/', requireAccountRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const {
            industry,
            ownerId,
            search,
            sortBy,
            sortOrder,
            page,
            limit
        } = req.query;

        const filters: AccountFilters = {
            industry: industry as Industry | undefined,
            ownerId: ownerId as string | undefined,
            search: search as string | undefined,
            sortBy: (sortBy as 'createdAt' | 'updatedAt' | 'name') || 'createdAt',
            sortOrder: (sortOrder as 'asc' | 'desc') || 'desc',
            page: page ? parseInt(page as string, 10) : 1,
            limit: limit ? parseInt(limit as string, 10) : 20,
        };

        const result = await accountService.findAll(
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
// GET /accounts/search - Search accounts (free-text)
// ============================================
router.get('/search', requireAccountRead, async (req: Request, res: Response, next: NextFunction): Promise<any> => {
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

        const accounts = await accountService.search(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            q,
            limit ? parseInt(limit as string, 10) : 20
        );

        return res.status(200).json({
            success: true,
            data: accounts,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// POST /accounts - Create account
// ============================================
router.post('/', requireAccountCreate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const dto: CreateAccountDto = req.body;

        const account = await accountService.create(
            req.user!.orgId,
            req.user!.id,
            dto,
            req.user!.role
        );

        res.status(201).json({
            success: true,
            data: account,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// GET /accounts/:id - Get account details
// ============================================
router.get('/:id', requireAccountRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        const account = await accountService.findById(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            id
        );

        res.status(200).json({
            success: true,
            data: account,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// PATCH /accounts/:id - Update account
// ============================================
router.patch('/:id', requireAccountUpdate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const dto: UpdateAccountDto = req.body;

        const account = await accountService.update(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            id,
            dto
        );

        res.status(200).json({
            success: true,
            data: account,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// DELETE /accounts/:id - Delete account
// ============================================
router.delete('/:id', requireAccountDelete, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        await accountService.delete(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            id
        );

        res.status(200).json({
            success: true,
            message: 'Account deleted successfully',
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// GET /accounts/:id/contacts - Get account contacts
// ============================================
router.get('/:id/contacts', requireAccountRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        const contacts = await accountService.getContacts(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            id
        );

        res.status(200).json({
            success: true,
            data: contacts,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// GET /accounts/:id/opportunities - Get account opportunities
// ============================================
router.get('/:id/opportunities', requireAccountRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        const opportunities = await accountService.getOpportunities(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            id
        );

        res.status(200).json({
            success: true,
            data: opportunities,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// POST /accounts/import - Bulk import accounts (stub)
// ============================================
router.post('/import', requireAccountCreate, async (_req: Request, res: Response, next: NextFunction) => {
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
// GET /accounts/export - Export accounts (CSV) (stub)
// ============================================
router.get('/export', requireAccountRead, async (_req: Request, res: Response, next: NextFunction) => {
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
