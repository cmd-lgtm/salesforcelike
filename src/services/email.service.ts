import { prisma } from '../config/database';
import { logger } from '../shared/logger';
import { ValidationError } from '../shared/errors/validation.error';
import { NotFoundError } from '../shared/errors/not-found.error';

// Type definitions
export type TemplateCategory = 'COLD_OUTREACH' | 'FOLLOW_UP' | 'PROPOSAL' | 'BREAKUP' | 'INTRODUCTION' | 'MEETING_REQUEST';
export type SequenceStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';

// ============================================
// EMAIL TEMPLATES
// ============================================

export interface CreateEmailTemplateDto {
    name: string;
    subject: string;
    body: string;
    category?: TemplateCategory;
    aiGenerated?: boolean;
}

export interface UpdateEmailTemplateDto {
    name?: string;
    subject?: string;
    body?: string;
    category?: TemplateCategory;
}

export async function createEmailTemplate(orgId: string, userId: string, data: CreateEmailTemplateDto) {
    const template = await prisma.emailTemplate.create({
        data: {
            orgId,
            name: data.name,
            subject: data.subject,
            body: data.body,
            category: data.category,
            aiGenerated: data.aiGenerated ?? false,
        },
        include: {
            organization: { select: { id: true, name: true } },
        },
    });

    logger.info('Email template created', { templateId: template.id, orgId, userId });
    return template;
}

export async function getEmailTemplateById(orgId: string, templateId: string) {
    const template = await prisma.emailTemplate.findFirst({
        where: { id: templateId, orgId },
    });

    if (!template) {
        throw new NotFoundError('Email template not found');
    }

    return template;
}

export async function getEmailTemplates(
    orgId: string,
    filters: { category?: TemplateCategory; aiGenerated?: boolean; page?: number; limit?: number } = {}
) {
    const { category, aiGenerated, page = 1, limit = 20 } = filters;

    const where: any = { orgId };
    if (category) where.category = category;
    if (aiGenerated !== undefined) where.aiGenerated = aiGenerated;

    const [templates, total] = await Promise.all([
        prisma.emailTemplate.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.emailTemplate.count({ where }),
    ]);

    return {
        data: templates,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
}

export async function updateEmailTemplate(orgId: string, templateId: string, data: UpdateEmailTemplateDto) {
    const template = await prisma.emailTemplate.findFirst({
        where: { id: templateId, orgId },
    });

    if (!template) {
        throw new NotFoundError('Email template not found');
    }

    const updated = await prisma.emailTemplate.update({
        where: { id: templateId },
        data,
    });

    logger.info('Email template updated', { templateId, orgId });
    return updated;
}

export async function deleteEmailTemplate(orgId: string, templateId: string) {
    const template = await prisma.emailTemplate.findFirst({
        where: { id: templateId, orgId },
    });

    if (!template) {
        throw new NotFoundError('Email template not found');
    }

    await prisma.emailTemplate.delete({ where: { id: templateId } });

    logger.info('Email template deleted', { templateId, orgId });
    return { success: true };
}

// ============================================
// EMAIL SEQUENCES
// ============================================

export interface CreateEmailSequenceDto {
    name: string;
    description?: string;
    aiAdaptive?: boolean;
    aiPersonalizationLevel?: string;
}

export interface UpdateEmailSequenceDto {
    name?: string;
    description?: string;
    aiAdaptive?: boolean;
    aiPersonalizationLevel?: string;
    status?: SequenceStatus;
}

export interface CreateSequenceStepDto {
    stepNumber: number;
    delayDays?: number;
    templateId?: string;
    aiRewriteEnabled?: boolean;
    aiSendTimeOptimization?: boolean;
}

export async function createEmailSequence(orgId: string, userId: string, data: CreateEmailSequenceDto) {
    const sequence = await prisma.emailSequence.create({
        data: {
            orgId,
            name: data.name,
            description: data.description,
            aiAdaptive: data.aiAdaptive ?? true,
            aiPersonalizationLevel: data.aiPersonalizationLevel ?? 'high',
            status: 'DRAFT',
        },
        include: {
            organization: { select: { id: true, name: true } },
        },
    });

    logger.info('Email sequence created', { sequenceId: sequence.id, orgId, userId });
    return sequence;
}

export async function getEmailSequenceById(orgId: string, sequenceId: string) {
    const sequence = await prisma.emailSequence.findFirst({
        where: { id: sequenceId, orgId },
        include: {
            steps: {
                orderBy: { stepNumber: 'asc' },
                include: { template: true },
            },
        },
    });

    if (!sequence) {
        throw new NotFoundError('Email sequence not found');
    }

    return sequence;
}

export async function getEmailSequences(
    orgId: string,
    filters: { status?: SequenceStatus; page?: number; limit?: number } = {}
) {
    const { status, page = 1, limit = 20 } = filters;

    const where: any = { orgId };
    if (status) where.status = status;

    const [sequences, total] = await Promise.all([
        prisma.emailSequence.findMany({
            where,
            include: { _count: { select: { steps: true } } },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.emailSequence.count({ where }),
    ]);

    return {
        data: sequences,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
}

export async function updateEmailSequence(orgId: string, sequenceId: string, data: UpdateEmailSequenceDto) {
    const sequence = await prisma.emailSequence.findFirst({
        where: { id: sequenceId, orgId },
    });

    if (!sequence) {
        throw new NotFoundError('Email sequence not found');
    }

    const updated = await prisma.emailSequence.update({
        where: { id: sequenceId },
        data,
        include: { steps: { orderBy: { stepNumber: 'asc' } } },
    });

    logger.info('Email sequence updated', { sequenceId, orgId });
    return updated;
}

export async function deleteEmailSequence(orgId: string, sequenceId: string) {
    const sequence = await prisma.emailSequence.findFirst({
        where: { id: sequenceId, orgId },
    });

    if (!sequence) {
        throw new NotFoundError('Email sequence not found');
    }

    await prisma.emailSequence.delete({ where: { id: sequenceId } });

    logger.info('Email sequence deleted', { sequenceId, orgId });
    return { success: true };
}

// ============================================
// SEQUENCE STEPS
// ============================================

export async function addSequenceStep(orgId: string, sequenceId: string, data: CreateSequenceStepDto) {
    const sequence = await prisma.emailSequence.findFirst({
        where: { id: sequenceId, orgId },
    });

    if (!sequence) {
        throw new NotFoundError('Email sequence not found');
    }

    // Verify template belongs to org if provided
    if (data.templateId) {
        const template = await prisma.emailTemplate.findFirst({
            where: { id: data.templateId, orgId },
        });
        if (!template) {
            throw new NotFoundError('Email template not found');
        }
    }

    const step = await prisma.emailSequenceStep.create({
        data: {
            sequenceId,
            stepNumber: data.stepNumber,
            delayDays: data.delayDays ?? 1,
            templateId: data.templateId,
            aiRewriteEnabled: data.aiRewriteEnabled ?? true,
            aiSendTimeOptimization: data.aiSendTimeOptimization ?? true,
        },
        include: { template: true },
    });

    logger.info('Sequence step added', { stepId: step.id, sequenceId, orgId });
    return step;
}

export async function updateSequenceStep(orgId: string, stepId: string, data: Partial<CreateSequenceStepDto>) {
    const step = await prisma.emailSequenceStep.findFirst({
        where: { id: stepId },
        include: { sequence: true },
    });

    if (!step || step.sequence.orgId !== orgId) {
        throw new NotFoundError('Sequence step not found');
    }

    const updated = await prisma.emailSequenceStep.update({
        where: { id: stepId },
        data,
        include: { template: true },
    });

    logger.info('Sequence step updated', { stepId, orgId });
    return updated;
}

export async function deleteSequenceStep(orgId: string, stepId: string) {
    const step = await prisma.emailSequenceStep.findFirst({
        where: { id: stepId },
        include: { sequence: true },
    });

    if (!step || step.sequence.orgId !== orgId) {
        throw new NotFoundError('Sequence step not found');
    }

    await prisma.emailSequenceStep.delete({ where: { id: stepId } });

    logger.info('Sequence step deleted', { stepId, orgId });
    return { success: true };
}

// ============================================
// AI EMAIL GENERATION
// ============================================

export async function generateEmailWithAI(
    orgId: string,
    context: {
        templateType?: TemplateCategory;
        contactName?: string;
        companyName?: string;
        dealStage?: string;
        previousEmails?: string[];
    }
) {
    // This would integrate with OpenAI/Claude in production
    // For now, return a placeholder
    const subject = context.templateType === 'COLD_OUTREACH'
        ? `Quick question for ${context.companyName || 'you'}`
        : `Following up on our conversation`;

    const body = context.contactName
        ? `Hi ${context.contactName},\n\nI wanted to reach out regarding ${context.companyName || 'your company'}.`
        : `I hope this email finds you well.`;

    return {
        subject,
        body,
        aiGenerated: true,
    };
}
