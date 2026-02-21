import { Router, Request, Response, NextFunction } from 'express';
import { reportService, ReportFilters } from '../../services/report.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { Permission } from '../../core/rbac/types';

const router = Router();

// All report routes require authentication
router.use(authMiddleware);

// ============================================
// PIPELINE BY STAGE REPORT
// GET /api/v1/reports/pipeline
// ============================================
router.get(
    '/pipeline',
    requirePermission(Permission.REPORT_RUN),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { from, to, ownerId } = req.query;
            const user = req.user!;

            const filters: ReportFilters = {
                from: from as string | undefined,
                to: to as string | undefined,
                ownerId: ownerId as string | undefined,
            };

            const data = await reportService.getPipelineByStage(
                user.orgId,
                user.id,
                user.role,
                filters
            );

            // Check if CSV export is requested
            if (req.query.export === 'csv') {
                const headers = ['Stage', 'Count', 'Total Amount', 'Weighted Amount'];
                const csvData = data.map((item) => ({
                    stage: item.stageLabel,
                    count: item.count,
                    totalamount: item.totalAmount.toFixed(2),
                    weightedamount: item.weightedAmount.toFixed(2),
                }));

                const csv = reportService.exportToCSV(csvData, headers);

                res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                res.setHeader('Content-Disposition', 'attachment; filename=pipeline-by-stage.csv');
                res.send(csv);
                return;
            }

            res.json({
                success: true,
                data,
            });
        } catch (error) {
            next(error);
        }
    }
);

// ============================================
// WON VS LOST BY MONTH REPORT
// GET /api/v1/reports/won-lost
// ============================================
router.get(
    '/won-lost',
    requirePermission(Permission.REPORT_RUN),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { from, to, ownerId } = req.query;
            const user = req.user!;

            const filters: ReportFilters = {
                from: from as string | undefined,
                to: to as string | undefined,
                ownerId: ownerId as string | undefined,
            };

            const data = await reportService.getWonLostByMonth(
                user.orgId,
                user.id,
                user.role,
                filters
            );

            // Check if CSV export is requested
            if (req.query.export === 'csv') {
                const headers = ['Month', 'Year', 'Won Count', 'Won Amount', 'Lost Count', 'Lost Amount', 'Total Count'];
                const csvData = data.map((item) => ({
                    month: item.month,
                    year: item.year,
                    woncount: item.wonCount,
                    wonamount: item.wonAmount.toFixed(2),
                    lostcount: item.lostCount,
                    lostamount: item.lostAmount.toFixed(2),
                    totalcount: item.totalCount,
                }));

                const csv = reportService.exportToCSV(csvData, headers);

                res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                res.setHeader('Content-Disposition', 'attachment; filename=won-lost-by-month.csv');
                res.send(csv);
                return;
            }

            res.json({
                success: true,
                data,
            });
        } catch (error) {
            next(error);
        }
    }
);

// ============================================
// LEAD STATUS DISTRIBUTION REPORT
// GET /api/v1/reports/leads
// ============================================
router.get(
    '/leads',
    requirePermission(Permission.REPORT_RUN),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { from, to, ownerId } = req.query;
            const user = req.user!;

            const filters: ReportFilters = {
                from: from as string | undefined,
                to: to as string | undefined,
                ownerId: ownerId as string | undefined,
            };

            const data = await reportService.getLeadStatusDistribution(
                user.orgId,
                user.id,
                user.role,
                filters
            );

            // Check if CSV export is requested
            if (req.query.export === 'csv') {
                const headers = ['Status', 'Count', 'Percentage'];
                const csvData: Record<string, string | number>[] = data.statusDistribution.map((item) => ({
                    status: item.statusLabel,
                    count: item.count,
                    percentage: item.percentage.toFixed(2) + '%',
                }));

                // Add summary rows
                csvData.push({ status: '---', count: '', percentage: '' });
                csvData.push({ status: 'Total Leads', count: data.totalLeads, percentage: '' });
                csvData.push({ status: 'Converted Leads', count: data.convertedLeads, percentage: data.conversionRate.toFixed(2) + '%' });

                const csv = reportService.exportToCSV(csvData, headers);

                res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                res.setHeader('Content-Disposition', 'attachment; filename=lead-status-distribution.csv');
                res.send(csv);
                return;
            }

            res.json({
                success: true,
                data: {
                    totalLeads: data.totalLeads,
                    convertedLeads: data.convertedLeads,
                    conversionRate: data.conversionRate,
                    statusDistribution: data.statusDistribution,
                },
            });
        } catch (error) {
            next(error);
        }
    }
);

// ============================================
// ACTIVITIES BY USER AND TYPE REPORT
// GET /api/v1/reports/activities
// ============================================
router.get(
    '/activities',
    requirePermission(Permission.REPORT_RUN),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { from, to, ownerId } = req.query;
            const user = req.user!;

            const filters: ReportFilters = {
                from: from as string | undefined,
                to: to as string | undefined,
                ownerId: ownerId as string | undefined,
            };

            const data = await reportService.getActivitiesByUserAndType(
                user.orgId,
                user.id,
                user.role,
                filters
            );

            // Check if CSV export is requested
            if (req.query.export === 'csv') {
                const headers = ['User', 'Total Count'];
                const csvData: Record<string, string | number>[] = data.byUser.map((item) => ({
                    user: item.userName,
                    totalcount: item.totalCount,
                }));

                // Add type section
                csvData.push({ user: '---', totalcount: '' });
                csvData.push({ user: 'By Type', totalcount: '' });
                data.byType.forEach((typeItem) => {
                    csvData.push({ user: typeItem.typeLabel, totalcount: typeItem.count });
                });

                csvData.push({ user: '---', totalcount: '' });
                csvData.push({ user: 'Grand Total', totalcount: data.totalCount });

                const csv = reportService.exportToCSV(csvData, headers);

                res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                res.setHeader('Content-Disposition', 'attachment; filename=activities-by-user-type.csv');
                res.send(csv);
                return;
            }

            res.json({
                success: true,
                data: {
                    byUser: data.byUser,
                    byType: data.byType,
                    totalCount: data.totalCount,
                },
            });
        } catch (error) {
            next(error);
        }
    }
);

export default router;
