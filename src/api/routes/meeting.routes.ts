import { Router, Request, Response, NextFunction } from 'express';
import * as meetingService from '../../services/meeting.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { Permission } from '../../core/rbac/types';

const router = Router();

// All meeting routes require authentication
router.use(authMiddleware);

// RBAC middleware for meetings
const requireMeetingRead = requirePermission(Permission.MEETING_READ);
const requireMeetingCreate = requirePermission(Permission.MEETING_CREATE);
const requireMeetingUpdate = requirePermission(Permission.MEETING_UPDATE);
const requireMeetingDelete = requirePermission(Permission.MEETING_DELETE);
const requireMeetingAIAnalysis = requirePermission(Permission.MEETING_AI_ANALYSIS);

// ============================================
// GET /meetings - List meetings (paginated, filtered)
// ============================================
router.get('/', requireMeetingRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const {
            status,
            organizerId,
            dealId,
            copilotEnabled,
            copilotMode,
            from,
            to,
            sortBy,
            sortOrder,
            page,
            limit,
        } = req.query;

        const filters: meetingService.MeetingFilters = {
            status: status as any,
            organizerId: organizerId as string | undefined,
            dealId: dealId as string | undefined,
            copilotEnabled: copilotEnabled === 'true' ? true : copilotEnabled === 'false' ? false : undefined,
            copilotMode: copilotMode as any,
            startDateFrom: from ? new Date(from as string) : undefined,
            startDateTo: to ? new Date(to as string) : undefined,
            sortBy: (sortBy as 'startTime' | 'createdAt' | 'updatedAt') || 'startTime',
            sortOrder: (sortOrder as 'asc' | 'desc') || 'asc',
            page: page ? parseInt(page as string, 10) : 1,
            limit: limit ? parseInt(limit as string, 10) : 20,
        };

        const result = await meetingService.getMeetings(req.user!.orgId, filters);

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
// GET /meetings/upcoming - Get upcoming meetings for current user
// ============================================
router.get('/upcoming', requireMeetingRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const days = req.query.days ? parseInt(req.query.days as string, 10) : 7;

        const meetings = await meetingService.getUpcomingMeetings(
            req.user!.orgId,
            req.user!.id,
            days
        );

        res.status(200).json({
            success: true,
            data: meetings,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// GET /meetings/statistics - Get meeting statistics
// ============================================
router.get('/statistics', requireMeetingRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { from, to } = req.query;

        const stats = await meetingService.getMeetingStatistics(
            req.user!.orgId,
            from ? new Date(from as string) : undefined,
            to ? new Date(to as string) : undefined
        );

        res.status(200).json({
            success: true,
            data: stats,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// GET /meetings/:id - Get meeting by ID
// ============================================
router.get('/:id', requireMeetingRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const meeting = await meetingService.getMeetingById(
            req.user!.orgId,
            req.params.id
        );

        res.status(200).json({
            success: true,
            data: meeting,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// GET /meetings/:id/analysis - Get AI analysis for meeting
// ============================================
router.get('/:id/analysis', requireMeetingAIAnalysis, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const analysis = await meetingService.getMeetingAIAnalysis(
            req.user!.orgId,
            req.params.id
        );

        res.status(200).json({
            success: true,
            data: analysis,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// POST /meetings - Create meeting
// ============================================
router.post('/', requireMeetingCreate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const dto: meetingService.CreateMeetingDto = {
            title: req.body.title,
            description: req.body.description,
            startTime: new Date(req.body.startTime),
            endTime: new Date(req.body.endTime),
            timezone: req.body.timezone,
            meetingPlatform: req.body.meetingPlatform,
            meetingUrl: req.body.meetingUrl,
            organizerId: req.body.organizerId || req.user!.id,
            dealId: req.body.dealId,
            copilotEnabled: req.body.copilotEnabled,
            copilotMode: req.body.copilotMode,
        };

        const meeting = await meetingService.createMeeting(
            req.user!.orgId,
            req.user!.id,
            dto
        );

        res.status(201).json({
            success: true,
            data: meeting,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// PUT /meetings/:id - Update meeting
// ============================================
router.put('/:id', requireMeetingUpdate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const dto: meetingService.UpdateMeetingDto = {
            title: req.body.title,
            description: req.body.description,
            startTime: req.body.startTime ? new Date(req.body.startTime) : undefined,
            endTime: req.body.endTime ? new Date(req.body.endTime) : undefined,
            timezone: req.body.timezone,
            meetingPlatform: req.body.meetingPlatform,
            meetingUrl: req.body.meetingUrl,
            dealId: req.body.dealId,
            copilotEnabled: req.body.copilotEnabled,
            copilotMode: req.body.copilotMode,
            status: req.body.status,
            recordingUrl: req.body.recordingUrl,
            transcript: req.body.transcript,
            aiSummary: req.body.aiSummary,
            aiActionItems: req.body.aiActionItems,
            aiKeyMoments: req.body.aiKeyMoments,
            aiSentimentTimeline: req.body.aiSentimentTimeline,
            aiTalkRatio: req.body.aiTalkRatio,
            aiQuestionsAsked: req.body.aiQuestionsAsked,
            aiObjections: req.body.aiObjections,
            aiBuyingSignals: req.body.aiBuyingSignals,
            aiCoachingFeedback: req.body.aiCoachingFeedback,
            aiDealImpact: req.body.aiDealImpact,
            aiNextSteps: req.body.aiNextSteps,
        };

        const meeting = await meetingService.updateMeeting(
            req.user!.orgId,
            req.user!.id,
            req.params.id,
            dto
        );

        res.status(200).json({
            success: true,
            data: meeting,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// PATCH /meetings/:id/analysis - Update AI analysis
// ============================================
router.patch('/:id/analysis', requireMeetingAIAnalysis, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const analysis = {
            aiSummary: req.body.aiSummary,
            aiActionItems: req.body.aiActionItems,
            aiKeyMoments: req.body.aiKeyMoments,
            aiSentimentTimeline: req.body.aiSentimentTimeline,
            aiTalkRatio: req.body.aiTalkRatio,
            aiQuestionsAsked: req.body.aiQuestionsAsked,
            aiObjections: req.body.aiObjections,
            aiBuyingSignals: req.body.aiBuyingSignals,
            aiCoachingFeedback: req.body.aiCoachingFeedback,
            aiDealImpact: req.body.aiDealImpact,
            aiNextSteps: req.body.aiNextSteps,
            transcript: req.body.transcript,
        };

        const meeting = await meetingService.updateMeetingAIAnalysis(
            req.user!.orgId,
            req.params.id,
            analysis
        );

        res.status(200).json({
            success: true,
            data: meeting,
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// DELETE /meetings/:id - Delete meeting
// ============================================
router.delete('/:id', requireMeetingDelete, async (req: Request, res: Response, next: NextFunction) => {
    try {
        await meetingService.deleteMeeting(req.user!.orgId, req.params.id);

        res.status(200).json({
            success: true,
            message: 'Meeting deleted successfully',
        });
    } catch (error) {
        next(error);
    }
});

export default router;
