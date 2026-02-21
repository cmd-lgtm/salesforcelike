import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../config/database';
import { config } from '../config/index';
import { logger } from '../shared/logger';
import { UnauthorizedError } from '../shared/errors/unauthorized.error';
import { ValidationError } from '../shared/errors/validation.error';
import { TokenPayload, AuthTokens, UserResponse, RegisterRequest, LoginRequest } from '../core/auth/types';
import { Role, AuditAction, AuditOutcome } from '@prisma/client';

// ============================================
// CONSTANTS
// ============================================

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 30;
const PASSWORD_RESET_EXPIRY_HOURS = 1;
const EMAIL_VERIFICATION_EXPIRY_HOURS = 24;

// ============================================
// TOKEN GENERATION
// ============================================

function generateTokens(userId: string, orgId: string, email: string, role: Role): AuthTokens {
    const jti = uuidv4();
    const tokenFamily = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    const accessTokenPayload = {
        sub: userId,
        org_id: orgId,
        role,
        email,
        type: 'access' as const,
        jti,
        token_family: tokenFamily,
    };

    const refreshTokenPayload = {
        sub: userId,
        org_id: orgId,
        role,
        email,
        type: 'refresh' as const,
        jti: uuidv4(),
        token_family: tokenFamily,
    };

    const accessToken = jwt.sign(
        { ...accessTokenPayload, iat: now },
        config.auth.jwtSecret,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { expiresIn: config.auth.jwtExpiryAccess as any }
    );

    const refreshToken = jwt.sign(
        { ...refreshTokenPayload, iat: now },
        config.auth.jwtSecret,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { expiresIn: config.auth.jwtExpiryRefresh as any }
    );

    return {
        accessToken,
        refreshToken,
        jti,
        tokenFamily,
    };
}

// ============================================
// AUDIT LOGGING
// ============================================

async function createAuditLog(
    orgId: string,
    userId: string | null,
    action: AuditAction,
    objectType: string,
    objectId?: string,
    outcome: AuditOutcome = AuditOutcome.SUCCESS,
    errorMessage?: string,
    ipAddress?: string,
    userAgent?: string
): Promise<void> {
    try {
        await prisma.auditLog.create({
            data: {
                orgId,
                userId,
                action,
                objectType,
                objectId,
                outcome,
                errorMessage,
                ipAddress,
                userAgent,
            },
        });
    } catch (error) {
        logger.error('Failed to create audit log:', error);
    }
}

// ============================================
// AUTHENTICATION SERVICE
// ============================================

export const authService = {
    // ----------------------------------------
    // REGISTER NEW USER + ORGANIZATION
    // ----------------------------------------
    async register(data: RegisterRequest, ipAddress?: string, userAgent?: string): Promise<{ user: UserResponse; tokens: AuthTokens }> {
        logger.info(`Registration attempt for email: ${data.email}`);

        // Check if email already exists
        const existingUser = await prisma.user.findFirst({
            where: { email: data.email },
        });

        if (existingUser) {
            throw new ValidationError('Email already registered', [
                { field: 'email', message: 'This email is already registered', code: 'EMAIL_EXISTS' },
            ]);
        }

        // Hash password
        const passwordHash = await bcrypt.hash(data.password, 12);

        // Check if this is the first user (will become the org admin)
        const userCount = await prisma.user.count();

        // Create organization and user in a transaction
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await prisma.$transaction(async (tx: any) => {
            // Create organization
            const org = await tx.organization.create({
                data: {
                    name: data.organizationName,
                    seatsTotal: 5,
                    seatsUsed: 1,
                },
            });

            // Create admin user
            const user = await tx.user.create({
                data: {
                    orgId: org.id,
                    email: data.email.toLowerCase(),
                    passwordHash,
                    firstName: data.firstName,
                    lastName: data.lastName,
                    role: userCount === 0 ? Role.ADMIN : Role.REP,
                    emailVerified: userCount === 0, // Auto-verify first user
                },
                include: { organization: true },
            });

            // Generate tokens
            const tokens = generateTokens(user.id, user.orgId, user.email, user.role);

            // Create session for refresh token
            await tx.session.create({
                data: {
                    userId: user.id,
                    jti: tokens.jti,
                    tokenFamily: tokens.tokenFamily,
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
                    ipAddress,
                    userAgent,
                },
            });

            // Create audit log
            await tx.auditLog.create({
                data: {
                    orgId: org.id,
                    userId: user.id,
                    action: AuditAction.CREATE,
                    objectType: 'USER',
                    objectId: user.id,
                    outcome: AuditOutcome.SUCCESS,
                    ipAddress,
                    userAgent,
                },
            });

            return { user, tokens };
        });

        logger.info(`User registered successfully: ${result.user.id}`);

        return {
            user: {
                id: result.user.id,
                email: result.user.email,
                firstName: result.user.firstName,
                lastName: result.user.lastName,
                role: result.user.role,
                orgId: result.user.orgId,
                organizationName: result.user.organization.name,
            },
            tokens: result.tokens,
        };
    },

    // ----------------------------------------
    // LOGIN
    // ----------------------------------------
    async login(data: LoginRequest, ipAddress?: string, userAgent?: string): Promise<{ user: UserResponse; tokens: AuthTokens }> {
        logger.info(`Login attempt for email: ${data.email}`);

        const user = await prisma.user.findFirst({
            where: { email: data.email.toLowerCase() },
            include: { organization: true },
        });

        if (!user) {
            // Use consistent timing to prevent timing attacks
            await bcrypt.hash('dummy-password', 12);
            throw new UnauthorizedError('Invalid email or password');
        }

        // Check if account is locked
        if (user.lockedUntil && user.lockedUntil > new Date()) {
            const remainingMinutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
            throw new UnauthorizedError(`Account is locked. Try again in ${remainingMinutes} minutes`);
        }

        // Check if user is active
        if (!user.isActive) {
            await createAuditLog(
                user.orgId,
                user.id,
                AuditAction.LOGIN,
                'USER',
                user.id,
                AuditOutcome.FAILURE,
                'Account is deactivated',
                ipAddress,
                userAgent
            );
            throw new UnauthorizedError('Account is deactivated');
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(data.password, user.passwordHash);

        if (!isValidPassword) {
            // Increment failed attempts
            const failedAttempts = user.failedLoginAttempts + 1;
            const updateData: { failedLoginAttempts: number; lockedUntil?: Date | null } = {
                failedLoginAttempts: failedAttempts,
            };

            // Lock account if max attempts reached
            if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
                updateData.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000);
                logger.warn(`Account locked due to failed login attempts: ${user.email}`);
            }

            await prisma.user.update({
                where: { id: user.id },
                data: updateData,
            });

            await createAuditLog(
                user.orgId,
                user.id,
                AuditAction.LOGIN,
                'USER',
                user.id,
                AuditOutcome.FAILURE,
                'Invalid password',
                ipAddress,
                userAgent
            );

            throw new UnauthorizedError('Invalid email or password');
        }

        // Reset failed attempts on successful login
        await prisma.user.update({
            where: { id: user.id },
            data: {
                failedLoginAttempts: 0,
                lockedUntil: null,
                lastLoginAt: new Date(),
            },
        });

        // Generate tokens
        const tokens = generateTokens(user.id, user.orgId, user.email, user.role);

        // Create session for refresh token
        await prisma.session.create({
            data: {
                userId: user.id,
                jti: tokens.jti,
                tokenFamily: tokens.tokenFamily,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                ipAddress,
                userAgent,
            },
        });

        // Log successful login
        await createAuditLog(
            user.orgId,
            user.id,
            AuditAction.LOGIN,
            'USER',
            user.id,
            AuditOutcome.SUCCESS,
            undefined,
            ipAddress,
            userAgent
        );

        logger.info(`User logged in successfully: ${user.id}`);

        return {
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
                orgId: user.orgId,
                organizationName: user.organization.name,
            },
            tokens,
        };
    },

    // ----------------------------------------
    // LOGOUT
    // ----------------------------------------
    async logout(userId: string, refreshToken?: string): Promise<void> {
        logger.info(`Logout for user: ${userId}`);

        if (refreshToken) {
            // Invalidate specific refresh token
            try {
                const decoded = jwt.verify(refreshToken, config.auth.jwtSecret) as TokenPayload;

                // Delete the session
                await prisma.session.deleteMany({
                    where: { jti: decoded.jti },
                });

                // Logout audit
                const user = await prisma.user.findUnique({ where: { id: userId } });
                if (user) {
                    await createAuditLog(
                        user.orgId,
                        user.id,
                        AuditAction.LOGOUT,
                        'USER',
                        user.id
                    );
                }
            } catch {
                // Token invalid, ignore
            }
        } else {
            // Invalidate all user sessions (all tokens)
            await prisma.session.deleteMany({
                where: { userId },
            });
        }

        logger.info(`User logged out: ${userId}`);
    },

    // ----------------------------------------
    // REFRESH TOKEN (with rotation)
    // ----------------------------------------
    async refreshToken(refreshToken: string): Promise<AuthTokens> {
        try {
            const decoded = jwt.verify(refreshToken, config.auth.jwtSecret) as TokenPayload;

            if (decoded.type !== 'refresh') {
                throw new UnauthorizedError('Invalid token type');
            }

            // Find the session
            const session = await prisma.session.findUnique({
                where: { jti: decoded.jti },
                include: { user: { include: { organization: true } } },
            });

            if (!session) {
                throw new UnauthorizedError('Session not found or expired');
            }

            if (session.expiresAt < new Date()) {
                throw new UnauthorizedError('Session expired');
            }

            // Check if user is still active
            if (!session.user.isActive) {
                throw new UnauthorizedError('Account is deactivated');
            }

            // Token rotation: invalidate old refresh token and generate new ones
            const newTokens = generateTokens(
                session.user.id,
                session.user.orgId,
                session.user.email,
                session.user.role
            );

            // Delete old session
            await prisma.session.delete({
                where: { id: session.id },
            });

            // Create new session with same token family (for potential future revocation)
            await prisma.session.create({
                data: {
                    userId: session.user.id,
                    jti: newTokens.jti,
                    tokenFamily: session.tokenFamily, // Keep same family
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                },
            });

            logger.info(`Token refreshed for user: ${session.user.id}`);

            return newTokens;
        } catch (error) {
            if (error instanceof UnauthorizedError) {
                throw error;
            }
            logger.error('Token refresh failed:', error);
            throw new UnauthorizedError('Invalid or expired refresh token');
        }
    },

    // ----------------------------------------
    // VERIFY ACCESS TOKEN
    // ----------------------------------------
    async verifyAccessToken(accessToken: string): Promise<TokenPayload> {
        try {
            const decoded = jwt.verify(accessToken, config.auth.jwtSecret) as TokenPayload;

            if (decoded.type !== 'access') {
                throw new UnauthorizedError('Invalid token type');
            }

            // Check if session still exists (for token revocation)
            const session = await prisma.session.findUnique({
                where: { jti: decoded.jti },
            });

            if (!session) {
                throw new UnauthorizedError('Session expired or invalidated');
            }

            if (session.expiresAt < new Date()) {
                throw new UnauthorizedError('Session expired');
            }

            return decoded;
        } catch (error) {
            if (error instanceof UnauthorizedError) {
                throw error;
            }
            logger.error('Token verification failed:', error);
            throw new UnauthorizedError('Invalid or expired access token');
        }
    },

    // ----------------------------------------
    // GET CURRENT USER
    // ----------------------------------------
    async getCurrentUser(userId: string): Promise<UserResponse | null> {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { organization: true },
        });

        if (!user) {
            return null;
        }

        return {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            orgId: user.orgId,
            organizationName: user.organization.name,
        };
    },

    // ----------------------------------------
    // FORGOT PASSWORD
    // ----------------------------------------
    async forgotPassword(email: string): Promise<{ resetToken: string } | null> {
        logger.info(`Password reset request for email: ${email}`);

        const user = await prisma.user.findFirst({
            where: { email: email.toLowerCase() },
        });

        if (!user) {
            // Don't reveal if email exists
            return null;
        }

        // Generate password reset token (valid for 1 hour)
        const resetToken = jwt.sign(
            { sub: user.id, type: 'password_reset', iat: Math.floor(Date.now() / 1000) },
            config.auth.jwtSecret,
            { expiresIn: `${PASSWORD_RESET_EXPIRY_HOURS}h` }
        );

        // In production, send email with reset link
        // For now, return the token (in production, would send via email)
        logger.info(`Password reset token generated for user: ${user.id}`);

        return { resetToken };
    },

    // ----------------------------------------
    // RESET PASSWORD
    // ----------------------------------------
    async resetPassword(token: string, newPassword: string): Promise<void> {
        try {
            const decoded = jwt.verify(token, config.auth.jwtSecret) as TokenPayload & { type: string };

            if (decoded.type !== 'password_reset') {
                throw new UnauthorizedError('Invalid token type');
            }

            const user = await prisma.user.findUnique({
                where: { id: decoded.sub },
            });

            if (!user) {
                throw new UnauthorizedError('User not found');
            }

            // Hash new password
            const passwordHash = await bcrypt.hash(newPassword, 12);

            // Update password and invalidate all sessions
            await prisma.$transaction([
                prisma.user.update({
                    where: { id: user.id },
                    data: {
                        passwordHash,
                        failedLoginAttempts: 0,
                        lockedUntil: null,
                    },
                }),
                prisma.session.deleteMany({
                    where: { userId: user.id },
                }),
            ]);

            await createAuditLog(
                user.orgId,
                user.id,
                AuditAction.UPDATE,
                'USER',
                user.id,
                AuditOutcome.SUCCESS,
                'Password reset'
            );

            logger.info(`Password reset for user: ${user.id}`);
        } catch (error) {
            if (error instanceof UnauthorizedError) {
                throw error;
            }
            logger.error('Password reset failed:', error);
            throw new UnauthorizedError('Invalid or expired reset token');
        }
    },

    // ----------------------------------------
    // VERIFY EMAIL
    // ----------------------------------------
    async verifyEmail(token: string): Promise<void> {
        try {
            const decoded = jwt.verify(token, config.auth.jwtSecret) as TokenPayload & { type: string };

            if (decoded.type !== 'email_verification') {
                throw new UnauthorizedError('Invalid token type');
            }

            const user = await prisma.user.findUnique({
                where: { id: decoded.sub },
            });

            if (!user) {
                throw new UnauthorizedError('User not found');
            }

            if (user.emailVerified) {
                // Already verified
                return;
            }

            await prisma.user.update({
                where: { id: user.id },
                data: { emailVerified: true },
            });

            await createAuditLog(
                user.orgId,
                user.id,
                AuditAction.UPDATE,
                'USER',
                user.id,
                AuditOutcome.SUCCESS,
                'Email verified'
            );

            logger.info(`Email verified for user: ${user.id}`);
        } catch (error) {
            if (error instanceof UnauthorizedError) {
                throw error;
            }
            logger.error('Email verification failed:', error);
            throw new UnauthorizedError('Invalid or expired verification token');
        }
    },

    // ----------------------------------------
    // RESEND VERIFICATION EMAIL
    // ----------------------------------------
    async resendVerificationEmail(email: string): Promise<{ verificationToken: string } | null> {
        const user = await prisma.user.findFirst({
            where: { email: email.toLowerCase() },
        });

        if (!user) {
            // Don't reveal if email exists
            return null;
        }

        if (user.emailVerified) {
            // Already verified
            return null;
        }

        // Generate verification token
        const verificationToken = jwt.sign(
            { sub: user.id, type: 'email_verification', iat: Math.floor(Date.now() / 1000) },
            config.auth.jwtSecret,
            { expiresIn: `${EMAIL_VERIFICATION_EXPIRY_HOURS}h` }
        );

        // In production, send email
        logger.info(`Verification email token generated for user: ${user.id}`);

        return { verificationToken };
    },
};

export default authService;
