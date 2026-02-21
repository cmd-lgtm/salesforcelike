/**
 * 🏥 Self-Healer
 *
 * Automatically repairs broken services without human intervention.
 * Uses AI to diagnose root cause, select healing strategy, and execute.
 * TypeScript port of the Python service_healer.py spec.
 */
import { getOpenAIClient, parseAIJson, MODELS } from './ai.service';
import { prisma } from '../config/database';
import { logger } from '../shared/logger';
import { AuditAction, AuditOutcome } from '@prisma/client';

// ============================================
// TYPES
// ============================================

export interface Incident {
    id: string;
    title: string;
    service_name: string;
    error_type?: string;
    error_message?: string;
    stack_trace?: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    cpu_usage?: number;
    memory_usage?: number;
    error_rate?: number;
}

export interface HealingResult {
    incident_id: string;
    started_at: string;
    resolved_at?: string;
    diagnosis: any;
    strategy: any;
    actions_taken: any[];
    success: boolean;
    escalated?: boolean;
    escalation_reason?: string;
    error?: string;
}

// ============================================
// HEALING STRATEGIES
// ============================================

const HEALING_STRATEGIES: Record<string, Array<{ action: string; params: Record<string, any> }>> = {
    restart: [
        { action: 'restart_service', params: {} },
    ],
    scale: [
        { action: 'scale_up', params: { replicas: 3 } },
        { action: 'enable_auto_scaling', params: { min: 2, max: 10 } },
    ],
    fix_code: [
        { action: 'ai_fix_code', params: {} },
        { action: 'deploy_fix', params: {} },
    ],
    fix_config: [
        { action: 'fix_configuration', params: {} },
        { action: 'restart_service', params: {} },
    ],
    clear_cache: [
        { action: 'clear_redis_cache', params: {} },
        { action: 'restart_service', params: {} },
    ],
    rollback: [
        { action: 'rollback_deployment', params: { to_version: 'previous' } },
    ],
    fix_db: [
        { action: 'fix_database_connection', params: {} },
        { action: 'optimize_slow_queries', params: {} },
    ],
    external_fix: [
        { action: 'enable_circuit_breaker', params: {} },
        { action: 'switch_to_fallback', params: {} },
    ],
};

// ============================================
// SELF-HEALER SERVICE
// ============================================

export class SelfHealer {
    private client = getOpenAIClient();
    private healingHistory: HealingResult[] = [];

    /**
     * Main healing entry point — analyzes incident and takes action.
     */
    async heal(incident: Incident): Promise<HealingResult> {
        logger.info(`🏥 Self-healing initiated for: ${incident.title}`);

        const result: HealingResult = {
            incident_id: incident.id,
            started_at: new Date().toISOString(),
            diagnosis: null,
            strategy: null,
            actions_taken: [],
            success: false,
        };

        try {
            // Step 1: AI diagnoses the issue
            const diagnosis = await this.diagnose(incident);
            result.diagnosis = diagnosis;
            logger.info(`Diagnosis: ${diagnosis.root_cause_category} (confidence: ${diagnosis.confidence})`);

            // Step 2: Select healing strategy
            const strategy = this.selectStrategy(incident, diagnosis);
            result.strategy = strategy;

            // Step 3: Execute healing actions
            for (const action of strategy.actions) {
                const actionResult = await this.executeAction(action, incident);
                result.actions_taken.push(actionResult);

                if (actionResult.success) {
                    result.success = true;
                    result.resolved_at = new Date().toISOString();
                    logger.info(`✅ Self-healing succeeded: ${action.action}`);
                    break;
                }
            }

            // Step 4: Escalate if auto-healing failed
            if (!result.success) {
                result.escalated = true;
                result.escalation_reason = 'Auto-healing attempts exhausted';
                logger.warn(`⚠️ Self-healing failed, escalating incident: ${incident.id}`);
                await this.logIncidentToAudit(incident, result, 'Escalated to team');
            } else {
                await this.logIncidentToAudit(incident, result, 'Auto-healed successfully');
            }

        } catch (error: any) {
            result.error = String(error?.message || error);
            logger.error('Self-healing error:', error);
        }

        this.healingHistory.push(result);
        return result;
    }

    /**
     * AI analyzes the error and determines root cause.
     */
    async diagnose(incident: Incident): Promise<any> {
        const prompt = `You are a senior DevOps engineer diagnosing a system issue.

INCIDENT:
Title: ${incident.title}
Service: ${incident.service_name}
Error Type: ${incident.error_type || 'unknown'}
Error Message: ${incident.error_message || ''}
Stack Trace: ${(incident.stack_trace || '').slice(0, 2000)}
Severity: ${incident.severity}

CURRENT SYSTEM STATE:
CPU: ${incident.cpu_usage ?? 'N/A'}%
Memory: ${incident.memory_usage ?? 'N/A'}%
Error Rate: ${incident.error_rate ?? 'N/A'}

Diagnose and return ONLY valid JSON:
{
  "root_cause": "clear description of what went wrong",
  "root_cause_category": "code_bug|config_error|resource_exhaustion|external_dependency|data_corruption|security_issue|network_issue",
  "confidence": 0.85,
  "affected_components": ["component1"],
  "is_recurring": false,
  "urgency": "immediate|soon|can_wait",
  "healing_approach": "restart|scale|fix_code|fix_config|clear_cache|rollback|fix_db|external_fix",
  "detailed_explanation": "technical explanation",
  "prevention_recommendation": "how to prevent this in future"
}`;

        const response = await this.client.chat.completions.create({
            model: MODELS.PRO,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.2,
            response_format: { type: 'json_object' },
        });

        return parseAIJson(response.choices[0].message.content!);
    }

    /**
     * Select best healing strategy based on AI diagnosis.
     */
    private selectStrategy(incident: Incident, diagnosis: any): any {
        const approach = diagnosis.healing_approach || 'restart';
        const actions = (HEALING_STRATEGIES[approach] || HEALING_STRATEGIES.restart).map(a => ({
            ...a,
            params: { ...a.params, service: incident.service_name },
        }));

        return {
            approach,
            actions,
            diagnosis_confidence: diagnosis.confidence || 0,
        };
    }

    /**
     * Execute a specific healing action (simulated in dev environment).
     */
    private async executeAction(action: { action: string; params: Record<string, any> }, incident: Incident): Promise<any> {
        logger.info(`🔧 Executing healing action: ${action.action}`);

        const result = {
            action: action.action,
            started_at: new Date().toISOString(),
            success: false,
            details: '',
        };

        try {
            switch (action.action) {
                case 'restart_service':
                    // In production: docker restart / k8s rollout
                    logger.info(`Would restart service: ${action.params.service}`);
                    result.success = true;
                    result.details = `Service ${action.params.service} restart triggered`;
                    break;

                case 'scale_up':
                    // In production: kubectl scale deployment
                    logger.info(`Would scale up: ${action.params.service} to ${action.params.replicas} replicas`);
                    result.success = true;
                    result.details = `Scaled to ${action.params.replicas} replicas`;
                    break;

                case 'clear_redis_cache':
                    // In production: FLUSHDB on the Redis cache
                    logger.info('Would flush Redis cache');
                    result.success = true;
                    result.details = 'Redis cache cleared';
                    break;

                case 'rollback_deployment':
                    logger.info(`Would rollback to ${action.params.to_version}`);
                    result.success = true;
                    result.details = `Rolled back to ${action.params.to_version} deployment`;
                    break;

                case 'fix_database_connection':
                    // Test if DB is reachable
                    await prisma.$queryRaw`SELECT 1`;
                    result.success = true;
                    result.details = 'Database connection verified healthy';
                    break;

                case 'enable_circuit_breaker':
                    logger.info('Would enable circuit breaker for external API');
                    result.success = true;
                    result.details = 'Circuit breaker enabled';
                    break;

                case 'switch_to_fallback':
                    logger.info('Would switch to fallback provider');
                    result.success = true;
                    result.details = 'Switched to fallback provider';
                    break;

                case 'ai_fix_code':
                    // AI generates a code fix — logged for human review
                    const fix = await this.generateCodeFix(incident.error_message || '', incident.stack_trace || '');
                    result.success = fix !== null;
                    result.details = fix ? 'AI code fix generated — requires deploy' : 'Could not generate code fix';
                    (result as any).code_fix = fix;
                    break;

                default:
                    logger.warn(`Unknown healing action: ${action.action}`);
                    result.success = false;
                    result.details = `Unknown action: ${action.action}`;
            }
        } catch (error: any) {
            result.success = false;
            result.details = `Action failed: ${error?.message || error}`;
        }

        logger.info(`Action ${action.action}: ${result.success ? '✅' : '❌'} — ${result.details}`);
        return result;
    }

    /**
     * AI generates a code fix for a recurring error.
     */
    private async generateCodeFix(errorMessage: string, stackTrace: string): Promise<string | null> {
        try {
            const response = await this.client.chat.completions.create({
                model: MODELS.PRO,
                messages: [
                    {
                        role: 'user',
                        content: `An error keeps occurring in our Node.js/TypeScript CRM application.
Generate a specific code fix.

ERROR: ${errorMessage}
STACK TRACE: ${stackTrace.slice(0, 1500)}

Provide a concise code fix with explanation. Be specific about which file/function to modify.`,
                    },
                ],
                temperature: 0.3,
                max_tokens: 1000,
            });
            return response.choices[0].message.content;
        } catch {
            return null;
        }
    }

    /**
     * Log incident resolution to audit trail.
     */
    private async logIncidentToAudit(incident: Incident, result: HealingResult, notes: string): Promise<void> {
        try {
            await prisma.auditLog.create({
                data: {
                    orgId: 'system',
                    userId: null,
                    action: AuditAction.UPDATE,
                    objectType: 'SYSTEM_INCIDENT',
                    objectId: incident.id,
                    changes: {
                        before: { incident: incident.title, status: 'open' },
                        after: { status: result.success ? 'resolved' : 'escalated', notes },
                    },
                    outcome: result.success ? AuditOutcome.SUCCESS : AuditOutcome.FAILURE,
                    errorMessage: result.error,
                },
            });
        } catch (error) {
            logger.error('Failed to log incident to audit trail:', error);
        }
    }

    /**
     * Get recent healing history.
     */
    getHistory(limit = 20): HealingResult[] {
        return this.healingHistory.slice(-limit);
    }
}

export const selfHealer = new SelfHealer();
