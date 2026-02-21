import dotenv from 'dotenv';

dotenv.config();

export const config = {
    // Database
    database: {
        url: process.env.DATABASE_URL || 'postgresql://crm_user:crm_password@localhost:5432/salesforcelike',
    },

    // Redis
    redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        queueUrl: process.env.REDIS_QUEUE_URL || 'redis://localhost:6380',
    },

    // Auth
    auth: {
        jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
        jwtExpiryAccess: process.env.JWT_EXPIRY_ACCESS || '15m',
        jwtExpiryRefresh: process.env.JWT_EXPIRY_REFRESH || '7d',
    },

    // OpenAI
    openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        modelFast: process.env.OPENAI_MODEL_FAST || 'gpt-4o-mini',
    },

    // Application
    app: {
        nodeEnv: process.env.NODE_ENV || 'development',
        port: parseInt(process.env.PORT || '3000', 10),
        apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
    },

    // Rate Limiting
    rateLimit: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '1000', 10),
    },

    // CORS
    cors: {
        origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    },

    // Logging
    logging: {
        level: process.env.LOG_LEVEL || 'info',
    },
};

export default config;
