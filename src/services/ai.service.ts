import OpenAI from 'openai';
import { config } from '../config';
import { logger } from '../shared/logger';

// ============================================
// OPENAI CLIENT SINGLETON
// ============================================

let _client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
    if (!_client) {
        if (!config.openai.apiKey) {
            logger.warn('OPENAI_API_KEY is not set — AI features will not work');
        }
        _client = new OpenAI({
            apiKey: config.openai.apiKey || 'missing-key',
        });
    }
    return _client;
}

// ============================================
// SHARED HELPERS
// ============================================

/**
 * Parse JSON from an AI response safely.
 * GPT sometimes wraps JSON in ```json ... ``` fences.
 */
export function parseAIJson(content: string): any {
    try {
        // Strip markdown code fences if present
        const cleaned = content
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();
        return JSON.parse(cleaned);
    } catch {
        logger.error('Failed to parse AI JSON response', { content: content.slice(0, 200) });
        throw new Error('AI returned invalid JSON');
    }
}

export const MODELS = {
    FAST: 'gpt-4o-mini',   // Classification, quick tasks
    PRO: 'gpt-4o',        // Deep analysis, code, complex tasks
} as const;
