import { Router, Request, Response, NextFunction } from 'express';
import * as analyticsService from '../../services/analytics.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { Permission } from '../../core/rbac/types';

const router = Router();

router.use(authMiddleware);

const requireAnalyticsRead = requirePermission(Permission.ANALYTICS_READ);
const requireForecastRead = requirePermission(Permission.FORECAST_READ);

// ============================================
// DASHBOARD
// ============================================

// GET /analytics/dashboard - Get dashboard metrics
router.get('/dashboard', requireAnalyticsRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { from, to } = req.query;

        const metrics = await analyticsService.getDashboardMetrics(
            req.user!.orgId,
            from ? new Date(from as string) : undefined,
            to ? new Date(to as string) : undefined
        );

        res.json({ success: true, data: metrics });
    } catch (error) {
        next(error);
    }
});

// GET /analytics/pipeline - Get pipeline analytics
router.get('/pipeline', requireAnalyticsRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const analytics = await analyticsService.getPipelineAnalytics(req.user!.orgId);
        res.json({ success: true, data: analytics });
    } catch (error) {
        next(error);
    }
});

// GET /analytics/rep-performance - Get rep performance
router.get('/rep-performance', requireAnalyticsRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { from, to } = req.query;

        const performance = await analyticsService.getRepPerformance(
            req.user!.orgId,
            from ? new Date(from as string) : undefined,
            to ? new Date(to as string) : undefined
        );

        res.json({ success: true, data: performance });
    } catch (error) {
        next(error);
    }
});

// ============================================
// REVENUE FORECASTS
// ============================================

// GET /forecasts - List forecasts
router.get('/forecasts', requireForecastRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { forecastPeriod, forecastType, page, limit } = req.query;

        const result = await analyticsService.getForecasts(req.user!.orgId, {
            forecastPeriod: forecastPeriod as string,
            forecastType: forecastType as any,
            page: page ? parseInt(page as string, 10) : 1,
            limit: limit ? parseInt(limit as string, 10) : 20,
        });

        res.json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error) {
        next(error);
    }
});

// POST /forecasts - Create forecast
router.post('/forecasts', requireForecastRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const forecast = await analyticsService.createForecast(
            req.user!.orgId,
            req.user!.id,
            req.body
        );
        res.status(201).json({ success: true, data: forecast });
    } catch (error) {
        next(error);
    }
});

// GET /forecasts/:id - Get forecast
router.get('/forecasts/:id', requireForecastRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const forecast = await analyticsService.getForecastById(req.user!.orgId, req.params.id);
        res.json({ success: true, data: forecast });
    } catch (error) {
        next(error);
    }
});

// PUT /forecasts/:id - Update forecast
router.put('/forecasts/:id', requireForecastRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const forecast = await analyticsService.updateForecast(req.user!.orgId, req.params.id, req.body);
        res.json({ success: true, data: forecast });
    } catch (error) {
        next(error);
    }
});

export default router;
