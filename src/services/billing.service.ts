import { prisma } from '../config/database';
import { logger } from '../shared/logger';
import { NotFoundError } from '../shared/errors/not-found.error';
import { ForbiddenError } from '../shared/errors/forbidden.error';
import { ValidationError } from '../shared/errors/validation.error';
import { PlanType, BillingEventType, BillingRecord, Organization } from '@prisma/client';

// ============================================
// TYPES & INTERFACES
// ============================================

export interface BillingInfo {
    organizationId: string;
    plan: PlanType;
    seatsTotal: number;
    seatsUsed: number;
    seatsAvailable: number;
    trialEnd: Date | null;
    isOnTrial: boolean;
    stripeCustomerId: string | null;
    features: PlanFeatures;
}

export interface PlanFeatures {
    maxSeats: number;
    apiKeys: boolean;
    advancedReporting: boolean;
    customFields: boolean;
    integrations: boolean;
    prioritySupport: boolean;
    auditLogRetention: number; // days
}

export interface SeatAssignment {
    userId: string;
    orgId: string;
    assigned: boolean;
}

export interface MockInvoice {
    id: string;
    amount: number;
    currency: string;
    status: 'paid' | 'pending' | 'failed';
    date: Date;
    planType: PlanType;
    seatsCount: number;
    description: string;
}

export interface UpgradeIntent {
    planType: PlanType;
    requestedAt: Date;
    status: 'pending' | 'completed' | 'cancelled';
}

// ============================================
// PLAN CONFIGURATION
// ============================================

const PLAN_CONFIG: Record<PlanType, PlanFeatures> = {
    FREE: {
        maxSeats: 5,
        apiKeys: false,
        advancedReporting: false,
        customFields: false,
        integrations: false,
        prioritySupport: false,
        auditLogRetention: 30,
    },
    PRO: {
        maxSeats: -1, // Unlimited
        apiKeys: true,
        advancedReporting: true,
        customFields: true,
        integrations: true,
        prioritySupport: true,
        auditLogRetention: 365,
    },
    ENTERPRISE: {
        maxSeats: -1, // Unlimited
        apiKeys: true,
        advancedReporting: true,
        customFields: true,
        integrations: true,
        prioritySupport: true,
        auditLogRetention: -1, // Forever
    },
};

// ============================================
// BILLING SERVICE
// ============================================

/**
 * Get billing information for an organization
 */
export async function getBillingInfo(orgId: string): Promise<BillingInfo> {
    const organization = await prisma.organization.findUnique({
        where: { id: orgId },
    });

    if (!organization) {
        throw new NotFoundError('Organization not found');
    }

    const isOnTrial = organization.trialEnd !== null && organization.trialEnd > new Date();
    const features = PLAN_CONFIG[organization.planType as PlanType];

    // Calculate seats available
    let seatsAvailable: number;
    if (features.maxSeats === -1) {
        seatsAvailable = -1; // Unlimited
    } else {
        seatsAvailable = Math.max(0, organization.seatsTotal - organization.seatsUsed);
    }

    return {
        organizationId: organization.id,
        plan: organization.planType,
        seatsTotal: organization.seatsTotal,
        seatsUsed: organization.seatsUsed,
        seatsAvailable,
        trialEnd: organization.trialEnd,
        isOnTrial,
        stripeCustomerId: organization.stripeCustomerId,
        features,
    };
}

/**
 * Get current plan details
 */
export async function getPlanDetails(orgId: string): Promise<{ plan: PlanType; features: PlanFeatures }> {
    const organization = await prisma.organization.findUnique({
        where: { id: orgId },
    });

    if (!organization) {
        throw new NotFoundError('Organization not found');
    }

    return {
        plan: organization.planType as PlanType,
        features: PLAN_CONFIG[organization.planType as PlanType],
    };
}

/**
 * Update organization plan (stub - records intent)
 */
export async function updatePlan(
    orgId: string,
    newPlan: PlanType,
    metadata?: Record<string, unknown>
): Promise<{ success: boolean; message: string; billingRecord?: BillingRecord }> {
    const organization = await prisma.organization.findUnique({
        where: { id: orgId },
    });

    if (!organization) {
        throw new NotFoundError('Organization not found');
    }

    const oldPlan = organization.planType;

    // Don't process if same plan
    if (oldPlan === newPlan) {
        return {
            success: true,
            message: `Organization is already on ${newPlan} plan`,
        };
    }

    // Determine seat changes based on plan
    let newSeatsTotal = organization.seatsTotal;
    void newPlan; // Used for plan-specific seat logic below

    // Set seats based on plan type
    if (newPlan === PlanType.FREE) {
        newSeatsTotal = 5;
    } else if (newPlan === PlanType.PRO) {
        newSeatsTotal = Math.max(organization.seatsUsed, 10); // At least 10 seats for Pro
    } else if (newPlan === PlanType.ENTERPRISE) {
        newSeatsTotal = Math.max(organization.seatsUsed, 25); // At least 25 seats for Enterprise
    }

    // Update organization
    await prisma.organization.update({
        where: { id: orgId },
        data: {
            planType: newPlan,
            seatsTotal: newSeatsTotal,
        },
    });

    // Create billing record
    const billingRecord = await prisma.billingRecord.create({
        data: {
            orgId,
            eventType: oldPlan === PlanType.FREE && newPlan !== PlanType.FREE
                ? BillingEventType.SUBSCRIPTION_STARTED
                : BillingEventType.SUBSCRIPTION_UPDATED,
            planType: newPlan,
            seatsCount: newSeatsTotal,
            metadata: {
                oldPlan,
                newPlan,
                ...metadata,
            },
        },
    });

    logger.info(`Organization ${orgId} plan changed from ${oldPlan} to ${newPlan}`, {
        oldPlan,
        newPlan,
        seatsTotal: newSeatsTotal,
    });

    return {
        success: true,
        message: `Plan updated from ${oldPlan} to ${newPlan}`,
        billingRecord,
    };
}

/**
 * Assign a seat to a user (increment seats used)
 */
export async function assignSeat(orgId: string, userId: string): Promise<SeatAssignment> {
    const organization = await prisma.organization.findUnique({
        where: { id: orgId },
    });

    if (!organization) {
        throw new NotFoundError('Organization not found');
    }

    // Check if user belongs to organization
    const user = await prisma.user.findFirst({
        where: { id: userId, orgId },
    });

    if (!user) {
        throw new NotFoundError('User not found in organization');
    }

    const features = PLAN_CONFIG[organization.planType as PlanType];
    const seatsAvailable = features.maxSeats === -1
        ? Infinity
        : organization.seatsTotal - organization.seatsUsed;

    // Check seat limit
    if (seatsAvailable <= 0) {
        throw new ForbiddenError(
            `Cannot assign seat: organization has reached seat limit (${organization.seatsTotal}). Please upgrade your plan.`
        );
    }

    // Increment seats used
    await prisma.organization.update({
        where: { id: orgId },
        data: {
            seatsUsed: { increment: 1 },
        },
    });

    // Create billing record
    await prisma.billingRecord.create({
        data: {
            orgId,
            eventType: BillingEventType.SEAT_ADDED,
            seatsCount: organization.seatsUsed + 1,
        },
    });

    logger.info(`Seat assigned to user ${userId} in organization ${orgId}`);

    return {
        userId,
        orgId,
        assigned: true,
    };
}

/**
 * Reclaim a seat from a user (decrement seats used)
 */
export async function reclaimSeat(orgId: string, userId: string): Promise<SeatAssignment> {
    const organization = await prisma.organization.findUnique({
        where: { id: orgId },
    });

    if (!organization) {
        throw new NotFoundError('Organization not found');
    }

    // Check if user belongs to organization
    const user = await prisma.user.findFirst({
        where: { id: userId, orgId },
    });

    if (!user) {
        throw new NotFoundError('User not found in organization');
    }

    // Prevent going below 0
    if (organization.seatsUsed <= 0) {
        throw new ValidationError('No seats to reclaim');
    }

    // Decrement seats used
    await prisma.organization.update({
        where: { id: orgId },
        data: {
            seatsUsed: { decrement: 1 },
        },
    });

    // Create billing record
    await prisma.billingRecord.create({
        data: {
            orgId,
            eventType: BillingEventType.SEAT_REMOVED,
            seatsCount: organization.seatsUsed - 1,
        },
    });

    logger.info(`Seat reclaimed from user ${userId} in organization ${orgId}`);

    return {
        userId,
        orgId,
        assigned: false,
    };
}

/**
 * Get seat usage details
 */
export async function getSeatUsage(orgId: string): Promise<{
    total: number;
    used: number;
    available: number;
    users: Array<{
        id: string;
        email: string;
        firstName: string;
        lastName: string;
        role: string;
    }>;
}> {
    const organization = await prisma.organization.findUnique({
        where: { id: orgId },
    });

    if (!organization) {
        throw new NotFoundError('Organization not found');
    }

    const features = PLAN_CONFIG[organization.planType as PlanType];
    const available = features.maxSeats === -1
        ? -1 // Unlimited
        : Math.max(0, organization.seatsTotal - organization.seatsUsed);

    // Get all users in organization
    const users = await prisma.user.findMany({
        where: { orgId },
        select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
        },
    });

    return {
        total: organization.seatsTotal,
        used: organization.seatsUsed,
        available,
        users,
    };
}

/**
 * Get mock invoice history
 */
export async function getInvoiceHistory(orgId: string, limit = 10): Promise<MockInvoice[]> {
    const organization = await prisma.organization.findUnique({
        where: { id: orgId },
    });

    if (!organization) {
        throw new NotFoundError('Organization not found');
    }

    // Get billing records for invoices
    const billingRecords = await prisma.billingRecord.findMany({
        where: {
            orgId,
            eventType: {
                in: [
                    BillingEventType.SUBSCRIPTION_STARTED,
                    BillingEventType.SUBSCRIPTION_UPDATED,
                    BillingEventType.PAYMENT_SUCCEEDED,
                ],
            },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
    });

    // If no records, return mock data
    if (billingRecords.length === 0) {
        return generateMockInvoices(organization, limit);
    }

    return billingRecords.map((record: BillingRecord) => ({
        id: record.stripeInvoiceId || record.id,
        amount: record.amount ? Number(record.amount) : 0,
        currency: record.currency,
        status: 'paid' as const,
        date: record.createdAt,
        planType: record.planType || organization.planType,
        seatsCount: record.seatsCount || organization.seatsUsed,
        description: `${record.planType || 'Plan'} - ${record.seatsCount || organization.seatsUsed} seats`,
    }));
}

/**
 * Generate mock invoices for display
 */
function generateMockInvoices(org: Organization, limit: number): MockInvoice[] {
    const invoices: MockInvoice[] = [];
    const planName = org.planType === PlanType.FREE ? 'Free Plan' :
        org.planType === PlanType.PRO ? 'Pro Plan' : 'Enterprise Plan';

    const now = new Date();

    for (let i = 0; i < limit; i++) {
        const date = new Date(now);
        date.setMonth(date.getMonth() - i);

        invoices.push({
            id: `mock_inv_${Date.now()}_${i}`,
            amount: org.planType === PlanType.FREE ? 0 :
                org.planType === PlanType.PRO ? 29 : 99,
            currency: 'USD',
            status: 'paid',
            date,
            planType: org.planType,
            seatsCount: org.seatsUsed,
            description: `${planName} - Monthly Subscription`,
        });
    }

    return invoices;
}

/**
 * Start upgrade flow (stub)
 */
export async function startUpgradeFlow(
    orgId: string,
    targetPlan: PlanType
): Promise<{
    success: boolean;
    message: string;
    checkoutUrl?: string;
    upgradeIntent?: UpgradeIntent;
}> {
    const organization = await prisma.organization.findUnique({
        where: { id: orgId },
    });

    if (!organization) {
        throw new NotFoundError('Organization not found');
    }

    if (organization.planType === targetPlan) {
        return {
            success: false,
            message: `Organization is already on ${targetPlan} plan`,
        };
    }

    if (targetPlan === PlanType.FREE) {
        return {
            success: false,
            message: 'Cannot upgrade to Free plan. Use the downgrade endpoint instead.',
        };
    }

    // In a real implementation, this would create a Stripe checkout session
    // For stub, we record the intent and return a mock URL
    const checkoutUrl = `/api/v1/billing/upgrade/complete?plan=${targetPlan}&org=${orgId}`;

    logger.info(`Upgrade flow initiated for organization ${orgId} to ${targetPlan}`);

    return {
        success: true,
        message: `Upgrade to ${targetPlan} initiated. Complete payment to activate.`,
        checkoutUrl,
        upgradeIntent: {
            planType: targetPlan,
            requestedAt: new Date(),
            status: 'pending',
        },
    };
}

/**
 * Check if a feature is available for the organization's plan
 */
export function checkFeatureAccess(
    planType: PlanType,
    feature: keyof PlanFeatures
): boolean {
    const features = PLAN_CONFIG[planType as PlanType];

    // For maxSeats, return true if there's any capacity
    if (feature === 'maxSeats') {
        return features.maxSeats !== 0;
    }

    // For auditLogRetention, return true if > 0
    if (feature === 'auditLogRetention') {
        return features.auditLogRetention !== 0;
    }

    return Boolean(features[feature]);
}

/**
 * Get feature gating error message
 */
export function getFeatureGatedMessage(feature: string): string {
    const featureMessages: Record<string, string> = {
        apiKeys: 'API Keys are available on Pro and Enterprise plans. Please upgrade to access this feature.',
        advancedReporting: 'Advanced Reporting is available on Pro and Enterprise plans. Please upgrade to access this feature.',
        customFields: 'Custom Fields are available on Pro and Enterprise plans. Please upgrade to access this feature.',
        integrations: 'Integrations are available on Pro and Enterprise plans. Please upgrade to access this feature.',
        prioritySupport: 'Priority Support is available on Pro and Enterprise plans. Please upgrade to access this feature.',
    };

    return featureMessages[feature] || 'This feature is not available on your current plan. Please upgrade to access.';
}

/**
 * Validate seat assignment and throw if not allowed
 */
export async function validateSeatAssignment(orgId: string): Promise<void> {
    const organization = await prisma.organization.findUnique({
        where: { id: orgId },
    });

    if (!organization) {
        throw new NotFoundError('Organization not found');
    }

    const features = PLAN_CONFIG[organization.planType as PlanType];

    if (features.maxSeats === -1) {
        return; // Unlimited seats
    }

    const seatsAvailable = organization.seatsTotal - organization.seatsUsed;

    if (seatsAvailable <= 0) {
        throw new ForbiddenError(
            `Seat limit reached. Your ${organization.planType} plan includes ${organization.seatsTotal} seats. ` +
            `Please upgrade to add more users.`
        );
    }
}

/**
 * Start a trial (for new organizations)
 */
export async function startTrial(orgId: string, trialDays: number = 14): Promise<{
    success: boolean;
    trialEnd: Date;
}> {
    const organization = await prisma.organization.findUnique({
        where: { id: orgId },
    });

    if (!organization) {
        throw new NotFoundError('Organization not found');
    }

    if (organization.planType !== PlanType.FREE) {
        throw new ValidationError('Trials are only available for Free plan organizations');
    }

    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + trialDays);

    await prisma.organization.update({
        where: { id: orgId },
        data: {
            trialEnd,
        },
    });

    await prisma.billingRecord.create({
        data: {
            orgId,
            eventType: BillingEventType.TRIAL_STARTED,
            planType: PlanType.PRO,
            metadata: { trialDays },
        },
    });

    logger.info(`Trial started for organization ${orgId}, ending on ${trialEnd}`);

    return {
        success: true,
        trialEnd,
    };
}

/**
 * Cancel trial
 */
export async function cancelTrial(orgId: string): Promise<{ success: boolean }> {
    const organization = await prisma.organization.findUnique({
        where: { id: orgId },
    });

    if (!organization) {
        throw new NotFoundError('Organization not found');
    }

    await prisma.organization.update({
        where: { id: orgId },
        data: {
            trialEnd: null,
        },
    });

    await prisma.billingRecord.create({
        data: {
            orgId,
            eventType: BillingEventType.TRIAL_ENDED,
            metadata: { reason: 'cancelled' },
        },
    });

    logger.info(`Trial cancelled for organization ${orgId}`);

    return { success: true };
}
