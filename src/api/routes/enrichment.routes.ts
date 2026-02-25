import { Router, Request, Response, NextFunction } from 'express';
import { enrichCompany, enrichContact, autoEnrichCompany, autoEnrichContact, batchEnrich, findDuplicateContacts, mergeContacts } from '../../services/enrichment.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { Permission } from '../../core/rbac/types';

const router = Router();

router.use(authMiddleware);

const requireEnrichmentRun = requirePermission(Permission.ENRICHMENT_RUN);

// ============================================
// ENRICHMENT
// ============================================

// POST /enrichment/company - Enrich company by domain
router.post('/company', requireEnrichmentRun, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { domain } = req.body;

        if (!domain) {
            return res.status(400).json({ success: false, error: 'Domain is required' });
        }

        const data = await enrichCompany(req.user!.orgId, domain);
        res.json({ success: true, data });
        return;
    } catch (error) {
        next(error);
    }
});

// POST /enrichment/contact - Enrich contact by email
router.post('/contact', requireEnrichmentRun, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }

        const data = await enrichContact(req.user!.orgId, email);
        res.json({ success: true, data });
        return;
    } catch (error) {
        next(error);
    }
});

// POST /enrichment/company/:id - Auto-enrich company in database
router.post('/company/:id', requireEnrichmentRun, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const company = await autoEnrichCompany(req.user!.orgId, req.params.id);
        res.json({ success: true, data: company });
    } catch (error) {
        next(error);
    }
});

// POST /enrichment/contact/:id - Auto-enrich contact in database
router.post('/contact/:id', requireEnrichmentRun, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const contact = await autoEnrichContact(req.user!.orgId, req.params.id);
        res.json({ success: true, data: contact });
    } catch (error) {
        next(error);
    }
});

// POST /enrichment/batch - Batch enrichment
router.post('/batch', requireEnrichmentRun, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { type, ids } = req.body;

        if (!type || !ids || !Array.isArray(ids)) {
            return res.status(400).json({ success: false, error: 'Type and ids array are required' });
        }

        const results = await batchEnrich(req.user!.orgId, type, ids);
        res.json({ success: true, data: results });
        return;
    } catch (error) {
        next(error);
    }
});

// ============================================
// DATA QUALITY
// ============================================

// GET /enrichment/duplicates - Find duplicate contacts
router.get('/duplicates', requireEnrichmentRun, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const duplicates = await findDuplicateContacts(req.user!.orgId);
        res.json({ success: true, data: duplicates });
        return;
    } catch (error) {
        next(error);
    }
});

// POST /enrichment/merge - Merge duplicate contacts
router.post('/merge', requireEnrichmentRun, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { primaryId, secondaryIds } = req.body;

        if (!primaryId || !secondaryIds || !Array.isArray(secondaryIds)) {
            return res.status(400).json({ success: false, error: 'Primary ID and secondary IDs array are required' });
        }

        const result = await mergeContacts(req.user!.orgId, primaryId, secondaryIds);
        res.json({ success: true, data: result });
        return;
    } catch (error) {
        next(error);
    }
});

export default router;
