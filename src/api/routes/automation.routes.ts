import { Router, Request, Response, NextFunction } from 'express';
import * as automationService from '../../services/automation.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { Permission } from '../../core/rbac/types';

const router = Router();

router.use(authMiddleware);

const requireAutomationRead = requirePermission(Permission.AUTOMATION_READ);
const requireAutomationCreate = requirePermission(Permission.AUTOMATION_CREATE);
const requireAutomationExecute = requirePermission(Permission.AUTOMATION_EXECUTE);

// ============================================
// AUTOMATIONS
// ============================================

// GET /automations - List automations
router.get('/', requireAutomationRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { triggerType, isActive, page, limit } = req.query;

        const result = await automationService.getAutomations(req.user!.orgId, {
            triggerType: triggerType as any,
            isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
            page: page ? parseInt(page as string, 10) : 1,
            limit: limit ? parseInt(limit as string, 10) : 20,
        });

        res.json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error) {
        next(error);
    }
});

// POST /automations - Create automation
router.post('/', requireAutomationCreate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const automation = await automationService.createAutomation(
            req.user!.orgId,
            req.user!.id,
            req.body
        );
        res.status(201).json({ success: true, data: automation });
    } catch (error) {
        next(error);
    }
});

// GET /automations/:id - Get automation
router.get('/:id', requireAutomationRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const automation = await automationService.getAutomationById(req.user!.orgId, req.params.id);
        res.json({ success: true, data: automation });
    } catch (error) {
        next(error);
    }
});

// PUT /automations/:id - Update automation
router.put('/:id', requireAutomationCreate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const automation = await automationService.updateAutomation(req.user!.orgId, req.params.id, req.body);
        res.json({ success: true, data: automation });
    } catch (error) {
        next(error);
    }
});

// DELETE /automations/:id - Delete automation
router.delete('/:id', requireAutomationCreate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        await automationService.deleteAutomation(req.user!.orgId, req.params.id);
        res.json({ success: true, message: 'Automation deleted' });
    } catch (error) {
        next(error);
    }
});

// POST /automations/:id/execute - Execute automation manually
router.post('/:id/execute', requireAutomationExecute, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await automationService.executeAutomation(req.params.id, req.body.context || {});
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

// ============================================
// NATURAL LANGUAGE PARSING
// ============================================

// POST /automations/parse - Parse natural language to automation
router.post('/parse', requireAutomationCreate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = await automationService.parseAutomationFromNL(req.user!.orgId, req.body.text);
        res.json({ success: true, data: parsed });
    } catch (error) {
        next(error);
    }
});

export default router;
