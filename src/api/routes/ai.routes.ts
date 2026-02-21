import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { nlqEngine, NLQUser } from '../../services/nlq.service';
import { salesAgent } from '../../services/sales-agent.service';
import { logger } from '../../shared/logger';

const router = Router();

// All AI routes require authentication
router.use(authMiddleware);

// ============================================
// POST /ai/query — Natural Language Query Engine
// ============================================
// Accepts any natural language CRM question and returns a structured response.
// Supports: data queries (SQL), CRM actions, AI analysis, daily brief, reports.
router.post('/query', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { query } = req.body;

        if (!query || typeof query !== 'string' || !query.trim()) {
            res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'query is required and must be a non-empty string' },
            });
            return;
        }

        // req.user only has id, email, orgId, role — derive name from email
        const emailName = req.user!.email.split('@')[0] ?? '';
        const user: NLQUser = {
            id: req.user!.id,
            firstName: emailName,
            lastName: '',
            email: req.user!.email,
            role: String(req.user!.role),
            orgId: req.user!.orgId,
        };

        const result = await nlqEngine.processQuery(query.trim(), user, req.user!.orgId);

        res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error) {
        logger.error('NLQ query error:', error);
        next(error);
    }
});

// ============================================
// POST /ai/analyze-deal — AI Deal Analysis
// ============================================
// Body: { deal, activities?, contacts? }
router.post('/analyze-deal', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { deal, activities = [], contacts = [] } = req.body;

        if (!deal || !deal.id) {
            res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'deal object with id is required' },
            });
            return;
        }

        const analysis = await salesAgent.analyzeDeal(deal, activities, contacts);

        res.status(200).json({
            success: true,
            data: analysis,
        });
    } catch (error) {
        logger.error('Deal analysis error:', error);
        next(error);
    }
});

// ============================================
// POST /ai/daily-review — Daily Pipeline Review
// ============================================
// Body: { deals }
router.post('/daily-review', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { deals = [] } = req.body;

        const review = await salesAgent.runDailyPipelineReview(req.user!.orgId, deals);

        res.status(200).json({
            success: true,
            data: review,
        });
    } catch (error) {
        logger.error('Daily pipeline review error:', error);
        next(error);
    }
});

// ============================================
// POST /ai/handle-stalled — Handle Stalled Deal
// ============================================
// Body: { deal, contacts?, lastActivity? }
router.post('/handle-stalled', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { deal, contacts = [], lastActivity = null } = req.body;

        if (!deal || !deal.id) {
            res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'deal object with id is required' },
            });
            return;
        }

        const action = await salesAgent.handleStalledDeal(deal, contacts, lastActivity);

        res.status(200).json({
            success: true,
            data: action,
        });
    } catch (error) {
        logger.error('Handle stalled deal error:', error);
        next(error);
    }
});

// ============================================
// POST /ai/outreach — Generate Personalized Outreach Email
// ============================================
// Body: { contact, company, repStyle?, campaignContext? }
router.post('/outreach', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const {
            contact,
            company,
            repStyle = { tone: 'professional', length: 'concise' },
            campaignContext = 'Cold outreach to introduce our CRM solution',
        } = req.body;

        if (!contact || !company) {
            res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'contact and company objects are required' },
            });
            return;
        }

        const email = await salesAgent.generatePersonalizedOutreach(contact, company, repStyle, campaignContext);

        res.status(200).json({
            success: true,
            data: email,
        });
    } catch (error) {
        logger.error('Outreach generation error:', error);
        next(error);
    }
});

export default router;
