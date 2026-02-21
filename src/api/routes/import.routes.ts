import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { importService, ImportEntity } from '../../services/import.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireLeadCreate, requireAccountCreate, requireContactCreate, requireOpportunityCreate } from '../middleware/rbac.middleware';
import { ValidationError } from '../../shared/errors/validation.error';

const router = Router();

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'));
        }
    },
});

// All import routes require authentication
router.use(authMiddleware);

// ============================================
// GET /import/fields/:entity - Get available fields for mapping
// ============================================
router.get('/fields/:entity', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { entity } = req.params;

        // Validate entity
        const validEntities: ImportEntity[] = ['leads', 'accounts', 'contacts', 'opportunities'];
        if (!validEntities.includes(entity as ImportEntity)) {
            throw new ValidationError('Invalid entity', [
                { field: 'entity', message: `Entity must be one of: ${validEntities.join(', ')}`, code: 'INVALID_ENTITY' },
            ]);
        }

        const fields = importService.getAvailableFields(entity as ImportEntity);

        res.status(200).json({
            success: true,
            data: {
                entity,
                requiredFields: fields.requiredFields,
                optionalFields: fields.optionalFields,
                validEnumFields: fields.validEnumFields,
                relationalFields: fields.relationalFields,
            },
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// GET /import/template/:entity - Download CSV template
// ============================================
router.get('/template/:entity', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { entity } = req.params;

        // Validate entity
        const validEntities: ImportEntity[] = ['leads', 'accounts', 'contacts', 'opportunities'];
        if (!validEntities.includes(entity as ImportEntity)) {
            throw new ValidationError('Invalid entity', [
                { field: 'entity', message: `Entity must be one of: ${validEntities.join(', ')}`, code: 'INVALID_ENTITY' },
            ]);
        }

        const csvContent = importService.generateTemplate(entity as ImportEntity);

        // Set headers for file download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=${entity}_template.csv`);

        res.status(200).send(csvContent);
    } catch (error) {
        next(error);
    }
});

// ============================================
// POST /import/leads - Import leads
// ============================================
router.post(
    '/leads',
    requireLeadCreate,
    upload.single('file'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            if (!req.file) {
                throw new ValidationError('No file uploaded', [
                    { field: 'file', message: 'Please upload a CSV file', code: 'NO_FILE' },
                ]);
            }

            const options = {
                skipDuplicates: req.body.skipDuplicates === 'true',
                updateExisting: req.body.updateExisting === 'true',
                batchSize: req.body.batchSize ? parseInt(req.body.batchSize, 10) : 100,
            };

            const result = await importService.importLeads(
                req.user!.orgId,
                req.user!.id,
                req.file.buffer,
                options
            );

            // If there are errors, generate error report
            let errorReport = null;
            if (result.errors.length > 0) {
                errorReport = importService.generateErrorReport(result);
            }

            res.status(200).json({
                success: result.success,
                data: {
                    totalRows: result.totalRows,
                    successCount: result.successCount,
                    failureCount: result.failureCount,
                    duplicateCount: result.duplicateCount,
                    processingTimeMs: result.processingTimeMs,
                    sampleFailures: result.errors.slice(0, 10), // First 10 errors
                },
                errorReport: errorReport ? Buffer.from(errorReport).toString('base64') : null,
            });
        } catch (error) {
            next(error);
        }
    }
);

// ============================================
// POST /import/accounts - Import accounts
// ============================================
router.post(
    '/accounts',
    requireAccountCreate,
    upload.single('file'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            if (!req.file) {
                throw new ValidationError('No file uploaded', [
                    { field: 'file', message: 'Please upload a CSV file', code: 'NO_FILE' },
                ]);
            }

            const options = {
                skipDuplicates: req.body.skipDuplicates === 'true',
                updateExisting: req.body.updateExisting === 'true',
                batchSize: req.body.batchSize ? parseInt(req.body.batchSize, 10) : 100,
            };

            const result = await importService.importAccounts(
                req.user!.orgId,
                req.user!.id,
                req.file.buffer,
                options
            );

            // If there are errors, generate error report
            let errorReport = null;
            if (result.errors.length > 0) {
                errorReport = importService.generateErrorReport(result);
            }

            res.status(200).json({
                success: result.success,
                data: {
                    totalRows: result.totalRows,
                    successCount: result.successCount,
                    failureCount: result.failureCount,
                    duplicateCount: result.duplicateCount,
                    processingTimeMs: result.processingTimeMs,
                    sampleFailures: result.errors.slice(0, 10),
                },
                errorReport: errorReport ? Buffer.from(errorReport).toString('base64') : null,
            });
        } catch (error) {
            next(error);
        }
    }
);

// ============================================
// POST /import/contacts - Import contacts
// ============================================
router.post(
    '/contacts',
    requireContactCreate,
    upload.single('file'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            if (!req.file) {
                throw new ValidationError('No file uploaded', [
                    { field: 'file', message: 'Please upload a CSV file', code: 'NO_FILE' },
                ]);
            }

            const options = {
                skipDuplicates: req.body.skipDuplicates === 'true',
                updateExisting: req.body.updateExisting === 'true',
                batchSize: req.body.batchSize ? parseInt(req.body.batchSize, 10) : 100,
            };

            const result = await importService.importContacts(
                req.user!.orgId,
                req.user!.id,
                req.file.buffer,
                options
            );

            // If there are errors, generate error report
            let errorReport = null;
            if (result.errors.length > 0) {
                errorReport = importService.generateErrorReport(result);
            }

            res.status(200).json({
                success: result.success,
                data: {
                    totalRows: result.totalRows,
                    successCount: result.successCount,
                    failureCount: result.failureCount,
                    duplicateCount: result.duplicateCount,
                    processingTimeMs: result.processingTimeMs,
                    sampleFailures: result.errors.slice(0, 10),
                },
                errorReport: errorReport ? Buffer.from(errorReport).toString('base64') : null,
            });
        } catch (error) {
            next(error);
        }
    }
);

// ============================================
// POST /import/opportunities - Import opportunities
// ============================================
router.post(
    '/opportunities',
    requireOpportunityCreate,
    upload.single('file'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            if (!req.file) {
                throw new ValidationError('No file uploaded', [
                    { field: 'file', message: 'Please upload a CSV file', code: 'NO_FILE' },
                ]);
            }

            const options = {
                skipDuplicates: req.body.skipDuplicates === 'true',
                updateExisting: req.body.updateExisting === 'true',
                batchSize: req.body.batchSize ? parseInt(req.body.batchSize, 10) : 100,
            };

            const result = await importService.importOpportunities(
                req.user!.orgId,
                req.user!.id,
                req.file.buffer,
                options
            );

            // If there are errors, generate error report
            let errorReport = null;
            if (result.errors.length > 0) {
                errorReport = importService.generateErrorReport(result);
            }

            res.status(200).json({
                success: result.success,
                data: {
                    totalRows: result.totalRows,
                    successCount: result.successCount,
                    failureCount: result.failureCount,
                    duplicateCount: result.duplicateCount,
                    processingTimeMs: result.processingTimeMs,
                    sampleFailures: result.errors.slice(0, 10),
                },
                errorReport: errorReport ? Buffer.from(errorReport).toString('base64') : null,
            });
        } catch (error) {
            next(error);
        }
    }
);

export default router;
