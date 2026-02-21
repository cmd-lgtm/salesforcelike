import { Router, Request, Response, NextFunction } from 'express';
import { taskService, CreateTaskDto, UpdateTaskDto, TaskFilters } from '../../services/task.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { Permission } from '../../core/rbac/types';
import { TaskStatus, TaskPriority, RelatedToType } from '@prisma/client';

const router = Router();

// All task routes require authentication
router.use(authMiddleware);

// RBAC middleware for tasks
const requireTaskRead = requirePermission(Permission.TASK_READ);
const requireTaskCreate = requirePermission(Permission.TASK_CREATE);
const requireTaskUpdate = requirePermission(Permission.TASK_UPDATE);
const requireTaskDelete = requirePermission(Permission.TASK_DELETE);
const requireTaskComplete = requirePermission(Permission.TASK_COMPLETE);

// ============================================
// GET /tasks - List tasks (paginated, filtered)
// ============================================
router.get('/', requireTaskRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const {
            status,
            priority,
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

        const filters: TaskFilters = {
            status: status as TaskStatus | undefined,
            priority: priority as TaskPriority | undefined,
            ownerId: ownerId as string | undefined,
            relatedToType: relatedToType as RelatedToType | undefined,
            relatedToId: relatedToId as string | undefined,
            dueDateFrom: from ? new Date(from as string) : undefined,
            dueDateTo: to ? new Date(to as string) : undefined,
            sortBy: (sortBy as 'dueDate' | 'createdAt' | 'updatedAt' | 'priority') || 'dueDate',
            sortOrder: (sortOrder as 'asc' | 'desc') || 'asc',
            page: page ? parseInt(page as string, 10) : 1,
            limit: limit ? parseInt(limit as string, 10) : 20,
        };

        const result = await taskService.findAll(
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
// POST /tasks - Create task
// ============================================
router.post('/', requireTaskCreate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const dto: CreateTaskDto = {
            subject: req.body.subject,
            description: req.body.description,
            dueDate: req.body.dueDate ? new Date(req.body.dueDate) : undefined,
            status: req.body.status,
            priority: req.body.priority,
            relatedToType: req.body.relatedToType,
            relatedToId: req.body.relatedToId,
        };

        const task = await taskService.create(
            req.user!.orgId,
            req.user!.id,
            dto,
            req.user!.role
        );

        res.status(201).json({
            success: true,
            data: task,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// GET /tasks/:id - Get task details
// ============================================
router.get('/:id', requireTaskRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const task = await taskService.findById(
            req.user!.orgId,
            req.params.id,
            req.user!.id,
            req.user!.role
        );

        res.status(200).json({
            success: true,
            data: task,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// PATCH /tasks/:id - Update task
// ============================================
router.patch('/:id', requireTaskUpdate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const dto: UpdateTaskDto = {
            subject: req.body.subject,
            description: req.body.description,
            dueDate: req.body.dueDate !== undefined ? (req.body.dueDate ? new Date(req.body.dueDate) : null) : undefined,
            status: req.body.status,
            priority: req.body.priority,
        };

        const task = await taskService.update(
            req.user!.orgId,
            req.params.id,
            req.user!.id,
            req.user!.role,
            dto
        );

        res.status(200).json({
            success: true,
            data: task,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// DELETE /tasks/:id - Delete task
// ============================================
router.delete('/:id', requireTaskDelete, async (req: Request, res: Response, next: NextFunction) => {
    try {
        await taskService.delete(
            req.user!.orgId,
            req.params.id,
            req.user!.id,
            req.user!.role
        );

        res.status(200).json({
            success: true,
            message: 'Task deleted successfully',
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// PATCH /tasks/:id/complete - Mark task complete
// ============================================
router.patch('/:id/complete', requireTaskComplete, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const task = await taskService.markComplete(
            req.user!.orgId,
            req.params.id,
            req.user!.id,
            req.user!.role
        );

        res.status(200).json({
            success: true,
            data: task,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// PATCH /tasks/:id/reopen - Reopen task
// ============================================
router.patch('/:id/reopen', requireTaskUpdate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const task = await taskService.reopen(
            req.user!.orgId,
            req.params.id,
            req.user!.id,
            req.user!.role
        );

        res.status(200).json({
            success: true,
            data: task,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// GET /tasks/related/:type/:id - Get tasks for a related record
// ============================================
router.get('/related/:type/:id', requireTaskRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { type, id } = req.params;
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

        const tasks = await taskService.getTasksForRelated(
            req.user!.orgId,
            type as RelatedToType,
            id,
            req.user!.id,
            req.user!.role,
            limit
        );

        res.status(200).json({
            success: true,
            data: tasks,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// GET /tasks/overdue - Get overdue tasks
// ============================================
router.get('/overdue', requireTaskRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tasks = await taskService.getOverdueTasks(
            req.user!.orgId,
            req.user!.id,
            req.user!.role
        );

        res.status(200).json({
            success: true,
            data: tasks,
        });
    } catch (error) {
        next(error);
    }
});

export default router;
