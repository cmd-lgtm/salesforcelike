import { randomBytes, createHash } from 'crypto';
import { prisma } from '../config/database';
import { NotFoundError } from '../shared/errors/not-found.error';
import { logger } from '../shared/logger';

// ============================================
// TYPES & INTERFACES
// ============================================

export interface CreateApiKeyInput {
    label: string;
    scopes: string[];
    expiresAt?: Date;
}

export interface ApiKeyResponse {
    id: string;
    label: string;
    keyPrefix: string;
    scopes: string[];
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    isActive: boolean;
    createdAt: Date;
}

export interface CreatedApiKey extends ApiKeyResponse {
    // Secret is only returned once on creation
    secret: string;
}

export interface ValidatedApiKey {
    id: string;
    orgId: string;
    scopes: string[];
}

// ============================================
// SCOPE DEFINITIONS
// ============================================

export const API_KEY_SCOPES = {
    // Leads
    READ_LEADS: 'read:leads',
    WRITE_LEADS: 'write:leads',

    // Accounts
    READ_ACCOUNTS: 'read:accounts',
    WRITE_ACCOUNTS: 'write:accounts',

    // Contacts
    READ_CONTACTS: 'read:contacts',
    WRITE_CONTACTS: 'write:contacts',

    // Opportunities
    READ_OPPORTUNITIES: 'read:opportunities',
    WRITE_OPPORTUNITIES: 'write:opportunities',

    // Activities
    READ_ACTIVITIES: 'read:activities',
    WRITE_ACTIVITIES: 'write:activities',

    // Tasks
    READ_TASKS: 'read:tasks',
    WRITE_TASKS: 'write:tasks',

    // Full read
    READ_ALL: 'read:all',

    // Full write
    WRITE_ALL: 'write:all',
} as const;

export type ApiKeyScope = typeof API_KEY_SCOPES[keyof typeof API_KEY_SCOPES];

export const VALID_SCOPES = Object.values(API_KEY_SCOPES);

// ============================================
// SERVICE IMPLEMENTATION
// ============================================

class ApiKeyService {
    // ========================================
    // PRIVATE HELPER METHODS
    // ========================================

    /**
     * Generate a secure random API key
     * Format: sk_live_<32 random bytes hex>
     */
    private generateApiKey(): string {
        const randomPart = randomBytes(32).toString('hex');
        return `sk_live_${randomPart}`;
    }

    /**
     * Hash the API key for storage
     * Uses SHA-256 and stores first 8 chars as prefix for identification
     */
    private hashApiKey(key: string): { keyHash: string; keyPrefix: string } {
        const keyHash = createHash('sha256').update(key).digest('hex');
        const keyPrefix = keyHash.substring(0, 8);
        return { keyHash, keyPrefix };
    }

    /**
     * Validate scopes
     */
    private validateScopes(scopes: string[]): void {
        for (const scope of scopes) {
            if (!VALID_SCOPES.includes(scope as ApiKeyScope)) {
                throw new Error(`Invalid scope: ${scope}. Valid scopes are: ${VALID_SCOPES.join(', ')}`);
            }
        }
    }

    /**
     * Check if a scope grants read access to a resource
     */
    private hasReadAccess(requiredScope: string, apiKeyScopes: string[]): boolean {
        // Check for specific read scope
        if (apiKeyScopes.includes(requiredScope)) {
            return true;
        }

        // Check for read:all
        if (apiKeyScopes.includes(API_KEY_SCOPES.READ_ALL)) {
            return true;
        }

        // Map required scopes to their read equivalents
        const scopeToReadMap: Record<string, string> = {
            'read:leads': API_KEY_SCOPES.READ_LEADS,
            'read:accounts': API_KEY_SCOPES.READ_ACCOUNTS,
            'read:contacts': API_KEY_SCOPES.READ_CONTACTS,
            'read:opportunities': API_KEY_SCOPES.READ_OPPORTUNITIES,
            'read:activities': API_KEY_SCOPES.READ_ACTIVITIES,
            'read:tasks': API_KEY_SCOPES.READ_TASKS,
        };

        return apiKeyScopes.includes(scopeToReadMap[requiredScope] || '');
    }

    /**
     * Check if a scope grants write access to a resource
     */
    private hasWriteAccess(requiredScope: string, apiKeyScopes: string[]): boolean {
        // Check for specific write scope
        if (apiKeyScopes.includes(requiredScope)) {
            return true;
        }

        // Check for write:all
        if (apiKeyScopes.includes(API_KEY_SCOPES.WRITE_ALL)) {
            return true;
        }

        // Map required scopes to their write equivalents
        const scopeToWriteMap: Record<string, string> = {
            'write:leads': API_KEY_SCOPES.WRITE_LEADS,
            'write:accounts': API_KEY_SCOPES.WRITE_ACCOUNTS,
            'write:contacts': API_KEY_SCOPES.WRITE_CONTACTS,
            'write:opportunities': API_KEY_SCOPES.WRITE_OPPORTUNITIES,
            'write:activities': API_KEY_SCOPES.WRITE_ACTIVITIES,
            'write:tasks': API_KEY_SCOPES.WRITE_TASKS,
        };

        return apiKeyScopes.includes(scopeToWriteMap[requiredScope] || '');
    }

    // ========================================
    // PUBLIC METHODS
    // ========================================

    /**
     * Create a new API key
     * Returns the key with the secret (only shown once)
     */
    async createApiKey(
        orgId: string,
        input: CreateApiKeyInput
    ): Promise<CreatedApiKey> {
        // Validate scopes
        this.validateScopes(input.scopes);

        // Generate secure key
        const secret = this.generateApiKey();
        const { keyHash, keyPrefix } = this.hashApiKey(secret);

        // Create API key in database
        const apiKey = await prisma.aPIKey.create({
            data: {
                orgId,
                label: input.label,
                keyHash,
                keyPrefix,
                scopes: input.scopes,
                expiresAt: input.expiresAt,
                isActive: true,
            },
        });

        logger.info(`API key created: ${apiKey.id} for organization: ${orgId}`);

        return {
            id: apiKey.id,
            label: apiKey.label,
            keyPrefix: apiKey.keyPrefix,
            scopes: apiKey.scopes,
            lastUsedAt: apiKey.lastUsedAt,
            expiresAt: apiKey.expiresAt,
            isActive: apiKey.isActive,
            createdAt: apiKey.createdAt,
            secret, // Only returned once!
        };
    }

    /**
     * List all API keys for an organization
     */
    async listApiKeys(orgId: string): Promise<ApiKeyResponse[]> {
        const apiKeys = await prisma.aPIKey.findMany({
            where: { orgId },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                label: true,
                keyPrefix: true,
                scopes: true,
                lastUsedAt: true,
                expiresAt: true,
                isActive: true,
                createdAt: true,
            },
        });

        return apiKeys;
    }

    /**
     * Get a single API key by ID
     * Returns without secret (for security)
     */
    async getApiKey(orgId: string, apiKeyId: string): Promise<ApiKeyResponse> {
        const apiKey = await prisma.aPIKey.findFirst({
            where: { id: apiKeyId, orgId },
        });

        if (!apiKey) {
            throw new NotFoundError('API key not found');
        }

        return {
            id: apiKey.id,
            label: apiKey.label,
            keyPrefix: apiKey.keyPrefix,
            scopes: apiKey.scopes,
            lastUsedAt: apiKey.lastUsedAt,
            expiresAt: apiKey.expiresAt,
            isActive: apiKey.isActive,
            createdAt: apiKey.createdAt,
        };
    }

    /**
     * Revoke (delete) an API key
     */
    async revokeApiKey(orgId: string, apiKeyId: string): Promise<void> {
        const existingKey = await prisma.aPIKey.findFirst({
            where: { id: apiKeyId, orgId },
        });

        if (!existingKey) {
            throw new NotFoundError('API key not found');
        }

        await prisma.aPIKey.delete({
            where: { id: apiKeyId },
        });

        logger.info(`API key revoked: ${apiKeyId} for organization: ${orgId}`);
    }

    /**
     * Validate an API key
     * Returns the validated key info if valid, null if invalid
     */
    async validateApiKey(secret: string): Promise<ValidatedApiKey | null> {
        // Hash the provided key
        const { keyHash } = this.hashApiKey(secret);

        // Find the API key
        const apiKey = await prisma.aPIKey.findFirst({
            where: { keyHash, isActive: true },
        });

        if (!apiKey) {
            return null;
        }

        // Check if key has expired
        if (apiKey.expiresAt && new Date() > apiKey.expiresAt) {
            logger.warn(`API key expired: ${apiKey.id}`);
            return null;
        }

        // Update last used timestamp
        await prisma.aPIKey.update({
            where: { id: apiKey.id },
            data: { lastUsedAt: new Date() },
        });

        return {
            id: apiKey.id,
            orgId: apiKey.orgId,
            scopes: apiKey.scopes,
        };
    }

    /**
     * Check if an API key has a specific permission
     */
    hasPermission(
        validatedKey: ValidatedApiKey,
        requiredScope: string
    ): boolean {
        const { scopes } = validatedKey;

        // Determine if it's a read or write operation
        const isReadOperation = requiredScope.startsWith('read:');
        const isWriteOperation = requiredScope.startsWith('write:');

        if (isReadOperation) {
            return this.hasReadAccess(requiredScope, scopes);
        }

        if (isWriteOperation) {
            return this.hasWriteAccess(requiredScope, scopes);
        }

        // For other operations, check exact match
        return scopes.includes(requiredScope);
    }
}

// ============================================
// EXPORT SINGLETON INSTANCE
// ============================================

export const apiKeyService = new ApiKeyService();
