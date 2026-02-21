import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authService } from '../../services/auth.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { ValidationError } from '../../shared/errors/validation.error';

const router = Router();

// ============================================
// REQUEST VALIDATION SCHEMAS
// ============================================

const registerSchema = z.object({
    organizationName: z.string().min(1).max(255),
    email: z.string().email(),
    password: z.string().min(8).max(100),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});

const refreshTokenSchema = z.object({
    refreshToken: z.string().min(1),
});

const forgotPasswordSchema = z.object({
    email: z.string().email(),
});

const resetPasswordSchema = z.object({
    token: z.string().min(1),
    password: z.string().min(8).max(100),
});

const verifyEmailSchema = z.object({
    token: z.string().min(1),
});

// ============================================
// VALIDATION HELPER
// ============================================

function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
    const result = schema.safeParse(data);
    if (!result.success) {
        const errors = result.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
            code: 'INVALID_' + err.code.toUpperCase(),
        }));
        throw new ValidationError('Validation failed', errors);
    }
    return result.data;
}

// ============================================
// ROUTES
// ============================================

// POST /auth/register - Register new organization + user
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = validate(registerSchema, req.body);

        const result = await authService.register(
            data,
            req.ip || undefined,
            req.headers['user-agent']
        );

        res.status(201).json({
            success: true,
            data: {
                user: result.user,
                tokens: {
                    accessToken: result.tokens.accessToken,
                    refreshToken: result.tokens.refreshToken,
                },
            },
        });
    } catch (error) {
        next(error);
    }
});

// POST /auth/login - Login with email/password
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = validate(loginSchema, req.body);

        const result = await authService.login(
            data,
            req.ip || undefined,
            req.headers['user-agent']
        );

        res.status(200).json({
            success: true,
            data: {
                user: result.user,
                tokens: {
                    accessToken: result.tokens.accessToken,
                    refreshToken: result.tokens.refreshToken,
                },
            },
        });
    } catch (error) {
        next(error);
    }
});

// POST /auth/logout - Invalidate refresh token
router.post('/logout', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const refreshToken = req.body.refreshToken as string | undefined;

        await authService.logout(req.user!.id, refreshToken);

        res.status(200).json({
            success: true,
            message: 'Logged out successfully',
        });
    } catch (error) {
        next(error);
    }
});

// POST /auth/refresh - Refresh access token
router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = validate(refreshTokenSchema, req.body);

        const tokens = await authService.refreshToken(data.refreshToken);

        res.status(200).json({
            success: true,
            data: {
                tokens: {
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                },
            },
        });
    } catch (error) {
        next(error);
    }
});

// POST /auth/forgot-password - Request password reset
router.post('/forgot-password', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = validate(forgotPasswordSchema, req.body);

        const result = await authService.forgotPassword(data.email);

        // Always return success to prevent email enumeration
        res.status(200).json({
            success: true,
            message: 'If the email exists, a password reset link has been sent',
            // In development, include the token for testing
            ...(process.env.NODE_ENV === 'development' && result ? { devToken: result.resetToken } : {}),
        });
    } catch (error) {
        next(error);
    }
});

// POST /auth/reset-password - Reset password with token
router.post('/reset-password', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = validate(resetPasswordSchema, req.body);

        await authService.resetPassword(data.token, data.password);

        res.status(200).json({
            success: true,
            message: 'Password reset successfully',
        });
    } catch (error) {
        next(error);
    }
});

// GET /auth/me - Get current user profile
router.get('/me', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = await authService.getCurrentUser(req.user!.id);

        if (!user) {
            res.status(404).json({
                success: false,
                error: { code: 'USER_NOT_FOUND', message: 'User not found' },
            });
            return;
        }

        res.status(200).json({
            success: true,
            data: { user },
        });
    } catch (error) {
        next(error);
    }
});

// POST /auth/verify-email - Verify email with token
router.post('/verify-email', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = validate(verifyEmailSchema, req.body);

        await authService.verifyEmail(data.token);

        res.status(200).json({
            success: true,
            message: 'Email verified successfully',
        });
    } catch (error) {
        next(error);
    }
});

// POST /auth/resend-verification - Resend verification email
router.post('/resend-verification', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = validate(forgotPasswordSchema, req.body);

        const result = await authService.resendVerificationEmail(data.email);

        // Always return success to prevent email enumeration
        res.status(200).json({
            success: true,
            message: 'If the email is unverified, a verification link has been sent',
            // In development, include the token for testing
            ...(process.env.NODE_ENV === 'development' && result ? { devToken: result.verificationToken } : {}),
        });
    } catch (error) {
        next(error);
    }
});

export default router;
