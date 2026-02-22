import { prisma } from '../config/database';
import { logger } from '../shared/logger';
import { NotFoundError } from '../shared/errors/not-found.error';

// ============================================
// NOTIFICATION SERVICE
// Multi-channel notifications: Email, SMS, Push, Slack, In-App
// ============================================

export type NotificationChannel = 'EMAIL' | 'SMS' | 'PUSH' | 'SLACK' | 'IN_APP';
export type NotificationPriority = 'HIGH' | 'MEDIUM' | 'LOW';
export type NotificationStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface SendNotificationDto {
    userId?: string;
    email?: string;
    phone?: string;

    // Content
    title: string;
    message: string;

    // Channels
    channels: NotificationChannel[];

    // Options
    priority?: NotificationPriority;
    scheduledAt?: Date;
    expiresAt?: Date;

    // Context
    entityType?: string;
    entityId?: string;
    actionUrl?: string;
}

export interface NotificationPreferences {
    email: boolean;
    sms: boolean;
    push: boolean;
    slack: boolean;
    inApp: boolean;

    // Notification types
    dealUpdates: boolean;
    taskReminders: boolean;
    meetingReminders: boolean;
    leadAlerts: boolean;
    systemAlerts: boolean;
    weeklyDigest: boolean;
}

// ============================================
// NOTIFICATION LOG
// ============================================

export async function logNotification(
    orgId: string,
    userId: string,
    data: SendNotificationDto
) {
    const notification = await prisma.notification.create({
        data: {
            orgId,
            userId,
            title: data.title,
            message: data.message,
            channels: data.channels,
            priority: data.priority || 'MEDIUM',
            status: 'PENDING',
            entityType: data.entityType,
            entityId: data.entityId,
            actionUrl: data.actionUrl,
            scheduledAt: data.scheduledAt,
            expiresAt: data.expiresAt,
        },
    });

    logger.info('Notification logged', { notificationId: notification.id, orgId, userId });
    return notification;
}

// ============================================
// SEND NOTIFICATIONS
// ============================================

export async function sendNotification(orgId: string, data: SendNotificationDto) {
    const results = {
        email: { sent: false, messageId: null as string | null },
        sms: { sent: false, messageId: null as string | null },
        push: { sent: false, messageId: null as string | null },
        slack: { sent: false, messageId: null as string | null },
        inApp: { sent: false },
    };

    // Send to each requested channel
    for (const channel of data.channels) {
        try {
            switch (channel) {
                case 'EMAIL':
                    results.email = await sendEmail(data);
                    break;
                case 'SMS':
                    results.sms = await sendSMS(data);
                    break;
                case 'PUSH':
                    results.push = await sendPushNotification(data);
                    break;
                case 'SLACK':
                    results.slack = await sendSlackMessage(data);
                    break;
                case 'IN_APP':
                    results.inApp = await sendInAppNotification(orgId, data);
                    break;
            }
        } catch (error) {
            logger.error(`Failed to send ${channel} notification`, { error, channel });
        }
    }

    return results;
}

// ============================================
// CHANNEL IMPLEMENTATIONS
// ============================================

async function sendEmail(data: SendNotificationDto) {
    if (!data.email) {
        return { sent: false, messageId: null };
    }

    // In production, integrate with SendGrid/Postmark/AWS SES
    // For now, log the mock send
    logger.info('Sending email notification', {
        to: data.email,
        subject: data.title,
    });

    // Mock send
    return { sent: true, messageId: `email-${Date.now()}` };
}

async function sendSMS(data: SendNotificationDto) {
    if (!data.phone) {
        return { sent: false, messageId: null };
    }

    // In production, integrate with Twilio
    logger.info('Sending SMS notification', {
        to: data.phone,
        message: data.message,
    });

    return { sent: true, messageId: `sms-${Date.now()}` };
}

async function sendPushNotification(data: SendNotificationDto) {
    // In production, integrate with Firebase Cloud Messaging
    logger.info('Sending push notification', {
        title: data.title,
        message: data.message,
    });

    return { sent: true, messageId: `push-${Date.now()}` };
}

async function sendSlackMessage(data: SendNotificationDto) {
    // In production, integrate with Slack Webhooks
    logger.info('Sending Slack message', {
        title: data.title,
        message: data.message,
    });

    return { sent: true, messageId: `slack-${Date.now()}` };
}

async function sendInAppNotification(orgId: string, data: SendNotificationDto) {
    if (!data.userId) {
        return { sent: false };
    }

    // Create in-app notification record
    await prisma.notification.create({
        data: {
            orgId,
            userId: data.userId,
            title: data.title,
            message: data.message,
            channels: ['IN_APP'],
            priority: data.priority || 'MEDIUM',
            status: 'DELIVERED',
            entityType: data.entityType,
            entityId: data.entityId,
            actionUrl: data.actionUrl,
        },
    });

    return { sent: true };
}

// ============================================
// NOTIFICATION PREFERENCES
// ============================================

export async function getNotificationPreferences(orgId: string, userId: string) {
    const prefs = await prisma.notificationPreferences.findFirst({
        where: { orgId, userId },
    });

    return prefs || getDefaultPreferences();
}

export async function updateNotificationPreferences(
    orgId: string,
    userId: string,
    updates: Partial<NotificationPreferences>
) {
    const prefs = await prisma.notificationPreferences.findFirst({
        where: { orgId, userId },
    });

    if (prefs) {
        return await prisma.notificationPreferences.update({
            where: { id: prefs.id },
            data: updates,
        });
    }

    // Create new preferences
    return await prisma.notificationPreferences.create({
        data: {
            orgId,
            userId,
            ...getDefaultPreferences(),
            ...updates,
        },
    });
}

function getDefaultPreferences(): NotificationPreferences {
    return {
        email: true,
        sms: false,
        push: true,
        slack: false,
        inApp: true,
        dealUpdates: true,
        taskReminders: true,
        meetingReminders: true,
        leadAlerts: true,
        systemAlerts: true,
        weeklyDigest: false,
    };
}

// ============================================
// BATCH NOTIFICATIONS
// ============================================

export async function notifyDealStageChange(
    orgId: string,
    dealId: string,
    oldStage: string,
    newStage: string,
    ownerId: string
) {
    const deal = await prisma.opportunity.findById(dealId);

    if (!deal) return;

    const owner = await prisma.user.findById(ownerId);

    if (!owner?.email) return;

    return await sendNotification(orgId, {
        userId: ownerId,
        email: owner.email,
        title: `Deal Stage Updated: ${deal.name}`,
        message: `Deal "${deal.name}" moved from ${oldStage} to ${newStage}`,
        channels: ['EMAIL', 'IN_APP'],
        priority: 'MEDIUM',
        entityType: 'OPPORTUNITY',
        entityId: dealId,
    });
}

export async function notifyTaskDue(
    orgId: string,
    taskId: string,
    userId: string
) {
    const task = await prisma.task.findById(taskId);

    if (!task) return;

    const user = await prisma.user.findById(userId);

    if (!user?.email) return;

    return await sendNotification(orgId, {
        userId,
        email: user.email,
        title: `Task Due: ${task.subject}`,
        message: `Task "${task.subject}" is due soon.`,
        channels: ['EMAIL', 'IN_APP'],
        priority: 'HIGH',
        entityType: 'TASK',
        entityId: taskId,
    });
}

export async function notifyMeetingReminder(
    orgId: string,
    meetingId: string,
    userId: string,
    minutesBefore: number
) {
    const meeting = await prisma.meeting.findById(meetingId);

    if (!meeting) return;

    const user = await prisma.user.findById(userId);

    if (!user?.email) return;

    return await sendNotification(orgId, {
        userId,
        email: user.email,
        title: `Meeting in ${minutesBefore} minutes: ${meeting.title}`,
        message: `Your meeting "${meeting.title}" starts soon.`,
        channels: ['EMAIL', 'IN_APP'],
        priority: 'HIGH',
        entityType: 'MEETING',
        entityId: meetingId,
        actionUrl: meeting.meetingUrl || undefined,
    });
}

export async function notifyLeadAssigned(
    orgId: string,
    leadId: string,
    assignedToId: string
) {
    const lead = await prisma.lead.findById(leadId);

    if (!lead) return;

    const user = await prisma.user.findById(assignedToId);

    if (!user?.email) return;

    return await sendNotification(orgId, {
        userId: assignedToId,
        email: user.email,
        title: `New Lead Assigned: ${lead.name}`,
        message: `You've been assigned a new lead: ${lead.name}`,
        channels: ['EMAIL', 'IN_APP'],
        priority: 'MEDIUM',
        entityType: 'LEAD',
        entityId: leadId,
    });
}

// ============================================
// NOTIFICATION QUEUE (for scheduled notifications)
// ============================================

export async function processScheduledNotifications() {
    const now = new Date();

    const dueNotifications = await prisma.notification.findMany({
        where: {
            status: 'PENDING',
            scheduledAt: { lte: now },
            OR: [
                { expiresAt: null },
                { expiresAt: { gte: now } },
            ],
        },
    });

    for (const notification of dueNotifications) {
        try {
            // Get user preferences
            const prefs = await getNotificationPreferences(notification.orgId, notification.userId);

            if (!prefs.inApp) continue; // Skip if user disabled

            // Mark as sent
            await prisma.notification.update({
                where: { id: notification.id },
                data: { status: 'SENT' },
            });

            logger.info('Processed scheduled notification', {
                notificationId: notification.id
            });
        } catch (error) {
            logger.error('Failed to process scheduled notification', {
                notificationId: notification.id,
                error,
            });
        }
    }
}
