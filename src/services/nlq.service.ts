/**
 * 💬 Natural Language Query Engine
 *
 * Converts plain English CRM questions into:
 *   - SQL queries ("Show me deals closing this month")
 *   - CRM actions ("Add John from Tesla as a lead")
 *   - AI analysis ("Why did we lose the Acme deal?")
 *   - Daily brief ("What should I focus on today?")
 *   - Reports ("Create a Q4 pipeline report")
 */
import { getOpenAIClient, parseAIJson, MODELS } from './ai.service';
import { logger } from '../shared/logger';

// ============================================
// TYPES
// ============================================

export interface NLQUser {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
    orgId: string;
}

export interface NLQResponse {
    type: 'query' | 'action' | 'analysis' | 'report' | 'brief' | 'general';
    [key: string]: any;
}

// ============================================
// SYSTEM PROMPT
// ============================================

const SYSTEM_PROMPT = `You are NexusCRM's AI assistant. You understand natural language commands
about sales, CRM, and business operations.

DATABASE SCHEMA:
- users (id, orgId, firstName, lastName, email, role)
- accounts (id, orgId, ownerId, name, website, industry, annualRevenue, employees, phone)
- contacts (id, orgId, ownerId, accountId, firstName, lastName, title, email, phone, department)
- opportunities (id, orgId, ownerId, accountId, contactId, name, stage, amount, probability, closeDate)
- leads (id, orgId, ownerId, firstName, lastName, company, email, phone, status, source, converted)
- activities (id, orgId, ownerId, relatedToType, relatedToId, type, subject, description, activityDate)
- tasks (id, orgId, ownerId, relatedToType, relatedToId, subject, description, dueDate, status, priority)

RULES:
1. Classify the user's intent: query, action, analysis, report, brief, or general
2. For queries: generate safe, read-only SQL (SELECT only)
3. For actions: specify the exact CRM action to take
4. For analysis: provide data-driven insights
5. NEVER generate destructive SQL (DELETE, DROP, TRUNCATE, UPDATE, INSERT)
6. Always filter by orgId for multi-tenant security
7. Be specific and actionable`;

// ============================================
// NLQ ENGINE
// ============================================

export class NaturalLanguageQueryEngine {
    private client = getOpenAIClient();

    /**
     * Main entry point: process any natural language CRM query
     */
    async processQuery(query: string, user: NLQUser, orgId: string): Promise<NLQResponse> {
        logger.info(`NLQ query from user ${user.id}: "${query}"`);

        const classification = await this.classifyIntent(query);
        logger.info(`NLQ intent: ${classification.intent}`);

        switch (classification.intent) {
            case 'query':
                return this.handleDataQuery(query, orgId, classification);
            case 'action':
                return this.handleAction(query, user, orgId, classification);
            case 'analysis':
                return this.handleAnalysis(query, orgId, classification);
            case 'report':
                return this.handleReport(query, orgId, classification);
            case 'brief':
                return this.handleDailyBrief(user, orgId);
            default:
                return this.handleGeneral(query, orgId);
        }
    }

    // ----------------------------------------
    // STEP 1: CLASSIFY INTENT
    // ----------------------------------------
    private async classifyIntent(query: string): Promise<any> {
        const response = await this.client.chat.completions.create({
            model: MODELS.FAST,
            messages: [
                {
                    role: 'user',
                    content: `Classify this CRM query and return JSON:

"${query}"

Return:
{
  "intent": "query|action|analysis|report|brief|general",
  "sub_intent": "specific sub-category",
  "entities": {
    "contacts": [],
    "companies": [],
    "deals": [],
    "amounts": [],
    "dates": [],
    "stages": [],
    "metrics": []
  },
  "time_period": "today|this_week|this_month|this_quarter|all_time",
  "filters": []
}`,
                },
            ],
            temperature: 0.1,
            response_format: { type: 'json_object' },
        });

        return parseAIJson(response.choices[0].message.content!);
    }

    // ----------------------------------------
    // HANDLE: DATA QUERY → SQL
    // ----------------------------------------
    private async handleDataQuery(query: string, orgId: string, classification: any): Promise<NLQResponse> {
        const response = await this.client.chat.completions.create({
            model: MODELS.PRO,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: `Convert this to safe PostgreSQL (SELECT only):

QUERY: "${query}"
ORG_ID: '${orgId}'
CLASSIFICATION: ${JSON.stringify(classification)}

Rules:
- Always WHERE orgId = '${orgId}'
- LIMIT 100 max
- SELECT only — no mutations
- Use readable column aliases

Return JSON:
{
  "sql": "SELECT ...",
  "explanation": "plain English explanation",
  "visualization": "table|bar_chart|line_chart|pie_chart|number",
  "columns": ["col1", "col2"],
  "title": "Good title for results"
}`,
                },
            ],
            temperature: 0.1,
            response_format: { type: 'json_object' },
        });

        const result = parseAIJson(response.choices[0].message.content!);

        return {
            type: 'query',
            sql: result.sql,
            explanation: result.explanation,
            visualization: result.visualization || 'table',
            columns: result.columns || [],
            title: result.title || query,
            natural_language_response: `Here are the results for: ${query}`,
        };
    }

    // ----------------------------------------
    // HANDLE: CRM ACTION
    // ----------------------------------------
    private async handleAction(query: string, user: NLQUser, orgId: string, classification: any): Promise<NLQResponse> {
        const response = await this.client.chat.completions.create({
            model: MODELS.PRO,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: `The user wants to perform a CRM action:

QUERY: "${query}"
USER: ${user.firstName} ${user.lastName} (${user.role})
ORG_ID: '${orgId}'
CLASSIFICATION: ${JSON.stringify(classification)}

Return JSON:
{
  "action_type": "create_contact|create_deal|update_deal|create_task|send_email|schedule_meeting|add_note|update_contact|create_lead",
  "action_data": {},
  "confirmation_message": "What to confirm with user before executing",
  "requires_confirmation": true,
  "auto_fill_suggestions": {}
}`,
                },
            ],
            temperature: 0.2,
            response_format: { type: 'json_object' },
        });

        return {
            type: 'action',
            ...parseAIJson(response.choices[0].message.content!),
        };
    }

    // ----------------------------------------
    // HANDLE: AI ANALYSIS
    // ----------------------------------------
    private async handleAnalysis(query: string, orgId: string, _classification: any): Promise<NLQResponse> {
        const response = await this.client.chat.completions.create({
            model: MODELS.PRO,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: `Provide a detailed CRM analysis:

QUERY: "${query}"
ORG_ID: '${orgId}'

Return JSON:
{
  "analysis": "Detailed analysis in plain English",
  "key_findings": ["finding1", "finding2", "finding3"],
  "data_points": [
    { "metric": "name", "value": "value", "trend": "up|down|flat" }
  ],
  "recommendations": [
    { "action": "what to do", "impact": "expected impact", "priority": "high|medium|low" }
  ]
}`,
                },
            ],
            temperature: 0.4,
            response_format: { type: 'json_object' },
        });

        return {
            type: 'analysis',
            ...parseAIJson(response.choices[0].message.content!),
        };
    }

    // ----------------------------------------
    // HANDLE: REPORT GENERATION
    // ----------------------------------------
    private async handleReport(query: string, orgId: string, _classification: any): Promise<NLQResponse> {
        const response = await this.client.chat.completions.create({
            model: MODELS.PRO,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: `Generate a structured CRM report plan:

QUERY: "${query}"
ORG_ID: '${orgId}'

Return JSON:
{
  "report_title": "Title of the report",
  "sections": [
    { "title": "Section Name", "description": "What this section shows", "sql": "SELECT ..." }
  ],
  "summary": "What this report covers",
  "suggested_visualizations": ["bar_chart", "line_chart"]
}`,
                },
            ],
            temperature: 0.3,
            response_format: { type: 'json_object' },
        });

        return {
            type: 'report',
            ...parseAIJson(response.choices[0].message.content!),
        };
    }

    // ----------------------------------------
    // HANDLE: DAILY BRIEF
    // ----------------------------------------
    private async handleDailyBrief(user: NLQUser, _orgId: string): Promise<NLQResponse> {
        const firstName = user.firstName || 'there';
        const hour = new Date().getHours();
        const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

        return {
            type: 'brief',
            greeting: `Good ${greeting}, ${firstName}! Here's your daily brief:`,
            sections: [
                {
                    title: '🎯 Today\'s Priority Deals',
                    content: 'Fetching your highest-priority deals for today...',
                },
                {
                    title: '📧 Follow-ups Needed',
                    content: 'Checking for overdue follow-ups across your pipeline...',
                },
                {
                    title: '📊 Pipeline Health',
                    content: 'Analyzing your current pipeline status and trends...',
                },
                {
                    title: '⚠️ Risk Alerts',
                    content: 'Scanning for deals showing signs of stalling...',
                },
                {
                    title: '🏆 Recent Wins',
                    content: 'Summarizing your wins from the past 7 days...',
                },
            ],
        };
    }

    // ----------------------------------------
    // HANDLE: GENERAL / CATCH-ALL
    // ----------------------------------------
    private async handleGeneral(query: string, _orgId: string): Promise<NLQResponse> {
        const response = await this.client.chat.completions.create({
            model: MODELS.PRO,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: query },
            ],
            temperature: 0.5,
        });

        return {
            type: 'general',
            answer: response.choices[0].message.content,
        };
    }
}

export const nlqEngine = new NaturalLanguageQueryEngine();
