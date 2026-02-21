import { Router, Request, Response, NextFunction } from 'express';
import { contactService, CreateContactDto, UpdateContactDto, ContactFilters } from '../../services/contact.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireContactRead, requireContactCreate, requireContactUpdate, requireContactDelete } from '../middleware/rbac.middleware';

const router = Router();

// All contact routes require authentication
router.use(authMiddleware);

// ============================================
// GET /contacts - List contacts (paginated, filtered, searchable)
// ============================================
router.get('/', requireContactRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const {
            accountId,
            ownerId,
            search,
            sortBy,
            sortOrder,
            page,
            limit
        } = req.query;

        const filters: ContactFilters = {
            accountId: accountId as string | undefined,
            ownerId: ownerId as string | undefined,
            search: search as string | undefined,
            sortBy: (sortBy as 'createdAt' | 'updatedAt' | 'lastName' | 'firstName') || 'createdAt',
            sortOrder: (sortOrder as 'asc' | 'desc') || 'desc',
            page: page ? parseInt(page as string, 10) : 1,
            limit: limit ? parseInt(limit as string, 10) : 20,
        };

        const result = await contactService.findAll(
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
// GET /contacts/search - Search contacts (free-text)
// ============================================
router.get('/search', requireContactRead, async (req: Request, res: Response, next: NextFunction): Promise<any> => {
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

        const contacts = await contactService.search(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            q,
            limit ? parseInt(limit as string, 10) : 20
        );

        return res.status(200).json({
            success: true,
            data: contacts,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// POST /contacts - Create contact
// ============================================
router.post('/', requireContactCreate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const dto: CreateContactDto = req.body;

        const contact = await contactService.create(
            req.user!.orgId,
            req.user!.id,
            dto,
            req.user!.role
        );

        res.status(201).json({
            success: true,
            data: contact,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// GET /contacts/:id - Get contact details
// ============================================
router.get('/:id', requireContactRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        const contact = await contactService.findById(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            id
        );

        res.status(200).json({
            success: true,
            data: contact,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// PATCH /contacts/:id - Update contact
// ============================================
router.patch('/:id', requireContactUpdate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const dto: UpdateContactDto = req.body;

        const contact = await contactService.update(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            id,
            dto
        );

        res.status(200).json({
            success: true,
            data: contact,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// DELETE /contacts/:id - Delete contact
// ============================================
router.delete('/:id', requireContactDelete, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        await contactService.delete(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            id
        );

        res.status(200).json({
            success: true,
            message: 'Contact deleted successfully',
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// PATCH /contacts/:id/link - Link contact to account
// ============================================
router.patch('/:id/link', requireContactUpdate, async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const { id } = req.params;
        const { accountId } = req.body;

        if (!accountId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'accountId is required',
                },
            });
        }

        const contact = await contactService.linkToAccount(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            id,
            accountId
        );

        return res.status(200).json({
            success: true,
            data: contact,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// PATCH /contacts/:id/unlink - Unlink contact from account
// ============================================
router.patch('/:id/unlink', requireContactUpdate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        const contact = await contactService.unlinkFromAccount(
            req.user!.orgId,
            req.user!.id,
            req.user!.role,
            id
        );

        res.status(200).json({
            success: true,
            data: contact,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// POST /contacts/import - Bulk import contacts (stub)
// ============================================
router.post('/import', requireContactCreate, async (_req: Request, res: Response, next: NextFunction) => {
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
// GET /contacts/export - Export contacts (CSV) (stub)
// ============================================
router.get('/export', requireContactRead, async (_req: Request, res: Response, next: NextFunction) => {
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
