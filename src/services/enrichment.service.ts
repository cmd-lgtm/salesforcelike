// ============================================
// ENRICHMENT SERVICE
// Auto-enriches company and contact data
// ============================================

import { prisma } from '../config/database';
import { logger } from '../shared/logger';
import { NotFoundError } from '../shared/errors/not-found.error';

export interface EnrichmentData {
    // Company data
    companyName?: string;
    companySize?: string;
    companyRevenue?: string;
    industry?: string;
    website?: string;
    LinkedInUrl?: string;
    techStack?: string[];
    fundingInfo?: string;

    // Contact data
    firstName?: string;
    lastName?: string;
    title?: string;
    email?: string;
    phone?: string;
    LinkedInProfile?: string;

    // Signals
    recentNews?: string[];
    hiringSignals?: string[];
    intentSignals?: string[];
}

export interface EnrichRequest {
    type: 'company' | 'contact';
    identifier: string; // domain or email
    data?: Partial<EnrichmentData>;
}

// ============================================
// ENRICHMENT FUNCTIONS
// ============================================

/**
 * Enrich company data from external sources
 * In production, this would integrate with services like:
 * - Clearbit
 * - ZoomInfo
 * - Apollo
 * - LinkedIn Sales Navigator
 */
export async function enrichCompany(orgId: string, domain: string): Promise<EnrichmentData> {
    logger.info('Enriching company data', { orgId, domain });

    // Mock enrichment data - in production, call external API
    const enrichedData: EnrichmentData = {
        companyName: domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1),
        companySize: '100-500',
        companyRevenue: '$10M-$50M',
        industry: 'Technology',
        website: `https://${domain}`,
        LinkedInUrl: `https://linkedin.com/company/${domain.split('.')[0]}`,
        techStack: ['React', 'Node.js', 'PostgreSQL', 'AWS'],
        fundingInfo: 'Series B, $25M',
        recentNews: [
            'Opened new office in Austin, TX',
            'Hired VP of Sales',
            'Announced partnership with major tech company',
        ],
        hiringSignals: [
            'Hiring 10+ sales reps',
            'Looking for VP of Engineering',
        ],
        intentSignals: [
            'Recently visited pricing page',
            'Downloaded whitepaper',
        ],
    };

    return enrichedData;
}

/**
 * Enrich contact data from external sources
 */
export async function enrichContact(orgId: string, email: string): Promise<EnrichmentData> {
    logger.info('Enriching contact data', { orgId, email });

    const firstName = email.split('@')[0].split('.')[0];
    const lastName = email.split('@')[0].split('.')[1] || '';

    // Mock enrichment data
    const enrichedData: EnrichmentData = {
        firstName: firstName.charAt(0).toUpperCase() + firstName.slice(1),
        lastName: lastName.charAt(0).toUpperCase() + lastName.slice(1),
        title: 'Director of Operations',
        email,
        phone: '+1 (555) 123-4567',
        LinkedInProfile: `https://linkedin.com/in/${firstName}-${lastName}`,
    };

    return enrichedData;
}

/**
 * Auto-enrich a company from the database
 */
export async function autoEnrichCompany(orgId: string, companyId: string) {
    const company = await prisma.account.findFirst({
        where: { id: companyId, orgId },
    });

    if (!company) {
        throw new NotFoundError('Company not found');
    }

    const website = company.website || '';

    if (!website) {
        throw new Error('Company website not available for enrichment');
    }

    const domain = website.replace(/^https?:\/\//, '');
    const enrichedData = await enrichCompany(orgId, domain);

    // Update company record with enriched data
    const updated = await prisma.account.update({
        where: { id: companyId },
        data: {
            // Map enrichment data to company fields
            website: enrichedData.website,
        },
    });

    logger.info('Company auto-enriched', { companyId, orgId });
    return updated;
}

/**
 * Auto-enrich a contact from the database
 */
export async function autoEnrichContact(orgId: string, contactId: string) {
    const contact = await prisma.contact.findFirst({
        where: { id: contactId, orgId },
    });

    if (!contact) {
        throw new NotFoundError('Contact not found');
    }

    if (!contact.email) {
        throw new Error('Contact email not available for enrichment');
    }

    const enrichedData = await enrichContact(orgId, contact.email);

    // Update contact record with enriched data
    const updated = await prisma.contact.update({
        where: { id: contactId },
        data: {
            firstName: enrichedData.firstName || contact.firstName,
            lastName: enrichedData.lastName || contact.lastName,
            title: enrichedData.title || contact.title,
            phone: enrichedData.phone || contact.phone,
        },
    });

    logger.info('Contact auto-enriched', { contactId, orgId });
    return updated;
}

/**
 * Batch enrichment for multiple records
 */
export async function batchEnrich(
    orgId: string,
    type: 'company' | 'contact',
    ids: string[]
) {
    const results = {
        success: [] as string[],
        failed: [] as string[],
    };

    for (const id of ids) {
        try {
            if (type === 'company') {
                await autoEnrichCompany(orgId, id);
            } else {
                await autoEnrichContact(orgId, id);
            }
            results.success.push(id);
        } catch (error) {
            logger.error('Enrichment failed', { id, type, error });
            results.failed.push(id);
        }
    }

    logger.info('Batch enrichment completed', { orgId, type, results });
    return results;
}

// ============================================
// DATA QUALITY
// ============================================

/**
 * Find duplicate contacts based on email
 */
export async function findDuplicateContacts(orgId: string) {
    const contacts = await prisma.contact.findMany({
        where: { orgId, email: { not: null } },
        select: { id: true, email: true, firstName: true, lastName: true },
    });

    const emailMap = new Map<string, string[]>();

    for (const contact of contacts) {
        if (contact.email) {
            const email = contact.email.toLowerCase();
            if (!emailMap.has(email)) {
                emailMap.set(email, []);
            }
            emailMap.get(email)!.push(contact.id);
        }
    }

    const duplicates: { email: string; contactIds: string[] }[] = [];
    for (const [email, ids] of emailMap) {
        if (ids.length > 1) {
            duplicates.push({ email, contactIds: ids });
        }
    }

    return duplicates;
}

/**
 * Merge duplicate contacts
 */
export async function mergeContacts(orgId: string, primaryId: string, secondaryIds: string[]) {
    // Get all secondary contacts
    const secondaryContacts = await prisma.contact.findMany({
        where: { id: { in: secondaryIds }, orgId },
    });

    // Merge data into primary (take first non-null value)
    const mergedData: any = {};

    for (const contact of [await prisma.contact.findUnique({ where: { id: primaryId } }), ...secondaryContacts]) {
        if (contact) {
            if (!mergedData.firstName && contact.firstName) mergedData.firstName = contact.firstName;
            if (!mergedData.lastName && contact.lastName) mergedData.lastName = contact.lastName;
            if (!mergedData.title && contact.title) mergedData.title = contact.title;
            if (!mergedData.phone && contact.phone) mergedData.phone = contact.phone;
        }
    }

    // Update primary contact
    const updated = await prisma.contact.update({
        where: { id: primaryId },
        data: mergedData,
    });

    // Delete secondary contacts
    await prisma.contact.deleteMany({
        where: { id: { in: secondaryIds } },
    });

    logger.info('Contacts merged', { primaryId, secondaryIds, orgId });
    return updated;
}
