/**
 * 🧠 AI Sales Agent
 *
 * Autonomous AI agent that manages deals through the pipeline.
 * - Analyzes deals and predicts outcomes
 * - Writes follow-up emails autonomously
 * - Detects deal stalling and takes action
 * - Provides coaching to reps
 * - Creates action plans
 */
import { getOpenAIClient, parseAIJson, MODELS } from './ai.service';
import { logger } from '../shared/logger';

// ============================================
// SYSTEM PROMPT
// ============================================

const SALES_AGENT_PROMPT = `You are an elite AI Sales Agent with 20+ years of enterprise sales experience.
You manage deals through the sales pipeline autonomously.

Your personality:
- Data-driven but emotionally intelligent
- Direct and actionable in recommendations
- Understands sales psychology deeply
- Knows when to push and when to pull back
- Always focused on moving deals forward

Your principles:
1. Never fabricate data — only use what you know
2. Be specific — "Call John Tuesday at 3pm" not "Follow up soon"
3. Prioritize high-impact actions
4. Detect risk before it becomes a problem
5. Learn from every interaction`;

// ============================================
// TYPES
// ============================================

export interface DealAnalysis {
    win_probability: number;
    risk_level: 'low' | 'medium' | 'high' | 'critical';
    momentum: 'accelerating' | 'steady' | 'stalling' | 'dying';
    risk_factors: Array<{ risk: string; severity: string; mitigation: string }>;
    strengths: string[];
    recommended_actions: Array<{
        priority: number;
        action: string;
        reason: string;
        deadline: string;
        expected_impact: string;
        can_automate: boolean;
    }>;
    deal_summary: string;
    predicted_close_date: string;
    predicted_amount: number;
    coaching_tips: string[];
    missing_information: string[];
    email_draft?: {
        should_send: boolean;
        to: string;
        subject: string;
        body: string;
        send_time: string;
        purpose: string;
    };
}

export interface PipelineReview {
    pipeline_health: {
        overall_score: number;
        total_pipeline_value: number;
        weighted_pipeline: number;
        deals_at_risk: number;
        deals_stalling: number;
        deals_accelerating: number;
    };
    urgent_actions: Array<{ deal_name: string; action: string; reason: string; impact: string }>;
    deals_needing_attention: Array<{ deal_id: string; deal_name: string; issue: string; recommendation: string; deadline: string }>;
    forecast_update: {
        this_month_prediction: number;
        this_quarter_prediction: number;
        confidence: number;
        upside_deals: string[];
        risk_deals: string[];
    };
    daily_brief: string;
    rep_specific_tasks: Record<string, string[]>;
}

export interface OutreachEmail {
    subject_line: string;
    subject_line_alternatives: string[];
    body: string;
    cta: string;
    personalization_elements: string[];
    predicted_open_rate: number;
    best_send_time: string;
    best_send_day: string;
}

// ============================================
// AI SALES AGENT
// ============================================

export class AISalesAgent {
    private client = getOpenAIClient();

    /**
     * Deep analysis of a single deal — predicts outcome and recommends actions.
     */
    async analyzeDeal(deal: Record<string, any>, activities: any[], contacts: any[]): Promise<DealAnalysis> {
        logger.info(`AI analyzing deal: ${deal.name || deal.id}`);

        const prompt = `Analyze this deal and provide a comprehensive assessment.

DEAL INFORMATION:
Name: ${deal.name}
Amount: $${Number(deal.amount || 0).toLocaleString()}
Stage: ${deal.stage}
Close Date: ${deal.closeDate}
Probability: ${deal.probability}%
ID: ${deal.id}

KEY CONTACTS:
${JSON.stringify(contacts, null, 2)}

RECENT ACTIVITIES (last 20):
${JSON.stringify(activities.slice(-20), null, 2)}

Return ONLY valid JSON:
{
  "win_probability": 0.75,
  "risk_level": "low|medium|high|critical",
  "momentum": "accelerating|steady|stalling|dying",
  "risk_factors": [{ "risk": "...", "severity": "high|medium|low", "mitigation": "..." }],
  "strengths": ["strength1"],
  "recommended_actions": [{
    "priority": 1,
    "action": "specific action",
    "reason": "why this matters",
    "deadline": "when",
    "expected_impact": "what this achieves",
    "can_automate": false
  }],
  "deal_summary": "2-3 sentence plain English summary",
  "predicted_close_date": "YYYY-MM-DD",
  "predicted_amount": 0,
  "coaching_tips": ["tip1"],
  "missing_information": ["what we need to find out"],
  "email_draft": {
    "should_send": true,
    "to": "email",
    "subject": "subject",
    "body": "full email body",
    "send_time": "Tuesday 10am EST",
    "purpose": "reason for email"
  }
}`;

        const response = await this.client.chat.completions.create({
            model: MODELS.PRO,
            messages: [
                { role: 'system', content: SALES_AGENT_PROMPT },
                { role: 'user', content: prompt },
            ],
            temperature: 0.4,
            response_format: { type: 'json_object' },
        });

        return parseAIJson(response.choices[0].message.content!) as DealAnalysis;
    }

    /**
     * AI reviews entire pipeline daily and creates an action plan.
     */
    async runDailyPipelineReview(orgId: string, deals: any[]): Promise<PipelineReview> {
        logger.info(`Daily pipeline review for org ${orgId}: ${deals.length} deals`);

        const totalValue = deals.reduce((sum, d) => sum + Number(d.amount || 0), 0);
        const today = new Date().toISOString().split('T')[0];

        const prompt = `Review the entire sales pipeline for today (${today}).

PIPELINE OVERVIEW:
Total Deals: ${deals.length}
Total Value: $${totalValue.toLocaleString()}

ALL ACTIVE DEALS:
${JSON.stringify(deals, null, 2)}

Create a comprehensive daily action plan and return ONLY valid JSON:
{
  "pipeline_health": {
    "overall_score": 75,
    "total_pipeline_value": ${totalValue},
    "weighted_pipeline": 0,
    "deals_at_risk": 0,
    "deals_stalling": 0,
    "deals_accelerating": 0
  },
  "urgent_actions": [{
    "deal_name": "...",
    "action": "what to do RIGHT NOW",
    "reason": "why urgent",
    "impact": "high|medium"
  }],
  "deals_needing_attention": [{
    "deal_id": "...",
    "deal_name": "...",
    "issue": "what's wrong",
    "recommendation": "what to do",
    "deadline": "when"
  }],
  "forecast_update": {
    "this_month_prediction": 0,
    "this_quarter_prediction": 0,
    "confidence": 0.75,
    "upside_deals": [],
    "risk_deals": []
  },
  "daily_brief": "2-3 paragraph summary for the team",
  "rep_specific_tasks": {
    "rep_name": ["task1", "task2"]
  }
}`;

        const response = await this.client.chat.completions.create({
            model: MODELS.PRO,
            messages: [
                { role: 'system', content: SALES_AGENT_PROMPT },
                { role: 'user', content: prompt },
            ],
            temperature: 0.3,
            response_format: { type: 'json_object' },
        });

        return parseAIJson(response.choices[0].message.content!) as PipelineReview;
    }

    /**
     * Autonomously take action on a stalled deal.
     */
    async handleStalledDeal(deal: Record<string, any>, contacts: any[], lastActivity: any): Promise<any> {
        const daysStalled = deal.daysInCurrentStage || 0;
        logger.info(`Handling stalled deal: ${deal.name} (${daysStalled} days stalled)`);

        const prompt = `This deal has stalled for ${daysStalled} days. Determine and execute autonomous action.

DEAL: ${deal.name} — $${Number(deal.amount || 0).toLocaleString()}
STAGE: ${deal.stage}
LAST ACTIVITY: ${JSON.stringify(lastActivity)}
CONTACTS: ${JSON.stringify(contacts)}

Based on stall duration:
- 7-14 days → value-add follow-up email
- 14-21 days → direct check-in + meeting request
- 21-30 days → escalation email with FOMO
- 30+ days → professional breakup email or stage change

Return ONLY valid JSON:
{
  "action_taken": "description",
  "email": {
    "to": "email",
    "subject": "subject",
    "body": "complete email body",
    "tone": "tone description"
  },
  "crm_updates": {
    "deal_fields_to_update": {},
    "tasks_to_create": [],
    "notes_to_add": ""
  },
  "escalation_needed": false,
  "escalation_reason": ""
}`;

        const response = await this.client.chat.completions.create({
            model: MODELS.PRO,
            messages: [
                { role: 'system', content: SALES_AGENT_PROMPT },
                { role: 'user', content: prompt },
            ],
            temperature: 0.6,
            response_format: { type: 'json_object' },
        });

        return parseAIJson(response.choices[0].message.content!);
    }

    /**
     * Generate highly personalized outreach in the rep's voice.
     */
    async generatePersonalizedOutreach(
        contact: Record<string, any>,
        company: Record<string, any>,
        repStyle: Record<string, any>,
        campaignContext: string
    ): Promise<OutreachEmail> {
        logger.info(`Generating personalized outreach for ${contact.firstName} at ${company.name}`);

        const prompt = `Write a personalized sales email for this prospect.

PROSPECT:
Name: ${contact.firstName} ${contact.lastName}
Title: ${contact.title || 'Unknown'}
Company: ${company.name}
Industry: ${company.industry || 'Unknown'}
Company Size: ${company.employees || 'Unknown'} employees

COMPANY INTELLIGENCE:
${JSON.stringify(company, null, 2)}

REP'S WRITING STYLE:
Tone: ${repStyle.tone || 'professional'}
Length: ${repStyle.length || 'concise (under 150 words)'}
Greeting: ${repStyle.greeting || 'Hi [First Name],'}

CAMPAIGN CONTEXT: ${campaignContext}

REQUIREMENTS:
- Sound like a real human, not AI
- Reference something specific about their company/industry
- Lead with value, not features
- Keep under 150 words
- Include a soft CTA
- Write in the rep's personal style

Return ONLY valid JSON:
{
  "subject_line": "...",
  "subject_line_alternatives": ["alt1", "alt2", "alt3"],
  "body": "full email body",
  "cta": "the call to action",
  "personalization_elements": ["what was personalized"],
  "predicted_open_rate": 0.35,
  "best_send_time": "10:00 EST",
  "best_send_day": "Tuesday"
}`;

        const response = await this.client.chat.completions.create({
            model: MODELS.PRO,
            messages: [
                { role: 'system', content: SALES_AGENT_PROMPT },
                { role: 'user', content: prompt },
            ],
            temperature: 0.7,
            response_format: { type: 'json_object' },
        });

        return parseAIJson(response.choices[0].message.content!) as OutreachEmail;
    }
}

export const salesAgent = new AISalesAgent();
