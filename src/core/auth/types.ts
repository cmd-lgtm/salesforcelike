import { Role } from '@prisma/client';

export type TokenType = 'access' | 'refresh' | 'password_reset' | 'email_verification';

export interface TokenPayload {
    sub: string;        // User ID
    org_id: string;     // Organization ID
    role: Role;         // User role
    email: string;      // User email
    type: TokenType;
    iat: number;        // Issued at
    exp: number;        // Expiration
    jti: string;        // Token ID for revocation
    token_family?: string;
}

export interface AuthTokens {
    accessToken: string;
    refreshToken: string;
    jti: string;
    tokenFamily: string;
}

export interface UserResponse {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: Role;
    orgId: string;
    organizationName: string;
}

export interface LoginRequest {
    email: string;
    password: string;
}

export interface RegisterRequest {
    organizationName: string;
    email: string;
    password: string;
    firstName: string;
    lastName: string;
}

export interface RefreshTokenRequest {
    refreshToken: string;
}
