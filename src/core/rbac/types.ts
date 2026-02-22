export enum Role {
    ADMIN = 'ADMIN',
    MANAGER = 'MANAGER',
    REP = 'REP',
    READ_ONLY = 'READ_ONLY',
}

export enum Permission {
    // Organization
    ORG_READ = 'org:read',
    ORG_UPDATE = 'org:update',
    ORG_DELETE = 'org:delete',

    // Users
    USER_CREATE = 'user:create',
    USER_READ = 'user:read',
    USER_UPDATE = 'user:update',
    USER_DELETE = 'user:delete',

    // Leads
    LEAD_CREATE = 'lead:create',
    LEAD_READ = 'lead:read',
    LEAD_UPDATE = 'lead:update',
    LEAD_DELETE = 'lead:delete',
    LEAD_CONVERT = 'lead:convert',

    // Accounts
    ACCOUNT_CREATE = 'account:create',
    ACCOUNT_READ = 'account:read',
    ACCOUNT_UPDATE = 'account:update',
    ACCOUNT_DELETE = 'account:delete',

    // Contacts
    CONTACT_CREATE = 'contact:create',
    CONTACT_READ = 'contact:read',
    CONTACT_UPDATE = 'contact:update',
    CONTACT_DELETE = 'contact:delete',

    // Opportunities
    OPPORTUNITY_CREATE = 'opportunity:create',
    OPPORTUNITY_READ = 'opportunity:read',
    OPPORTUNITY_UPDATE = 'opportunity:update',
    OPPORTUNITY_DELETE = 'opportunity:delete',
    OPPORTUNITY_CHANGE_STAGE = 'opportunity:change_stage',

    // Activities
    ACTIVITY_CREATE = 'activity:create',
    ACTIVITY_READ = 'activity:read',
    ACTIVITY_UPDATE = 'activity:update',
    ACTIVITY_DELETE = 'activity:delete',

    // Tasks
    TASK_CREATE = 'task:create',
    TASK_READ = 'task:read',
    TASK_UPDATE = 'task:update',
    TASK_DELETE = 'task:delete',
    TASK_COMPLETE = 'task:complete',

    // API Keys
    API_KEY_CREATE = 'api_key:create',
    API_KEY_READ = 'api_key:read',
    API_KEY_DELETE = 'api_key:delete',

    // Billing
    BILLING_READ = 'billing:read',
    BILLING_UPDATE = 'billing:update',

    // Data
    REPORT_RUN = 'report:run',
    IMPORT_CREATE = 'import:create',
    EXPORT_CREATE = 'export:create',

    // Audit
    AUDIT_READ = 'audit:read',
    AUDIT_EXPORT = 'audit:export',

    // Meetings
    MEETING_CREATE = 'meeting:create',
    MEETING_READ = 'meeting:read',
    MEETING_UPDATE = 'meeting:update',
    MEETING_DELETE = 'meeting:delete',
    MEETING_AI_ANALYSIS = 'meeting:ai_analysis',

    // Email
    EMAIL_CREATE = 'email:create',
    EMAIL_READ = 'email:read',
    EMAIL_SEND = 'email:send',

    // Automation
    AUTOMATION_CREATE = 'automation:create',
    AUTOMATION_READ = 'automation:read',
    AUTOMATION_UPDATE = 'automation:update',
    AUTOMATION_DELETE = 'automation:delete',
    AUTOMATION_EXECUTE = 'automation:execute',

    // Analytics
    ANALYTICS_READ = 'analytics:read',
    FORECAST_READ = 'forecast:read',

    // Enrichment
    ENRICHMENT_RUN = 'enrichment:run',

    // Notifications
    NOTIFICATION_SEND = 'notification:send',
    NOTIFICATION_READ = 'notification:read',
}

// Role to Permission mapping
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
    [Role.ADMIN]: Object.values(Permission),

    [Role.MANAGER]: [
        Permission.ORG_READ,
        Permission.USER_READ,
        Permission.USER_UPDATE,
        Permission.LEAD_CREATE,
        Permission.LEAD_READ,
        Permission.LEAD_UPDATE,
        Permission.LEAD_DELETE,
        Permission.LEAD_CONVERT,
        Permission.ACCOUNT_CREATE,
        Permission.ACCOUNT_READ,
        Permission.ACCOUNT_UPDATE,
        Permission.ACCOUNT_DELETE,
        Permission.CONTACT_CREATE,
        Permission.CONTACT_READ,
        Permission.CONTACT_UPDATE,
        Permission.CONTACT_DELETE,
        Permission.OPPORTUNITY_CREATE,
        Permission.OPPORTUNITY_READ,
        Permission.OPPORTUNITY_UPDATE,
        Permission.OPPORTUNITY_DELETE,
        Permission.OPPORTUNITY_CHANGE_STAGE,
        Permission.ACTIVITY_CREATE,
        Permission.ACTIVITY_READ,
        Permission.ACTIVITY_UPDATE,
        Permission.ACTIVITY_DELETE,
        Permission.TASK_CREATE,
        Permission.TASK_READ,
        Permission.TASK_UPDATE,
        Permission.TASK_DELETE,
        Permission.TASK_COMPLETE,
        Permission.REPORT_RUN,
        Permission.EXPORT_CREATE,
        Permission.AUDIT_READ,
        Permission.AUDIT_EXPORT,
        Permission.MEETING_CREATE,
        Permission.MEETING_READ,
        Permission.MEETING_UPDATE,
        Permission.MEETING_DELETE,
        Permission.MEETING_AI_ANALYSIS,
        Permission.EMAIL_CREATE,
        Permission.EMAIL_READ,
        Permission.EMAIL_SEND,
        Permission.AUTOMATION_CREATE,
        Permission.AUTOMATION_READ,
        Permission.AUTOMATION_UPDATE,
        Permission.AUTOMATION_DELETE,
        Permission.AUTOMATION_EXECUTE,
        Permission.ANALYTICS_READ,
        Permission.FORECAST_READ,
        Permission.ENRICHMENT_RUN,
        Permission.NOTIFICATION_SEND,
        Permission.NOTIFICATION_READ,
    ],

    [Role.REP]: [
        Permission.ORG_READ,
        Permission.USER_READ,
        Permission.LEAD_CREATE,
        Permission.LEAD_READ,
        Permission.LEAD_UPDATE,
        Permission.LEAD_DELETE,
        Permission.LEAD_CONVERT,
        Permission.ACCOUNT_CREATE,
        Permission.ACCOUNT_READ,
        Permission.ACCOUNT_UPDATE,
        Permission.CONTACT_CREATE,
        Permission.CONTACT_READ,
        Permission.CONTACT_UPDATE,
        Permission.OPPORTUNITY_CREATE,
        Permission.OPPORTUNITY_READ,
        Permission.OPPORTUNITY_UPDATE,
        Permission.OPPORTUNITY_CHANGE_STAGE,
        Permission.ACTIVITY_CREATE,
        Permission.ACTIVITY_READ,
        Permission.ACTIVITY_UPDATE,
        Permission.TASK_CREATE,
        Permission.TASK_READ,
        Permission.TASK_UPDATE,
        Permission.TASK_COMPLETE,
        Permission.REPORT_RUN,
        Permission.EXPORT_CREATE,
        Permission.MEETING_CREATE,
        Permission.MEETING_READ,
        Permission.MEETING_UPDATE,
        Permission.MEETING_AI_ANALYSIS,
        Permission.EMAIL_CREATE,
        Permission.EMAIL_READ,
        Permission.EMAIL_SEND,
        Permission.NOTIFICATION_READ,
    ],

    [Role.READ_ONLY]: [
        Permission.ORG_READ,
        Permission.USER_READ,
        Permission.LEAD_READ,
        Permission.ACCOUNT_READ,
        Permission.CONTACT_READ,
        Permission.OPPORTUNITY_READ,
        Permission.ACTIVITY_READ,
        Permission.TASK_READ,
        Permission.REPORT_RUN,
        Permission.MEETING_READ,
        Permission.EMAIL_READ,
        Permission.AUTOMATION_READ,
        Permission.ANALYTICS_READ,
        Permission.FORECAST_READ,
        Permission.NOTIFICATION_READ,
    ],
};

// Ownership check helper
export function isOwner<T extends { ownerId: string }>(
    resource: T,
    userId: string
): boolean {
    return resource.ownerId === userId;
}
