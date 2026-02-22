import { Router, Request, Response, NextFunction } from 'express';
import * as emailService from '../../services/email.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { Permission } from '../../core/rbac/types';

const router = Router();

router.use(authMiddleware);

const requireEmailRead = requirePermission(Permission.EMAIL_READ);
const requireEmailCreate = requirePermission(Permission.EMAIL_CREATE);
const requireEmailSend = requirePermission(Permission.EMAIL_SEND);

// ============================================
// EMAIL TEMPLATES
// ============================================

// GET /email/templates - List templates
router.get('/templates', requireEmailRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { category, aiGenerated, page, limit } = req.query;

        const result = await emailService.getEmailTemplates(req.user!.orgId, {
            category: category as any,
            aiGenerated: aiGenerated === 'true' ? true : aiGenerated === 'false' ? false : undefined,
            page: page ? parseInt(page as string, 10) : 1,
            limit: limit ? parseInt(limit as string, 10) : 20,
        });

        res.json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error) {
        next(error);
    }
});

// POST /email/templates - Create template
router.post('/templates', requireEmailCreate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const template = await emailService.createEmailTemplate(
            req.user!.orgId,
            req.user!.id,
            req.body
        );
        res.status(201).json({ success: true, data: template });
    } catch (error) {
        next(error);
    }
});

// GET /email/templates/:id - Get template
router.get('/templates/:id', requireEmailRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const template = await emailService.getEmailTemplateById(req.user!.orgId, req.params.id);
        res.json({ success: true, data: template });
    } catch (error) {
        next(error);
    }
});

// PUT /email/templates/:id - Update template
router.put('/templates/:id', requireEmailCreate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const template = await emailService.updateEmailTemplate(req.user!.orgId, req.params.id, req.body);
        res.json({ success: true, data: template });
    } catch (error) {
        next(error);
    }
});

// DELETE /email/templates/:id - Delete template
router.delete('/templates/:id', requireEmailCreate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        await emailService.deleteEmailTemplate(req.user!.orgId, req.params.id);
        res.json({ success: true, message: 'Template deleted' });
    } catch (error) {
        next(error);
    }
});

// ============================================
// EMAIL SEQUENCES
// ============================================

// GET /email/sequences - List sequences
router.get('/sequences', requireEmailRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { status, page, limit } = req.query;

        const result = await emailService.getEmailSequences(req.user!.orgId, {
            status: status as any,
            page: page ? parseInt(page as string, 10) : 1,
            limit: limit ? parseInt(limit as string, 10) : 20,
        });

        res.json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error) {
        next(error);
    }
});

// POST /email/sequences - Create sequence
router.post('/sequences', requireEmailCreate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const sequence = await emailService.createEmailSequence(req.user!.orgId, req.user!.id, req.body);
        res.status(201).json({ success: true, data: sequence });
    } catch (error) {
        next(error);
    }
});

// GET /email/sequences/:id - Get sequence
router.get('/sequences/:id', requireEmailRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const sequence = await emailService.getEmailSequenceById(req.user!.orgId, req.params.id);
        res.json({ success: true, data: sequence });
    } catch (error) {
        next(error);
    }
});

// PUT /email/sequences/:id - Update sequence
router.put('/sequences/:id', requireEmailCreate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const sequence = await emailService.updateEmailSequence(req.user!.orgId, req.params.id, req.body);
        res.json({ success: true, data: sequence });
    } catch (error) {
        next(error);
    }
});

// DELETE /email/sequences/:id - Delete sequence
router.delete('/sequences/:id', requireEmailCreate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        await emailService.deleteEmailSequence(req.user!.orgId, req.params.id);
        res.json({ success: true, message: 'Sequence deleted' });
    } catch (error) {
        next(error);
    }
});

// ============================================
// SEQUENCE STEPS
// ============================================

// POST /email/sequences/:id/steps - Add step
router.post('/sequences/:id/steps', requireEmailCreate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const step = await emailService.addSequenceStep(req.user!.orgId, req.params.id, req.body);
        res.status(201).json({ success: true, data: step });
    } catch (error) {
        next(error);
    }
});

// PUT /email/steps/:id - Update step
router.put('/steps/:id', requireEmailCreate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const step = await emailService.updateSequenceStep(req.user!.orgId, req.params.id, req.body);
        res.json({ success: true, data: step });
    } catch (error) {
        next(error);
    }
});

// DELETE /email/steps/:id - Delete step
router.delete('/steps/:id', requireEmailCreate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        await emailService.deleteSequenceStep(req.user!.orgId, req.params.id);
        res.json({ success: true, message: 'Step deleted' });
    } catch (error) {
        next(error);
    }
});

// ============================================
// AI EMAIL GENERATION
// ============================================

// POST /email/generate - Generate email with AI
router.post('/generate', requireEmailSend, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const email = await emailService.generateEmailWithAI(req.user!.orgId, req.body);
        res.json({ success: true, data: email });
    } catch (error) {
        next(error);
    }
});

export default router;
