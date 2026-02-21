import { Router, Request, Response, NextFunction } from 'express';
import { activityService, CreateActivityDto, UpdateActivityDto, ActivityFilters } from '../../services/activity.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { Permission } from '../../core/rbac/types';
import { ActivityType, RelatedToType } from '@prisma/client';

const router = Router();

// All activity routes require authentication
router.use(authMiddleware);

// RBAC middleware for activities
const requireActivityRead = requirePermission(Permission.ACTIVITY_READ);
const requireActivityCreate = requirePermission(Permission.ACTIVITY_CREATE);
const requireActivityUpdate = requirePermission(Permission.ACTIVITY_UPDATE);
const requireActivityDelete = requirePermission(Permission.ACTIVITY_DELETE);

// ============================================
// GET /activities - List activities (paginated, filtered)
// ============================================
router.get('/', requireActivityRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const {
            type,
            ownerId,
            relatedToType,
            relatedToId,
            from,
            to,
            sortBy,
            sortOrder,
            page,
            limit
        } = req.query;

        const filters: ActivityFilters = {
            type: type as ActivityType | undefined,
            ownerId: ownerId as string | undefined,
            relatedToType: relatedToType as RelatedToType | undefined,
            relatedToId: relatedToId as string | undefined,
            activityDateFrom: from ? new Date(from as string) : undefined,
            activityDateTo: to ? new Date(to as string) : undefined,
            sortBy: (sortBy as 'activityDate' | 'createdAt' | 'updatedAt') || 'activityDate',
            sortOrder: (sortOrder as 'asc' | 'desc') || 'desc',
            page: page ? parseInt(page as string, 10) : 1,
            limit: limit ? parseInt(limit as string, 10) : 20,
        };

        const result = await activityService.findAll(
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
// POST /activities - Create activity
// ============================================
router.post('/', requireActivityCreate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const dto: CreateActivityDto = {
            type: req.body.type,
            subject: req.body.subject,
            description: req.body.description,
            activityDate: new Date(req.body.activityDate),
            relatedToType: req.body.relatedToType,
            relatedToId: req.body.relatedToId,
            duration: req.body.duration,
            location: req.body.location,
            attendees: req.body.attendees,
        };

        const activity = await activityService.create(
            req.user!.orgId,
            req.user!.id,
            dto,
            req.user!.role
        );

        res.status(201).json({
            success: true,
            data: activity,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// GET /activities/:id - Get activity details
// ============================================
router.get('/:id', requireActivityRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const activity = await activityService.findById(
            req.user!.orgId,
            req.params.id,
            req.user!.id,
            req.user!.role
        );

        res.status(200).json({
            success: true,
            data: activity,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// PATCH /activities/:id - Update activity
// ============================================
router.patch('/:id', requireActivityUpdate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const dto: UpdateActivityDto = {
            type: req.body.type,
            subject: req.body.subject,
            description: req.body.description,
            activityDate: req.body.activityDate ? new Date(req.body.activityDate) : undefined,
            duration: req.body.duration,
            location: req.body.location,
            attendees: req.body.attendees,
        };

        const activity = await activityService.update(
            req.user!.orgId,
            req.params.id,
            req.user!.id,
            req.user!.role,
            dto
        );

        res.status(200).json({
            success: true,
            data: activity,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// DELETE /activities/:id - Delete activity
// ============================================
router.delete('/:id', requireActivityDelete, async (req: Request, res: Response, next: NextFunction) => {
    try {
        await activityService.delete(
            req.user!.orgId,
            req.params.id,
            req.user!.id,
            req.user!.role
        );

        res.status(200).json({
            success: true,
            message: 'Activity deleted successfully',
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// GET /activities/related/:type/:id - Get activities for a related record (timeline)
// ============================================
router.get('/related/:type/:id', requireActivityRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { type, id } = req.params;
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

        const activities = await activityService.getTimeline(
            req.user!.orgId,
            type as RelatedToType,
            id,
            req.user!.id,
            req.user!.role,
            limit
        );

        res.status(200).json({
            success: true,
            data: activities,
        });
    } catch (error) {
        next(error);
    }
});

export default router;
