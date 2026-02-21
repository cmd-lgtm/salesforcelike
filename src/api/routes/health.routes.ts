import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { healthMonitor } from '../../services/health-monitor.service';
import { selfHealer, Incident } from '../../services/self-healer.service';
import { logger } from '../../shared/logger';

const router = Router();

// ============================================
// GET /health/status — Full System Health Check
// ============================================
// Public endpoint (no auth) — used by dashboard, load balancers, and uptime monitors.
router.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
    try {
        const health = await healthMonitor.runHealthCheck();

        // Determine HTTP status code from health
        const httpCode = health.overall_status === 'healthy' ? 200
            : health.overall_status === 'warning' ? 200
                : health.overall_status === 'degraded' ? 200
                    : 503; // critical → service unavailable

        res.status(httpCode).json({
            success: true,
            data: health,
        });
    } catch (error) {
        logger.error('Health check error:', error);
        next(error);
    }
});

// ============================================
// GET /health/incidents — Get Incident History
// ============================================
// Protected — returns recent auto-healing history.
router.get('/incidents', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const limit = parseInt(req.query.limit as string || '20', 10);
        const incidents = selfHealer.getHistory(Math.min(limit, 100));

        res.status(200).json({
            success: true,
            data: {
                incidents,
                total: incidents.length,
            },
        });
    } catch (error) {
        logger.error('Get incidents error:', error);
        next(error);
    }
});

// ============================================
// POST /health/heal — Manually Trigger Healing
// ============================================
// Protected (admin) — manually trigger healing for a known incident.
// Body: { incident }
router.post('/heal', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { incident } = req.body as { incident: Incident };

        if (!incident || !incident.id || !incident.title) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'incident with id and title is required',
                },
            });
            return;
        }

        logger.info(`Manual healing triggered by user ${req.user!.id} for incident: ${incident.id}`);
        const result = await selfHealer.heal(incident);

        res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error) {
        logger.error('Manual healing error:', error);
        next(error);
    }
});

// ============================================
// GET /health/history — Get Health Score History
// ============================================
// Returns time-series of health scores (for charts).
router.get('/history', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const limit = parseInt(req.query.limit as string || '50', 10);
        const history = healthMonitor.getHistory(Math.min(limit, 200));

        // Return lightweight version (no full details) for charting
        const series = history.map(h => ({
            timestamp: h.timestamp,
            overall_score: h.overall_score,
            overall_status: h.overall_status,
            cpu: h.infrastructure.cpu.usage_percent,
            memory: h.infrastructure.memory.usage_percent,
            db_latency: h.database?.latency_ms,
            alerts_count: h.alerts.length,
        }));

        res.status(200).json({
            success: true,
            data: { series },
        });
    } catch (error) {
        logger.error('Health history error:', error);
        next(error);
    }
});

export default router;
