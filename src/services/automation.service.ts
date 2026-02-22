import { prisma } from '../config/database';
import { logger } from '../shared/logger';
import { NotFoundError } from '../shared/errors/not-found.error';

// Type definitions
export type TriggerType = 'DEAL_STAGE_CHANGE' | 'TIME_BASED' | 'FIELD_CHANGE' | 'CONTACT_CREATED' | 'DEAL_CREATED' | 'TASK_COMPLETED';
export type ActionType = 'SEND_EMAIL' | 'CREATE_TASK' | 'UPDATE_FIELD' | 'SEND_NOTIFICATION' | 'CHANGE_STAGE' | 'CREATE_ACTIVITY';

export interface CreateAutomationDto {
    name: string;
    description?: string;
    nlDefinition?: string;
    triggerType: TriggerType;
    triggerConditions: any;
    actionType: ActionType;
    actionConfig: any;
}

export interface UpdateAutomationDto {
    name?: string;
    description?: string;
    nlDefinition?: string;
    triggerType?: TriggerType;
    triggerConditions?: any;
    actionType?: ActionType;
    actionConfig?: any;
    isActive?: boolean;
}

// ============================================
// AUTOMATIONS
// ============================================

export async function createAutomation(orgId: string, userId: string, data: CreateAutomationDto) {
    const automation = await prisma.automation.create({
        data: {
            orgId,
            name: data.name,
            description: data.description,
            nlDefinition: data.nlDefinition,
            triggerType: data.triggerType,
            triggerConditions: data.triggerConditions,
            actionType: data.actionType,
            actionConfig: data.actionConfig,
            createdById: userId,
        },
        include: {
            createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
    });

    logger.info('Automation created', { automationId: automation.id, orgId, userId });
    return automation;
}

export async function getAutomationById(orgId: string, automationId: string) {
    const automation = await prisma.automation.findFirst({
        where: { id: automationId, orgId },
        include: {
            createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
    });

    if (!automation) {
        throw new NotFoundError('Automation not found');
    }

    return automation;
}

export async function getAutomations(
    orgId: string,
    filters: { triggerType?: TriggerType; isActive?: boolean; page?: number; limit?: number } = {}
) {
    const { triggerType, isActive, page = 1, limit = 20 } = filters;

    const where: any = { orgId };
    if (triggerType) where.triggerType = triggerType;
    if (isActive !== undefined) where.isActive = isActive;

    const [automations, total] = await Promise.all([
        prisma.automation.findMany({
            where,
            include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.automation.count({ where }),
    ]);

    return {
        data: automations,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
}

export async function updateAutomation(orgId: string, automationId: string, data: UpdateAutomationDto) {
    const automation = await prisma.automation.findFirst({
        where: { id: automationId, orgId },
    });

    if (!automation) {
        throw new NotFoundError('Automation not found');
    }

    const updated = await prisma.automation.update({
        where: { id: automationId },
        data,
        include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
    });

    logger.info('Automation updated', { automationId, orgId });
    return updated;
}

export async function deleteAutomation(orgId: string, automationId: string) {
    const automation = await prisma.automation.findFirst({
        where: { id: automationId, orgId },
    });

    if (!automation) {
        throw new NotFoundError('Automation not found');
    }

    await prisma.automation.delete({ where: { id: automationId } });

    logger.info('Automation deleted', { automationId, orgId });
    return { success: true };
}

// ============================================
// TRIGGER EXECUTION
// ============================================

export async function executeAutomation(automationId: string, context: any) {
    const automation = await prisma.automation.findById(automationId);

    if (!automation || !automation.isActive) {
        return { executed: false, reason: 'Automation not found or inactive' };
    }

    try {
        // Execute the action based on actionType
        let result: any;

        switch (automation.actionType) {
            case 'SEND_EMAIL':
                // Would integrate with email service
                result = { sent: true, messageId: 'mock-' + Date.now() };
                break;
            case 'CREATE_TASK':
                // Would create a task
                result = { created: true, taskId: 'mock-' + Date.now() };
                break;
            case 'UPDATE_FIELD':
                result = { updated: true };
                break;
            case 'SEND_NOTIFICATION':
                result = { notified: true };
                break;
            case 'CHANGE_STAGE':
                result = { stageChanged: true };
                break;
            case 'CREATE_ACTIVITY':
                result = { activityCreated: true };
                break;
            default:
                result = { executed: false, reason: 'Unknown action type' };
        }

        // Update automation stats
        await prisma.automation.update({
            where: { id: automationId },
            data: {
                timesTriggered: { increment: 1 },
            },
        });

        logger.info('Automation executed', { automationId, result });
        return { executed: true, result };

    } catch (error) {
        logger.error('Automation execution failed', { automationId, error });
        return { executed: false, error: String(error) };
    }
}

// ============================================
// NATURAL LANGUAGE PARSING
// ============================================

export async function parseAutomationFromNL(orgId: string, nlText: string) {
    // This would use AI to parse natural language into automation rules
    // For now, return a mock parsed result

    const parsed = {
        triggerType: 'DEAL_STAGE_CHANGE' as TriggerType,
        triggerConditions: { stage: '$100K' },
        actionType: 'SEND_NOTIFICATION' as ActionType,
        actionConfig: { notificationType: 'email', recipient: 'VP' },
        confidence: 0.85,
    };

    return parsed;
}
