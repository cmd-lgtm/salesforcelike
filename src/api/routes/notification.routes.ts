import { Router, Request, Response, NextFunction } from 'express';
import * as notificationService from '../../services/notification.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { Permission } from '../../core/rbac/types';
import { prisma } from '../../config/database';

const router = Router();

router.use(authMiddleware);

const requireNotificationSend = requirePermission(Permission.NOTIFICATION_SEND);
const requireNotificationRead = requirePermission(Permission.NOTIFICATION_READ);

// ============================================
// NOTIFICATIONS
// ============================================

// POST /notifications/send - Send notification
router.post('/send', requireNotificationSend, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await notificationService.sendNotification(req.user!.orgId, {
            userId: req.body.userId,
            email: req.body.email,
            phone: req.body.phone,
            title: req.body.title,
            message: req.body.message,
            channels: req.body.channels || ['IN_APP'],
            priority: req.body.priority,
            scheduledAt: req.body.scheduledAt ? new Date(req.body.scheduledAt) : undefined,
            expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : undefined,
            entityType: req.body.entityType,
            entityId: req.body.entityId,
            actionUrl: req.body.actionUrl,
        });

        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

// GET /notifications - List notifications for current user
router.get('/', requireNotificationRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { page = 1, limit = 20, unread } = req.query;

        const where: any = {
            orgId: req.user!.orgId,
            userId: req.user!.id,
        };

        if (unread === 'true') {
            where.status = { in: ['PENDING', 'SENT', 'DELIVERED'] };
        }

        const [notifications, total] = await Promise.all([
            prisma.notification.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (Number(page) - 1) * Number(limit),
                take: Number(limit),
            }),
            prisma.notification.count({ where }),
        ]);

        res.json({
            success: true,
            data: notifications,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                totalPages: Math.ceil(total / Number(limit)),
            },
        });
    } catch (error) {
        next(error);
    }
});

// GET /notifications/:id - Get notification
router.get('/:id', requireNotificationRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const notification = await prisma.notification.findFirst({
            where: { id: req.params.id, orgId: req.user!.orgId },
        });

        if (!notification) {
            return res.status(404).json({ success: false, error: 'Notification not found' });
        }

        res.json({ success: true, data: notification });
    } catch (error) {
        next(error);
    }
});

// PATCH /notifications/:id/read - Mark as read
router.patch('/:id/read', requireNotificationRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const notification = await prisma.notification.findFirst({
            where: { id: req.params.id, orgId: req.user!.orgId },
        });

        if (!notification) {
            return res.status(404).json({ success: false, error: 'Notification not found' });
        }

        const updated = await prisma.notification.update({
            where: { id: req.params.id },
            data: { status: 'READ' },
        });

        res.json({ success: true, data: updated });
    } catch (error) {
        next(error);
    }
});

// POST /notifications/mark-all-read - Mark all as read
router.post('/mark-all-read', requireNotificationRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        await prisma.notification.updateMany({
            where: {
                orgId: req.user!.orgId,
                userId: req.user!.id,
                status: { in: ['PENDING', 'SENT', 'DELIVERED'] },
            },
            data: { status: 'READ' },
        });

        res.json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
        next(error);
    }
});

// DELETE /notifications/:id - Delete notification
router.delete('/:id', requireNotificationRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        await prisma.notification.delete({
            where: { id: req.params.id },
        });

        res.json({ success: true, message: 'Notification deleted' });
    } catch (error) {
        next(error);
    }
});

// ============================================
// PREFERENCES
// ============================================

// GET /notifications/preferences - Get notification preferences
router.get('/preferences', requireNotificationRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const prefs = await notificationService.getNotificationPreferences(
            req.user!.orgId,
            req.user!.id
        );
        res.json({ success: true, data: prefs });
    } catch (error) {
        next(error);
    }
});

// PUT /notifications/preferences - Update notification preferences
router.put('/preferences', requireNotificationRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const prefs = await notificationService.updateNotificationPreferences(
            req.user!.orgId,
            req.user!.id,
            req.body
        );
        res.json({ success: true, data: prefs });
    } catch (error) {
        next(error);
    }
});

export default router;
