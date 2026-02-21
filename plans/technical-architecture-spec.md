# Multi-Tenant SMB CRM - Technical Architecture Specification

**Version:** 1.0  
**Date:** 2026-02-21  
**Status:** Production-Ready MVP Specification

---

## 1. Architecture Overview

### 1.1 System Context

```mermaid
flowchart TB
    subgraph External["External Systems"]
        ClientApps["Web/Mobile Clients"]
        ThirdParty["Third-Party Integrations"]
        Webhooks["Webhooks"]
    end
    
    subgraph APIGateway["API Gateway Layer"]
        RateLimiter["Rate Limiter<br/>1000 req/org/min"]
        AuthMiddleware["JWT Auth<br/>Validation"]
        TenantMiddleware["Tenant Context<br/>Injection"]
    end
    
    subgraph CoreServices["Core Services"]
        subgraph AuthService["Authentication Service"]
            Login["Login/Logout"]
            Register["Registration"]
            PasswordMgmt["Password Management"]
            TokenMgmt["JWT Token Management"]
        end
        
        subgraph CRMServices["CRM Services"]
            LeadMgmt["Lead Management"]
            AccountMgmt["Account Management"]
            ContactMgmt["Contact Management"]
            OppMgmt["Opportunity Management"]
            ActivityMgmt["Activity/Task Management"]
            ImportExport["CSV Import/Export"]
        end
        
        subgraph AdminServices["Admin Services"]
            UserMgmt["User Management"]
            RoleMgmt["Role Management"]
            BillingMgmt["Billing & Plans"]
            AuditLog["Audit Logging"]
            APIKeyMgmt["API Key Management"]
        end
    end
    
    subgraph DataLayer["Data Layer"]
        PostgreSQL["PostgreSQL<br/>Multi-Tenant DB"]
        Redis["Redis<br/>Session Cache"]
    end
    
    ClientApps --> APIGateway
    ThirdParty --> APIGateway
    Webhooks --> APIGateway
    
    APIGateway --> CoreServices
    CoreServices --> DataLayer
```

### 1.2 Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Runtime** | Node.js 20 LTS | Excellent for I/O-heavy CRM operations, strong ecosystem |
| **API Framework** | Express.js 4.x | Mature, well-documented, great middleware support |
| **Database** | PostgreSQL 16 | Best-in-class for multi-tenant with RLS, JSON support |
| **ORM** | Prisma 5.x | Type-safe, excellent migration support, works well with RLS |
| **Authentication** | JWT + Refresh Tokens | Stateless, scalable, industry standard |
| **Caching** | Redis 7 | Session management, rate limiting, caching |
| **Frontend** | React 18 + TypeScript | Component-driven, type-safe |
| **State Management** | Zustand | Lightweight, simpler than Redux, TypeScript-first |
| **API Client** | TanStack Query | Server state management, caching, mutations |
| **Validation** | Zod | Schema validation, TypeScript integration |

### 1.3 Non-Functional Requirements

| Requirement | Target | Implementation |
|-------------|--------|----------------|
| **Availability** | 99.9% | Horizontal scaling, health checks, graceful degradation |
| **Latency (P95)** | < 200ms | Database indexing, Redis caching, query optimization |
| **Concurrency** | 200 users/org | Connection pooling, rate limiting per org |
| **Data Isolation** | 100% | PostgreSQL RLS + application-level checks |
| **Auditability** | Full | All CRUD operations logged with context |

---

## 2. Multi-Tenant Data Model

### 2.1 Tenant Isolation Strategy

We employ a **shared database, shared schema** approach with PostgreSQL Row-Level Security (RLS). This provides:

- **Strong isolation**: Database enforces tenant boundaries at the query level
- **Operational simplicity**: Single database to manage, backup, monitor
- **Cost efficiency**: No per-tenant database overhead
- **Performance**: Shared connection pools, efficient resource utilization

```mermaid
erDiagram
    Organizations ||--o{ Users : "has"
    Organizations ||--o{ Leads : "owns"
    Organizations ||--o{ Accounts : "owns"
    Organizations ||--o{ Contacts : "owns"
    Organizations ||--o{ Opportunities : "owns"
    Organizations ||--o{ Activities : "owns"
    Organizations ||--o{ Tasks : "owns"
    Organizations ||--o{ APIKeys : "owns"
    Organizations ||--o{ AuditLogs : "owns"
    Organizations ||--o{ BillingRecords : "owns"
    
    Users ||--o{ Leads : "owns"
    Users ||--o{ Accounts : "owns"
    Users ||--o{ Contacts : "owns"
    Users ||--o{ Opportunities : "owns"
    Users ||--o{ Activities : "owns"
    Users ||--o{ Tasks : "owns"
    Users ||--o{ AuditLogs : "creates"
    
    Accounts ||--o{ Contacts : "has"
    Accounts ||--o{ Opportunities : "has"
    Leads ||--o| Accounts : "converts_to"
    Leads ||--o| Contacts : "converts_to"
    Leads ||--o| Opportunities : "converts_to"
    Contacts ||--o{ Opportunities : "involved_in"
```

### 2.2 Database Schema (Prisma Models)

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================
// TENANT ISOLATION SETUP
// ============================================

// Organizations (Tenants)
model Organization {
  id            String   @id @default(cuid())
  name          String   @db.VarChar(255)
  planType      PlanType @default(FREE)
  seatsTotal    Int      @default(5)
  seatsUsed     Int      @default(0)
  trialEnd      DateTime?
  stripeCustomerId String? @unique
  isActive      Boolean  @default(true)
  settings      Json?    // Organization-specific settings
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  // Relations
  users         User[]
  leads         Lead[]
  accounts      Account[]
  contacts      Contact[]
  opportunities Opportunity[]
  activities    Activity[]
  tasks         Task[]
  apiKeys       APIKey[]
  auditLogs     AuditLog[]
  billingRecords BillingRecord[]

  @@index([isActive])
  @@index([planType])
}

// ============================================
// USER & AUTHENTICATION
// ============================================

enum Role {
  ADMIN
  MANAGER
  REP
  READ_ONLY
}

enum PlanType {
  FREE
  PRO
  ENTERPRISE
}

model User {
  id            String   @id @default(cuid())
  orgId         String
  email         String   @db.VarChar(255)
  passwordHash  String   @db.VarChar(255)
  firstName     String   @db.VarChar(100)
  lastName      String   @db.VarChar(100)
  role          Role     @default(REP)
  isActive      Boolean  @default(true)
  emailVerified Boolean  @default(false)
  lastLoginAt   DateTime?
  failedLoginAttempts Int @default(0)
  lockedUntil   DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  // Relations
  organization  Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  
  ownedLeads        Lead[]        @relation("LeadOwner")
  ownedAccounts     Account[]     @relation("AccountOwner")
  ownedContacts     Contact[]     @relation("ContactOwner")
  ownedOpportunities Opportunity[] @relation("OpportunityOwner")
  ownedActivities   Activity[]    @relation("ActivityOwner")
  ownedTasks        Task[]        @relation("TaskOwner")
  auditLogs         AuditLog[]
  sessions          Session[]

  // Constraints
  @@unique([orgId, email])
  @@index([orgId])
  @@index([email])
}

// Session tokens for refresh token rotation
model Session {
  id           String   @id @default(cuid())
  userId       String
  tokenFamily  String   @default(cuid()) // Groups tokens for rotation
  jti          String   @unique // JWT ID for token invalidation
  expiresAt    DateTime
  createdAt    DateTime @default(now())
  ipAddress    String?  @db.VarChar(45)
  userAgent    String?  @db.Text

  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@index([userId])
  @@index([expiresAt])
}

// ============================================
// CORE CRM ENTITIES
// ============================================

// Leads
enum LeadStatus {
  NEW
  CONTACTED
  QUALIFIED
  UNQUALIFIED
  CONVERTED
}

enum LeadSource {
  WEBSITE
  REFERRAL
  COLD_CALL
  TRADE_SHOW
  ADVERTISING
  OTHER
}

model Lead {
  id                    String      @id @default(cuid())
  orgId                 String
  ownerId               String?
  firstName             String      @db.VarChar(100)
  lastName              String      @db.VarChar(100)
  company               String      @db.VarChar(255)
  email                 String?     @db.VarChar(255)
  phone                 String?     @db.VarChar(50)
  status                LeadStatus  @default(NEW)
  source                LeadSource  @default(WEBSITE)
  converted             Boolean     @default(false)
  convertedToAccountId  String?
  convertedToContactId  String?
  convertedToOpportunityId String?
  convertedAt           DateTime?
  notes                 String?     @db.Text
  createdAt             DateTime     @default(now())
  updatedAt             DateTime     @updatedAt

  // Relations
  organization          Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  owner                 User?        @relation("LeadOwner", fields: [ownerId], references: [id], onDelete: SetNull)
  
  @@index([orgId])
  @@index([ownerId])
  @@index([status])
  @@index([converted])
  @@index([createdAt])
}

// Accounts (Companies)
enum Industry {
  TECHNOLOGY
  HEALTHCARE
  FINANCE
  MANUFACTURING
  RETAIL
  EDUCATION
  CONSULTING
  OTHER
}

model Account {
  id              String    @id @default(cuid())
  orgId           String
  ownerId         String
  name            String    @db.VarChar(255)
  website         String?   @db.VarChar(255)
  industry        Industry? @default(OTHER)
  annualRevenue   Decimal?  @db.Decimal(15, 2)
  employees       Int?
  billingAddress  Json?     // { street, city, state, country, zip }
  shippingAddress Json?
  phone           String?   @db.VarChar(50)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  // Relations
  organization    Organization  @relation(fields: [orgId], references: [id], onDelete: Cascade)
  owner           User          @relation("AccountOwner", fields: [ownerId], references: [id], onDelete: Cascade)
  contacts        Contact[]
  opportunities   Opportunity[]

  @@index([orgId])
  @@index([ownerId])
  @@index([industry])
  @@index([name])
}

// Contacts (People)
model Contact {
  id          String   @id @default(cuid())
  orgId       String
  ownerId     String
  accountId   String?
  firstName   String   @db.VarChar(100)
  lastName    String   @db.VarChar(100)
  title       String?  @db.VarChar(100)
  email       String?  @db.VarChar(255)
  phone       String?  @db.VarChar(50)
  department  String?  @db.VarChar(100)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // Relations
  organization  Organization   @relation(fields: [orgId], references: [id], onDelete: Cascade)
  owner        User           @relation("ContactOwner", fields: [ownerId], references: [id], onDelete: Cascade)
  account      Account?       @relation(fields: [accountId], references: [id], onDelete: SetNull)
  opportunities Opportunity[]

  @@index([orgId])
  @@index([ownerId])
  @@index([accountId])
  @@index([email])
}

// Opportunities (Deals)
enum OpportunityStage {
  PROSPECTING
  QUALIFICATION
  NEEDS_ANALYSIS
  VALUE_PROPOSITION
  DECISION_MAKERS
  PROPOSAL
  NEGOTIATION
  CLOSED_WON
  CLOSED_LOST
}

model Opportunity {
  id          String             @id @default(cuid())
  orgId       String
  ownerId     String
  accountId   String?
  contactId   String?
  name        String             @db.VarChar(255)
  stage       OpportunityStage   @default(PROSPECTING)
  amount      Decimal?           @db.Decimal(15, 2)
  probability Int                @default(10) // 0-100
  closeDate   DateTime
  lostReason  String?            @db.Text
  wonNotes    String?            @db.Text
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt

  // Relations
  organization  Organization   @relation(fields: [orgId], references: [id], onDelete: Cascade)
  owner         User           @relation("OpportunityOwner", fields: [ownerId], references: [id], onDelete: Cascade)
  account       Account?       @relation(fields: [accountId], references: [id], onDelete: SetNull)
  contact       Contact?       @relation(fields: [contactId], references: [id], onDelete: SetNull)
  activities    Activity[]
  tasks         Task[]

  @@index([orgId])
  @@index([ownerId])
  @@index([accountId])
  @@index([stage])
  @@index([closeDate])
}

// ============================================
// ACTIVITIES & TASKS
// ============================================

enum ActivityType {
  CALL
  MEETING
  NOTE
  EMAIL
}

enum TaskStatus {
  NOT_STARTED
  IN_PROGRESS
  COMPLETED
  WAITING
}

enum TaskPriority {
  LOW
  MEDIUM
  HIGH
  URGENT
}

enum RelatedToType {
  LEAD
  ACCOUNT
  CONTACT
  OPPORTUNITY
}

model Activity {
  id              String        @id @default(cuid())
  orgId           String
  ownerId         String
  relatedToType   RelatedToType
  relatedToId     String
  type            ActivityType  @default(NOTE)
  subject         String        @db.VarChar(255)
  description     String?       @db.Text
  activityDate    DateTime
  duration        Int?          // minutes
  location        String?       @db.VarChar(255)
  attendees       String[]      // email addresses
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  // Relations
  organization    Organization  @relation(fields: [orgId], references: [id], onDelete: Cascade)
  owner           User          @relation("ActivityOwner", fields: [ownerId], references: [id], onDelete: Cascade)
  opportunity    Opportunity?  @relation(fields: [relatedToId], references: [id], onDelete: Cascade, map: "Activity_opportunity")

  @@index([orgId])
  @@index([ownerId])
  @@index([relatedToType, relatedToId])
  @@index([activityDate])
}

model Task {
  id              String        @id @default(cuid())
  orgId           String
  ownerId         String
  relatedToType   RelatedToType
  relatedToId     String
  subject         String        @db.VarChar(255)
  description     String?       @db.Text
  dueDate         DateTime?
  status          TaskStatus    @default(NOT_STARTED)
  priority        TaskPriority  @default(MEDIUM)
  completedAt     DateTime?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  // Relations
  organization    Organization  @relation(fields: [orgId], references: [id], onDelete: Cascade)
  owner           User          @relation("TaskOwner", fields: [ownerId], references: [id], onDelete: Cascade)
  opportunity    Opportunity?  @relation(fields: [relatedToId], references: [id], onDelete: Cascade, map: "Task_opportunity")

  @@index([orgId])
  @@index([ownerId])
  @@index([relatedToType, relatedToId])
  @@index([dueDate])
  @@index([status])
}

// ============================================
// API KEYS & AUDIT LOGGING
// ============================================

model APIKey {
  id          String    @id @default(cuid())
  orgId       String
  label       String    @db.VarChar(100)
  keyHash     String    @db.VarChar(255) // SHA-256 of key, first 8 chars stored
  keyPrefix   String    @db.VarChar(8)   // First 8 chars for display
  scopes      String[]  // e.g., ["read:leads", "write:opportunities"]
  lastUsedAt  DateTime?
  expiresAt   DateTime?
  isActive    Boolean   @default(true)
  createdAt   DateTime  @default(now())

  // Relations
  organization Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@index([orgId])
  @@index([keyHash])
}

enum AuditAction {
  CREATE
  READ
  UPDATE
  DELETE
  LOGIN
  LOGOUT
  EXPORT
  IMPORT
  CONVERT
}

enum AuditOutcome {
  SUCCESS
  FAILURE
}

model AuditLog {
  id            String       @id @default(cuid())
  orgId         String
  userId        String?
  action        AuditAction
  objectType    String       @db.VarChar(50)
  objectId      String?
  changes       Json?        // { before: {}, after: {} }
  requestOrigin String?      @db.VarChar(255)
  ipAddress     String?      @db.VarChar(45)
  userAgent     String?      @db.Text
  outcome       AuditOutcome @default(SUCCESS)
  errorMessage  String?      @db.Text
  timestamp     DateTime     @default(now())

  // Relations
  organization  Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  user          User?        @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([orgId])
  @@index([userId])
  @@index([action])
  @@index([objectType, objectId])
  @@index([timestamp])
}

// ============================================
// BILLING
// ============================================

enum BillingEventType {
  SUBSCRIPTION_STARTED
  SUBSCRIPTION_UPDATED
  SUBSCRIPTION_CANCELLED
  PAYMENT_SUCCEEDED
  PAYMENT_FAILED
  SEAT_ADDED
  SEAT_REMOVED
  TRIAL_STARTED
  TRIAL_ENDED
}

model BillingRecord {
  id              String            @id @default(cuid())
  orgId           String
  eventType       BillingEventType
  amount          Decimal?          @db.Decimal(10, 2)
  currency        String            @default("USD")
  planType        PlanType?
  seatsCount      Int?
  stripeInvoiceId String?           @unique
  stripeEventId   String?           @unique
  metadata        Json?
  createdAt       DateTime           @default(now())

  organization    Organization      @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@index([orgId])
  @@index([eventType])
  @@index([createdAt])
}
```

### 2.3 Row-Level Security (RLS) Policies

```sql
-- Enable RLS on all tenant-scoped tables
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Opportunity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Activity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "APIKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingRecord" ENABLE ROW LEVEL SECURITY;

-- Function to get current organization context
CREATE OR REPLACE FUNCTION auth.current_org_id()
RETURNS TEXT AS $$
  SELECT current_setting('app.current_org_id', true);
$$ LANGUAGE SQL STABLE;

-- RLS Policy: Organizations can only see their own data
CREATE POLICY "org_isolation_policy" ON "User"
  FOR ALL
  USING ("orgId" = auth.current_org_id());

CREATE POLICY "org_isolation_policy" ON "Lead"
  FOR ALL
  USING ("orgId" = auth.current_org_id());

CREATE POLICY "org_isolation_policy" ON "Account"
  FOR ALL
  USING ("orgId" = auth.current_org_id());

CREATE POLICY "org_isolation_policy" ON "Contact"
  FOR ALL
  USING ("orgId" = auth.current_org_id());

CREATE POLICY "org_isolation_policy" ON "Opportunity"
  FOR ALL
  USING ("orgId" = auth.current_org_id());

CREATE POLICY "org_isolation_policy" ON "Activity"
  FOR ALL
  USING ("orgId" = auth.current_org_id());

CREATE POLICY "org_isolation_policy" ON "Task"
  FOR ALL
  USING ("orgId" = auth.current_org_id());

CREATE POLICY "org_isolation_policy" ON "APIKey"
  FOR ALL
  USING ("orgId" = auth.current_org_id());

CREATE POLICY "org_isolation_policy" ON "AuditLog"
  FOR ALL
  USING ("orgId" = auth.current_org_id());

CREATE POLICY "org_isolation_policy" ON "BillingRecord"
  FOR ALL
  USING ("orgId" = auth.current_org_id());
```

---

## 3. RBAC System

### 3.1 Permission Matrix

| Object | Permission | ADMIN | MANAGER | REP | READ_ONLY |
|--------|------------|-------|---------|-----|------------|
| **Organizations** | read | ✓ | ✓ | ✓ | ✓ |
| | update | ✓ | - | - | - |
| | delete | ✓ | - | - | - |
| **Users** | create | ✓ | - | - | - |
| | read | ✓ | ✓ | ✓ | - |
| | update | ✓ | ✓* | - | - |
| | delete | ✓ | - | - | - |
| **Leads** | create | ✓ | ✓ | ✓ | - |
| | read | ✓ | ✓ | ✓ | ✓ |
| | update | ✓ | ✓ | Own | - |
| | delete | ✓ | ✓ | Own | - |
| | convert | ✓ | ✓ | Own | - |
| **Accounts** | create | ✓ | ✓ | ✓ | - |
| | read | ✓ | ✓ | ✓ | ✓ |
| | update | ✓ | ✓ | Own | - |
| | delete | ✓ | ✓ | Own | - |
| **Contacts** | create | ✓ | ✓ | ✓ | - |
| | read | ✓ | ✓ | ✓ | ✓ |
| | update | ✓ | ✓ | Own | - |
| | delete | ✓ | ✓ | Own | - |
| **Opportunities** | create | ✓ | ✓ | ✓ | - |
| | read | ✓ | ✓ | ✓ | ✓ |
| | update | ✓ | ✓ | Own | - |
| | delete | ✓ | ✓ | Own | - |
| | change_stage | ✓ | ✓ | Own | - |
| **Activities** | create | ✓ | ✓ | ✓ | - |
| | read | ✓ | ✓ | ✓ | ✓ |
| | update | ✓ | ✓ | Own | - |
| | delete | ✓ | ✓ | Own | - |
| **Tasks** | create | ✓ | ✓ | ✓ | - |
| | read | ✓ | ✓ | ✓ | ✓ |
| | update | ✓ | ✓ | Own | - |
| | delete | ✓ | ✓ | Own | - |
| | complete | ✓ | ✓ | Own | - |
| **API Keys** | create | ✓ | - | - | - |
| | read | ✓ | - | - | - |
| | delete | ✓ | - | - | - |
| **Billing** | read | ✓ | - | - | - |
| | update | ✓ | - | - | - |
| **Reports** | run | ✓ | ✓ | ✓ | ✓ |
| **Import/Export** | import | ✓ | ✓ | - | - |
| | export | ✓ | ✓ | ✓ | - |

*Note: MANAGER can update users within their org, but cannot change roles

### 3.2 RBAC Implementation

```typescript
// src/core/rbac/types.ts

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
}

// Role to Permission mapping
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.ADMIN]: Object.values(Permission),
  
  [Role.MANAGER]: [
    Permission.ORG_READ,
    Permission.USER_READ,
    Permission.USER_UPDATE, // Cannot change roles
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
  ],
  
  [Role.REP]: [
    Permission.ORG_READ,
    Permission.USER_READ,
    Permission.LEAD_CREATE,
    Permission.LEAD_READ,
    Permission.LEAD_UPDATE_OWN,
    Permission.LEAD_DELETE_OWN,
    Permission.LEAD_CONVERT_OWN,
    Permission.ACCOUNT_CREATE,
    Permission.ACCOUNT_READ,
    Permission.ACCOUNT_UPDATE_OWN,
    Permission.ACCOUNT_DELETE_OWN,
    Permission.CONTACT_CREATE,
    Permission.CONTACT_READ,
    Permission.CONTACT_UPDATE_OWN,
    Permission.CONTACT_DELETE_OWN,
    Permission.OPPORTUNITY_CREATE,
    Permission.OPPORTUNITY_READ,
    Permission.OPPORTUNITY_UPDATE_OWN,
    Permission.OPPORTUNITY_DELETE_OWN,
    Permission.OPPORTUNITY_CHANGE_STAGE_OWN,
    Permission.ACTIVITY_CREATE,
    Permission.ACTIVITY_READ,
    Permission.ACTIVITY_UPDATE_OWN,
    Permission.ACTIVITY_DELETE_OWN,
    Permission.TASK_CREATE,
    Permission.TASK_READ,
    Permission.TASK_UPDATE_OWN,
    Permission.TASK_DELETE_OWN,
    Permission.TASK_COMPLETE_OWN,
    Permission.REPORT_RUN,
    Permission.EXPORT_CREATE,
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
  ],
};

// Ownership check helper
export function isOwner<T extends { ownerId: string }>(
  resource: T,
  userId: string
): boolean {
  return resource.ownerId === userId;
}
```

### 3.3 RBAC Middleware

```typescript
// src/core/rbac/middleware.ts

import { Request, Response, NextFunction } from 'express';
import { Permission, ROLE_PERMISSIONS, Role } from './types';
import { ForbiddenError, UnauthorizedError } from '../errors';

export interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    orgId: string;
    role: Role;
    email: string;
  };
}

export function requirePermission(...permissions: Permission[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userPermissions = ROLE_PERMISSIONS[req.user.role];
      
      const hasPermission = permissions.some(permission => 
        userPermissions.includes(permission)
      );
      
      if (!hasPermission) {
        throw new ForbiddenError(
          `Missing required permission: ${permissions.join(', ')}`
        );
      }
      
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireRole(...roles: Role[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!roles.includes(req.user.role)) {
        throw new ForbiddenError(
          `Access denied. Required roles: ${roles.join(', ')}`
        );
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Ownership check middleware for PUT/DELETE operations
export function requireOwnerOrRole(
  rolesWithOverride: Role[],
  resourceOwnerField: string = 'ownerId'
) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { role, id: userId } = req.user;
      
      // Check if user has role that bypasses ownership
      if (rolesWithOverride.includes(role)) {
        return next();
      }
      
      // Check ownership
      const resourceOwnerId = req.params[resourceOwnerField] || req.body[resourceOwnerField];
      
      if (resourceOwnerId !== userId) {
        throw new ForbiddenError(
          'You can only modify resources you own'
        );
      }
      
      next();
    } catch (error) {
      next(error);
    }
  };
}
```

---

## 4. API Design

### 4.1 REST API Structure

```
Base URL: /api/v1

┌─────────────────────────────────────────────────────────────────┐
│                    AUTHENTICATION                               │
├─────────────────────────────────────────────────────────────────┤
│ POST   /auth/register           Register new organization      │
│ POST   /auth/login              Login with email/password      │
│ POST   /auth/logout             Invalidate refresh token      │
│ POST   /auth/refresh            Refresh access token          │
│ POST   /auth/forgot-password    Request password reset        │
│ POST   /auth/reset-password     Reset password with token     │
│ GET    /auth/me                 Get current user profile       │
│ POST   /auth/verify-email       Verify email with token       │
│ POST   /auth/resend-verification Resend email verification     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    ORGANIZATIONS                                │
├─────────────────────────────────────────────────────────────────┤
│ GET    /organizations/me        Get current organization      │
│ PATCH  /organizations/me         Update organization settings │
│ GET    /organizations/me/usage   Get seat usage & quotas      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    USERS                                        │
├─────────────────────────────────────────────────────────────────┤
│ GET    /users                     List org users (paginated)   │
│ POST   /users                     Invite/create user          │
│ GET    /users/:id                 Get user details             │
│ PATCH  /users/:id                 Update user                 │
│ DELETE /users/:id                 Deactivate user              │
│ POST   /users/:id/resend-invite   Resend invitation            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    LEADS                                         │
├─────────────────────────────────────────────────────────────────┤
│ GET    /leads                     List leads (paginated)       │
│ POST   /leads                     Create lead                  │
│ GET    /leads/:id                 Get lead details             │
│ PATCH  /leads/:id                 Update lead                  │
│ DELETE /leads/:id                 Delete lead                  │
│ POST   /leads/:id/convert         Convert lead                 │
│ POST   /leads/import              Bulk import leads           │
│ GET    /leads/export              Export leads (CSV)          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    ACCOUNTS                                     │
├─────────────────────────────────────────────────────────────────┤
│ GET    /accounts                  List accounts (paginated)    │
│ POST   /accounts                  Create account              │
│ GET    /accounts/:id              Get account details         │
│ PATCH  /accounts/:id               Update account              │
│ DELETE /accounts/:id               Delete account              │
│ GET    /accounts/:id/contacts     Get account contacts        │
│ GET    /accounts/:id/opportunities Get account opportunities │
│ POST   /accounts/import           Bulk import accounts        │
│ GET    /accounts/export           Export accounts (CSV)       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    CONTACTS                                     │
├─────────────────────────────────────────────────────────────────┤
│ GET    /contacts                   List contacts (paginated)  │
│ POST   /contacts                   Create contact             │
│ GET    /contacts/:id               Get contact details        │
│ PATCH  /contacts/:id               Update contact             │
│ DELETE /contacts/:id               Delete contact             │
│ POST   /contacts/import            Bulk import contacts       │
│ GET    /contacts/export            Export contacts (CSV)      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    OPPORTUNITIES                                │
├─────────────────────────────────────────────────────────────────┤
│ GET    /opportunities               List opportunities        │
│ POST   /opportunities                Create opportunity       │
│ GET    /opportunities/:id           Get opportunity details  │
│ PATCH  /opportunities/:id            Update opportunity       │
│ DELETE /opportunities/:id            Delete opportunity       │
│ PATCH  /opportunities/:id/stage      Update stage             │
│ POST   /opportunities/import         Bulk import              │
│ GET    /opportunities/export         Export (CSV)            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    ACTIVITIES                                   │
├─────────────────────────────────────────────────────────────────┤
│ GET    /activities                   List activities          │
│ POST   /activities                    Create activity         │
│ GET    /activities/:id               Get activity details     │
│ PATCH  /activities/:id               Update activity          │
│ DELETE /activities/:id                Delete activity         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    TASKS                                        │
├─────────────────────────────────────────────────────────────────┤
│ GET    /tasks                         List tasks               │
│ POST   /tasks                         Create task              │
│ GET    /tasks/:id                     Get task details         │
│ PATCH  /tasks/:id                      Update task             │
│ DELETE /tasks/:id                      Delete task             │
│ PATCH  /tasks/:id/complete            Mark complete           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    ADMIN                                        │
├─────────────────────────────────────────────────────────────────┤
│ GET    /admin/api-keys                List API keys            │
│ POST   /admin/api-keys                Create API key          │
│ DELETE /admin/api-keys/:id            Revoke API key           │
│ GET    /admin/audit-logs              Get audit logs           │
│ GET    /admin/billing                 Get billing info        │
│ POST   /admin/billing/subscription    Manage subscription     │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Request/Response Patterns

#### Pagination Parameters
```typescript
// GET /leads?page=1&limit=20&sort=createdAt:desc&status=NEW,QUALIFIED

interface PaginationParams {
  page?: number;        // Default: 1
  limit?: number;       // Default: 20, Max: 100
  sort?: string;        // Format: "field:direction" e.g., "createdAt:desc"
  offset?: number;      // Alternative to page
  cursor?: string;     // For cursor-based pagination
}

interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}
```

#### Filtering
```typescript
// Query parameter format: filter[field][operator]=value
// Examples:
//   filter[status][eq]=NEW
//   filter[amount][gte]=10000
//   filter[company][contains]=Acme
//   filter[createdAt][between]=2024-01-01,2024-12-31

interface FilterOperators {
  eq: string | number | boolean;      // Equal
  ne: string | number | boolean;      // Not equal
  gt: number;                          // Greater than
  gte: number;                         // Greater than or equal
  lt: number;                          // Less than
  lte: number;                         // Less than or equal
  in: string[];                        // In array
  nin: string[];                       // Not in array
  contains: string;                   // Contains (case-insensitive)
  startsWith: string;                  // Starts with
  endsWith: string;                    // Ends with
  between: string | [Date, Date];      // Between range
  isnull: boolean;                     // Is null
}
```

#### Standard Response Envelopes
```typescript
// Success Response
interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: {
    requestId: string;
    timestamp: string;
  };
}

// Error Response
interface ApiError {
  success: false;
  error: {
    code: string;           // e.g., "RESOURCE_NOT_FOUND"
    message: string;       // Human-readable message
    details?: ValidationError[];
    requestId: string;
  };
}

interface ValidationError {
  field: string;
  message: string;
  code: string;
}

// List Response
interface ListResponse<T> {
  success: true;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  filters: {
    applied: Record<string, any>;
  };
}
```

### 4.3 HTTP Status Codes

| Code | Usage |
|------|-------|
| `200` | Success (GET, PATCH, DELETE) |
| `201` | Created (POST) |
| `204` | No Content (DELETE successful) |
| `400` | Bad Request - Invalid parameters, validation failed |
| `401` | Unauthorized - Invalid/missing authentication |
| `403` | Forbidden - Insufficient permissions |
| `404` | Not Found - Resource doesn't exist |
| `409` | Conflict - Resource already exists, concurrency issue |
| `422` | Unprocessable Entity - Business logic validation failed |
| `429` | Too Many Requests - Rate limit exceeded |
| `500` | Internal Server Error |

---

## 5. Authentication Flow

### 5.1 Authentication Architecture

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant API
    participant Redis
    participant Database

    Note over User,Redis: Login Flow
    User->>Frontend: Enter email/password
    Frontend->>API: POST /auth/login {email, password}
    
    API->>Database: Find user by email
    Database-->>API: User record
    
    alt Invalid credentials
        API-->>Frontend: 401 Unauthorized
        Note over API: Increment failed login attempts
        Note over API: Lock account after 5 attempts
    else Valid credentials
        API->>API: Verify password hash
        API->>Redis: Create session (token family)
        API->>Database: Update lastLoginAt, reset failed attempts
        API->>Database: Create AuditLog(LOGIN)
        
        API-->>Frontend: { accessToken, refreshToken, user }
        Frontend-->>User: Login successful, redirect to dashboard
    
    Note over User,Redis: Token Refresh Flow
    Frontend->>API: POST /auth/refresh { refreshToken }
    
    API->>Redis: Validate refresh token
    Redis-->>API: Session data
    
    alt Token revoked or expired
        API-->>Frontend: 401 Unauthorized
    else Token valid
        API->>Redis: Invalidate old token family (rotation)
        API->>Redis: Create new session
        API-->>Frontend: { accessToken, refreshToken }
    end
```

### 5.2 JWT Tokens

```typescript
// Access Token (15 min expiry)
interface AccessToken {
  sub: string;          // User ID
  org_id: string;       // Organization ID
  role: Role;           // User role
  email: string;        // User email
  type: 'access';
  iat: number;          // Issued at
  exp: number;          // Expiration
  jti: string;          // Token ID for revocation
}

// Refresh Token (7 days expiry)
interface RefreshToken {
  sub: string;          // User ID
  type: 'refresh';
  iat: number;
  exp: number;
  jti: string;
  token_family: string; // Group tokens for rotation
}
```

### 5.3 Authentication Implementation

```typescript
// src/core/auth/service.ts

import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import { db } from '../db';
import { redis } from '../cache';
import { ValidationError, UnauthorizedError, ForbiddenError } from '../errors';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET!;
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const TOKEN_FAMILY_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface TokenPayload {
  sub: string;
  org_id: string;
  role: string;
  email: string;
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
  jti: string;
  token_family?: string;
}

export class AuthService {
  // Generate tokens
  async generateTokens(userId: string, orgId: string, role: string, email: string) {
    const jti = randomBytes(16).toString('hex');
    const tokenFamily = randomBytes(16).toString('hex');
    
    const accessToken = jwt.sign(
      { 
        sub: userId, 
        org_id: orgId, 
        role, 
        email,
        type: 'access',
        jti 
      },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );
    
    const refreshToken = jwt.sign(
      { 
        sub: userId, 
        type: 'refresh',
        jti,
        token_family: tokenFamily
      },
      JWT_SECRET,
      { expiresIn: REFRESH_TOKEN_EXPIRY }
    );
    
    // Store session in Redis for token rotation
    await redis.setex(
      `session:${jti}`,
      TOKEN_FAMILY_EXPIRY / 1000,
      JSON.stringify({
        userId,
        orgId,
        role,
        email,
        tokenFamily,
        createdAt: new Date().toISOString()
      })
    );
    
    return { accessToken, refreshToken, jti, tokenFamily };
  }
  
  // Verify access token
  async verifyAccessToken(token: string): Promise<TokenPayload> {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
      
      if (payload.type !== 'access') {
        throw new UnauthorizedError('Invalid token type');
      }
      
      // Check if session exists (not revoked)
      const session = await redis.get(`session:${payload.jti}`);
      if (!session) {
        throw new UnauthorizedError('Token has been revoked');
      }
      
      return payload;
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new UnauthorizedError('Invalid token');
      }
      throw error;
    }
  }
  
  // Refresh tokens with rotation
  async refreshTokens(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const payload = jwt.verify(refreshToken, JWT_SECRET) as TokenPayload;
      
      if (payload.type !== 'refresh') {
        throw new UnauthorizedError('Invalid token type');
      }
      
      // Get session to verify token family
      const sessionData = await redis.get(`session:${payload.jti}`);
      if (!sessionData) {
        throw new UnauthorizedError('Refresh token has been revoked');
      }
      
      const session = JSON.parse(sessionData);
      
      // Invalidate entire token family (force re-login on other devices)
      await this.invalidateTokenFamily(session.tokenFamily);
      
      // Generate new tokens
      const tokens = await this.generateTokens(
        session.userId,
        session.orgId,
        session.role,
        session.email
      );
      
      return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    } catch (error) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }
  }
  
  // Invalidate token family
  async invalidateTokenFamily(tokenFamily: string): Promise<void> {
    // Get all session keys with this family
    const keys = await redis.keys(`session:*`);
    for (const key of keys) {
      const session = await redis.get(key);
      if (session && JSON.parse(session).tokenFamily === tokenFamily) {
        await redis.del(key);
      }
    }
  }
  
  // Login
  async login(email: string, password: string, ipAddress?: string): Promise<AuthTokens & { user: UserResponse }> {
    const user = await db.user.findUnique({
      where: { 
        orgId_email: { orgId: '', email } } // Will be found via query
      },
      include: { organization: true }
    });
    
    if (!user) {
      await this.recordFailedLogin('', email, ipAddress);
      throw new UnauthorizedError('Invalid email or password');
    }
    
    // Check account lock
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenError('Account is locked. Try again later.');
    }
    
    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      await this.recordFailedLogin(user.id, user.email, ipAddress);
      throw new UnauthorizedError('Invalid email or password');
    }
    
    // Check email verification
    if (!user.emailVerified) {
      throw new UnauthorizedError('Please verify your email before logging in');
    }
    
    // Check org is active
    if (!user.organization.isActive) {
      throw new ForbiddenError('Organization is inactive');
    }
    
    // Generate tokens
    const tokens = await this.generateTokens(user.id, user.orgId, user.role, user.email);
    
    // Update user
    await db.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null
      }
    });
    
    // Create audit log
    await this.createAuditLog(user.id, user.orgId, 'LOGIN', 'USER', user.id, ipAddress);
    
    return {
      ...tokens,
      user: this.formatUserResponse(user)
    };
  }
  
  // Logout
  async logout(jti: string): Promise<void> {
    await redis.del(`session:${jti}`);
  }
  
  private async recordFailedLogin(userId: string, email: string, ipAddress?: string): Promise<void> {
    if (userId) {
      const user = await db.user.findUnique({ where: { id: userId } });
      if (user) {
        const attempts = user.failedLoginAttempts + 1;
        const lockedUntil = attempts >= 5 
          ? new Date(Date.now() + 30 * 60 * 1000) // 30 min lock
          : null;
        
        await db.user.update({
          where: { id: userId },
          data: {
            failedLoginAttempts: attempts,
            lockedUntil
          }
        });
      }
    }
    
    await this.createAuditLog(userId || '', '', 'LOGIN_FAIL', 'USER', null, ipAddress);
  }
  
  private async createAuditLog(
    userId: string,
    orgId: string,
    action: string,
    objectType: string,
    objectId: string | null,
    ipAddress?: string
  ): Promise<void> {
    await db.auditLog.create({
      data: {
        orgId,
        userId: userId || null,
        action: action as any,
        objectType,
        objectId,
        ipAddress,
        outcome: 'SUCCESS'
      }
    });
  }
  
  private formatUserResponse(user: any): UserResponse {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      orgId: user.orgId,
      orgName: user.organization.name,
      emailVerified: user.emailVerified
    };
  }
}
```

---

## 6. Multi-Tenant Isolation

### 6.1 Isolation Architecture

```mermaid
flowchart TB
    subgraph Request["HTTP Request"]
        Req["Request with JWT"]
    end
    
    subgraph Middleware["Middleware Chain"]
        JWT["JWT Validation"]
        TenantCtx["Tenant Context"]
        RateLimit["Rate Limiter"]
        RLS["RLS Setup"]
    end
    
    subgraph Database["PostgreSQL"]
        RLS_Policy["RLS Policies"]
        Indexes["Indexes"]
    end
    
    Req --> JWT
    JWT --> TenantCtx
    TenantCtx --> RateLimit
    RateLimit --> RLS
    RLS --> Database
    
    style RLS_Policy fill:#f9f,color:#333
    style TenantCtx fill:#9f9,color:#333
```

### 6.2 Tenant Context Middleware

```typescript
// src/core/tenant/middleware.ts

import { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { redis } from '../cache';
import { UnauthorizedError } from '../errors';

export interface TenantContext {
  orgId: string;
  userId: string;
  role: string;
  email: string;
}

// Express middleware to set tenant context
export async function tenantMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing authentication token');
    }
    
    const token = authHeader.substring(7);
    
    // Verify token and get payload
    const payload = await verifyAccessToken(token);
    
    // Get organization to verify it's active
    const org = await db.organization.findUnique({
      where: { id: payload.org_id },
      select: { id: true, name: true, isActive: true, planType: true }
    });
    
    if (!org || !org.isActive) {
      throw new UnauthorizedError('Organization is inactive');
    }
    
    // Check seat limit
    if (org.planType !== 'ENTERPRISE') {
      const seatLimit = org.planType === 'PRO' ? 50 : 5;
      const seatsUsed = await db.user.count({
        where: { orgId: payload.org_id, isActive: true }
      });
      
      if (seatsUsed >= seatLimit) {
        throw new UnauthorizedError('Seat limit reached. Upgrade your plan.');
      }
    }
    
    // Set context for downstream handlers
    (req as any).tenantContext = {
      orgId: payload.org_id,
      userId: payload.sub,
      role: payload.role,
      email: payload.email
    } as TenantContext;
    
    // Set PostgreSQL session variable for RLS
    // This will be used by RLS policies
    await db.$executeRaw`SELECT set_config('app.current_org_id', ${payload.org_id}, true)`;
    
    next();
  } catch (error) {
    next(error);
  }
}

// Rate limiting per organization
export function createRateLimiter() {
  const rateLimit = new RateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 1000, // 1000 requests per minute per org
    keyGenerator: (req: Request) => {
      const context = (req as any).tenantContext;
      return context?.orgId || req.ip;
    },
    handler: (req: Request) => {
      const error = new Error('Too many requests') as any;
      error.statusCode = 429;
      error.code = 'RATE_LIMIT_EXCEEDED';
      return error;
    }
  });
  
  return rateLimitMiddleware(rateLimit);
}
```

### 6.3 Repository Pattern with Tenant Scoping

```typescript
// src/core/repository/base.repository.ts

import { Prisma, PrismaClient } from '@prisma/client';

export abstract class BaseRepository<T> {
  protected prisma: PrismaClient;
  protected model: any;
  protected tenantContext: TenantContext;
  
  constructor(tenantContext: TenantContext) {
    this.prisma = (global as any).prisma || new PrismaClient();
    this.tenantContext = tenantContext;
  }
  
  // Base query that automatically scopes to organization
  protected getBaseQuery(): any {
    return {
      where: {
        orgId: this.tenantContext.orgId
      }
    };
  }
  
  async findById(id: string): Promise<T | null> {
    return this.model.findFirst({
      ...this.getBaseQuery(),
      where: {
        ...this.getBaseQuery().where,
        id
      }
    });
  }
  
  async findMany(params: {
    skip?: number;
    take?: number;
    where?: any;
    orderBy?: any;
    include?: any;
  }): Promise<T[]> {
    return this.model.findMany({
      ...this.getBaseQuery(),
      ...params,
      where: {
        ...this.getBaseQuery().where,
        ...params.where
      }
    });
  }
  
  async count(where: any = {}): Promise<number> {
    return this.model.count({
      ...this.getBaseQuery(),
      where: {
        ...this.getBaseQuery().where,
        ...where
      }
    });
  }
  
  async create(data: any): Promise<T> {
    return this.model.create({
      data: {
        ...data,
        orgId: this.tenantContext.orgId,
        ownerId: this.tenantContext.userId
      }
    });
  }
  
  async update(id: string, data: any): Promise<T> {
    // First verify ownership/access
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundError(`${this.model.name} not found`);
    }
    
    // Check ownership based on RBAC
    await this.checkOwnership(existing);
    
    return this.model.update({
      where: { id },
      data
    });
  }
  
  async delete(id: string): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundError(`${this.model.name} not found`);
    }
    
    await this.checkOwnership(existing);
    
    await this.model.delete({
      where: { id }
    });
  }
  
  // Ownership check for RBAC
  protected async checkOwnership(resource: any): Promise<void> {
    const { role, userId } = this.tenantContext;
    
    // Admins and managers can modify any record
    if (role === 'ADMIN' || role === 'MANAGER') {
      return;
    }
    
    // Check if resource has owner and if user is the owner
    if (resource.ownerId && resource.ownerId !== userId) {
      throw new ForbiddenError('You can only modify your own records');
    }
  }
}
```

---

## 7. Project Folder Structure

```
salesforcelike/
├── .env.example
├── .gitignore
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── eslint.config.js
├── prettier.config.js
├── Dockerfile
├── Makefile
├── README.md
│
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
│
├── src/
│   ├── index.ts                    # Application entry point
│   ├── config/
│   │   ├── index.ts                # Configuration loader
│   │   ├── database.ts             # Database configuration
│   │   ├── redis.ts                # Redis configuration
│   │   └── auth.ts                 # Auth configuration
│   │
│   ├── core/                       # Core business logic
│   │   ├── auth/
│   │   │   ├── service.ts
│   │   │   ├── middleware.ts
│   │   │   ├── strategies/
│   │   │   │   ├── jwt.strategy.ts
│   │   │   │   └── api-key.strategy.ts
│   │   │   └── types.ts
│   │   │
│   │   ├── rbac/
│   │   │   ├── types.ts
│   │   │   ├── permissions.ts
│   │   │   ├── decorators.ts
│   │   │   └── middleware.ts
│   │   │
│   │   ├── tenant/
│   │   │   ├── middleware.ts
│   │   │   ├── context.ts
│   │   │   └── repository.ts
│   │   │
│   │   ├── repository/
│   │   │   ├── base.repository.ts
│   │   │   ├── lead.repository.ts
│   │   │   ├── account.repository.ts
│   │   │   ├── contact.repository.ts
│   │   │   ├── opportunity.repository.ts
│   │   │   ├── activity.repository.ts
│   │   │   └── task.repository.ts
│   │   │
│   │   ├── services/               # Business logic services
│   │   │   ├── lead.service.ts
│   │   │   ├── account.service.ts
│   │   │   ├── contact.service.ts
│   │   │   ├── opportunity.service.ts
│   │   │   ├── activity.service.ts
│   │   │   ├── task.service.ts
│   │   │   ├── user.service.ts
│   │   │   ├── billing.service.ts
│   │   │   ├── audit.service.ts
│   │   │   └── import-export.service.ts
│   │   │
│   │   ├── events/                 # Event-driven architecture
│   │   │   ├── event-bus.ts
│   │   │   ├── handlers/
│   │   │   │   ├── lead-converted.handler.ts
│   │   │   │   └── opportunity-updated.handler.ts
│   │   │   └── types.ts
│   │   │
│   │   └── validation/             # Input validation
│   │       ├── lead.validation.ts
│   │       ├── account.validation.ts
│   │       └── common.validation.ts
│   │
│   ├── api/                        # API Layer
│   │   ├── routes/
│   │   │   ├── index.ts
│   │   │   ├── auth.routes.ts
│   │   │   ├── user.routes.ts
│   │   │   ├── lead.routes.ts
│   │   │   ├── account.routes.ts
│   │   │   ├── contact.routes.ts
│   │   │   ├── opportunity.routes.ts
│   │   │   ├── activity.routes.ts
│   │   │   ├── task.routes.ts
│   │   │   └── admin.routes.ts
│   │   │
│   │   ├── controllers/
│   │   │   ├── auth.controller.ts
│   │   │   ├── lead.controller.ts
│   │   │   └── ...
│   │   │
│   │   ├── middleware/
│   │   │   ├── error-handler.ts
│   │   │   ├── rate-limiter.ts
│   │   │   ├── request-validator.ts
│   │   │   ├── audit-logger.ts
│   │   │   └── cors.ts
│   │   │
│   │   └── docs/
│   │       ├── openapi.yaml
│   │       └── swagger.ts
│   │
│   ├── shared/                     # Shared utilities
│   │   ├── constants/
│   │   │   ├── http-status.ts
│   │   │   └── errors.ts
│   │   │
│   │   ├── errors/
│   │   │   ├── base.error.ts
│   │   │   ├── validation.error.ts
│   │   │   ├── not-found.error.ts
│   │   │   ├── forbidden.error.ts
│   │   │   └── unauthorized.error.ts
│   │   │
│   │   ├── utils/
│   │   │   ├── string.utils.ts
│   │   │   ├── date.utils.ts
│   │   │   ├── crypto.utils.ts
│   │   │   └── csv.utils.ts
│   │   │
│   │   ├── types/
│   │   │   ├── express.d.ts
│   │   │   └── global.d.ts
│   │   │
│   │   └── logger/
│   │       └── index.ts
│   │
│   └── scripts/                    # Maintenance scripts
│       ├── db-migrate.ts
│       ├── db-seed.ts
│       ├── db-reset.ts
│       └── generate-api-key.ts
│
├── tests/
│   ├── unit/
│   │   ├── auth/
│   │   ├── rbac/
│   │   └── services/
│   │
│   ├── integration/
│   │   ├── api/
│   │   └── database/
│   │
│   └── fixtures/
│       ├── users.json
│       └── leads.json
│
└── docs/
    ├── architecture.md
    ├── api-reference.md
    ├── database-schema.md
    └── deployment.md
```

---

## 8. Key Dependencies

### 8.1 Backend Dependencies

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "@prisma/client": "^5.7.0",
    "jsonwebtoken": "^9.0.2",
    "bcryptjs": "^2.4.3",
    "redis": "^4.6.10",
    "zod": "^3.22.4",
    "helmet": "^7.1.0",
    "cors": "^2.8.5",
    "express-rate-limit": "^7.1.5",
    "winston": "^3.11.0",
    "uuid": "^9.0.1",
    "dotenv": "^16.3.1",
    "slugify": "^1.6.6",
    "csv-stringify": "^6.4.4",
    "multer": "^1.4.5-lts.1"
  },
  "devDependencies": {
    "prisma": "^5.7.0",
    "typescript": "^5.3.3",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.5",
    "@types/bcryptjs": "^2.4.6",
    "@types/node": "^20.10.5",
    "@types/uuid": "^9.0.7",
    "@types/multer": "^1.4.11",
    "tsx": "^4.7.0",
    "eslint": "^8.56.0",
    "prettier": "^3.1.1"
  }
}
```

### 8.2 Frontend Dependencies (React)

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.21.1",
    "@tanstack/react-query": "^5.17.0",
    "zustand": "^4.4.7",
    "axios": "^1.6.5",
    "zod": "^3.22.4",
    "@hookform/resolvers": "^3.3.3",
    "react-hook-form": "^7.49.3",
    "react-hot-toast": "^2.4.1",
    "date-fns": "^3.2.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.2.0",
    "lucide-react": "^0.309.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.47",
    "@types/react-dom": "^18.2.18",
    "typescript": "^5.3.3",
    "vite": "^5.0.11",
    "eslint": "^8.56.0",
    "prettier": "^3.1.1",
    "tailwindcss": "^3.4.1",
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.33"
  }
}
```

---

## 9. Lead Conversion Workflow

### 9.1 Conversion Process

```mermaid
sequenceDiagram
    participant User
    participant API
    participant LeadService
    participant AccountRepo
    participant ContactRepo
    participant OppRepo
    participant AuditLog

    User->>API: POST /leads/:id/convert
    
    alt Lead Already Converted
        API-->>User: 409 Conflict
    else Lead Not Converted
        API->>LeadService: convertLead(leadId, convertData)
        
        Note over LeadService: Validate lead is qualified
        
        LeadService->>AccountRepo: create({ name: company })
        AccountRepo-->>LeadService: account
        
        LeadService->>ContactRepo: create({ 
            firstName, lastName, 
            email, accountId 
        })
        ContactRepo-->>LeadService: contact
        
        alt Create Opportunity
            LeadService->>OppRepo: create({
                name, amount, 
                accountId, contactId 
            })
            OppRepo-->>LeadService: opportunity
        end
        
        LeadService->>LeadService: update({
            converted: true,
            convertedToAccountId,
            convertedToContactId,
            convertedToOpportunityId,
            convertedAt
        })
        
        LeadService->>AuditLog: CREATE (lead conversion)
        
        API-->>User: 200 { account, contact, opportunity }
    end
```

### 9.2 Conversion API Contract

```typescript
// POST /api/v1/leads/:id/convert

interface ConvertLeadRequest {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  title?: string;
  
  // Opportunity data (optional)
  createOpportunity?: boolean;
  opportunityName?: string;
  opportunityAmount?: number;
  opportunityStage?: OpportunityStage;
  opportunityCloseDate?: string;
  opportunityProbability?: number;
}

interface ConvertLeadResponse {
  success: true;
  data: {
    lead: {
      id: string;
      converted: true;
      convertedToAccountId: string;
      convertedToContactId: string;
      convertedToOpportunityId?: string;
    };
    account: {
      id: string;
      name: string;
    };
    contact: {
      id: string;
      firstName: string;
      lastName: string;
      email?: string;
    };
    opportunity?: {
      id: string;
      name: string;
      amount: number;
      stage: OpportunityStage;
    };
  };
}
```

---

## 10. CSV Import/Export

### 10.1 Import Flow

```typescript
// POST /api/v1/leads/import

interface ImportRequest {
  file: File; // CSV file
  objectType: 'lead' | 'account' | 'contact' | 'opportunity';
  fieldMapping: Record<string, string>; // CSV column -> DB field
  options?: {
    updateExisting?: boolean; // Update on match
    matchField?: string;       // Field to match for updates
    skipDuplicates?: boolean;
  };
}

interface ImportResponse {
  success: true;
  data: {
    jobId: string;
    totalRows: number;
    estimatedDuration: string;
  };
}

// Job status endpoint
// GET /api/v1/admin/import-jobs/:jobId

interface ImportJobStatus {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: {
    total: number;
    processed: number;
    created: number;
    updated: number;
    failed: number;
    errors: Array<{
      row: number;
      field: string;
      message: string;
    }>;
  };
  completedAt?: string;
}
```

### 10.2 Export Flow

```typescript
// GET /api/v1/leads/export

interface ExportRequest {
  objectType: string;
  filters?: Record<string, any>;
  fields?: string[];        // Columns to export
  format?: 'csv' | 'xlsx';   // Default: csv
  filename?: string;
}

// Returns stream response with CSV/XLSX file
```

---

## 11. Security Considerations

### 11.1 Security Architecture

| Area | Implementation |
|------|----------------|
| **Transport** | TLS 1.3, HSTS enabled |
| **Authentication** | JWT with short-lived access tokens (15 min) |
| **Token Storage** | HttpOnly secure cookies or memory |
| **Password** | bcrypt with cost factor 12 |
| **Rate Limiting** | 1000 req/min per org, exponential backoff |
| **SQL Injection** | Prisma ORM with parameterized queries |
| **XSS** | Content Security Policy, input sanitization |
| **CSRF** | Same-site cookie policy |
| **API Keys** | SHA-256 hashed, prefix shown once |

### 11.2 Audit Logging

All sensitive operations are logged:

```typescript
// Automatic audit logging middleware
async function auditLogMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const originalSend = res.send;
  
  res.send = function(body) {
    // Log after response
    const outcome = res.statusCode >= 200 && res.statusCode < 400 
      ? 'SUCCESS' 
      : 'FAILURE';
    
    createAuditLog({
      orgId: req.tenantContext.orgId,
      userId: req.tenantContext.userId,
      action: getActionFromMethod(req.method),
      objectType: getObjectFromRoute(req.route.path),
      objectId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      outcome
    });
    
    return originalSend.call(this, body);
  };
  
  next();
}
```

---

## 12. Deployment Architecture

### 12.1 Production Architecture

```mermaid
flowchart TB
    subgraph Client["Client Layer"]
        WebApp["React Web App"]
        Mobile["Mobile App"]
        API["Third-Party API"]
    end
    
    subgraph CDN["CDN / Load Balancer"]
        Cloudflare["Cloudflare"]
    end
    
    subgraph K8s["Kubernetes Cluster"]
        subgraph Services["Services"]
            API1["API Pod 1"]
            API2["API Pod 2"]
            API3["API Pod 3"]
            Worker["Background Worker"]
        end
        
        subgraph Data["Data Layer"]
            PostgresPrimary["PostgreSQL Primary"]
            PostgresReplica["PostgreSQL Read Replica"]
            RedisPrimary["Redis Primary"]
            RedisReplica["Redis Replica"]
        end
    end
    
    subgraph External["External Services"]
        Stripe["Stripe"]
        SendGrid["SendGrid"]
        Sentry["Sentry"]
    end
    
    WebApp --> Cloudflare
    Mobile --> Cloudflare
    API --> Cloudflare
    
    Cloudflare --> API1
    Cloudflare --> API2
    Cloudflare --> API3
    
    API1 --> PostgresPrimary
    API2 --> PostgresPrimary
    API3 --> PostgresPrimary
    
    API1 --> RedisPrimary
    API2 --> RedisPrimary
    API3 --> RedisPrimary
    
    PostgresPrimary --> PostgresReplica
    RedisPrimary --> RedisReplica
    
    Worker --> PostgresPrimary
    Worker --> RedisPrimary
    
    API1 --> Stripe
    API1 --> SendGrid
    API1 --> Sentry
```

### 12.2 Environment Configuration

```bash
# .env.production

# Application
NODE_ENV=production
PORT=3000
API_URL=https://api.yourcrm.com
APP_URL=https://app.yourcrm.com

# Database
DATABASE_URL=postgresql://user:pass@postgres:5432/crm
DATABASE_POOL_SIZE=20
DATABASE_SSL=true

# Redis
REDIS_URL=redis://redis:6379

# Authentication
JWT_SECRET=your-secure-jwt-secret-min-32-chars
JWT_EXPIRY_ACCESS=15m
JWT_EXPIRY_REFRESH=7d

# Security
CORS_ORIGIN=https://app.yourcrm.com
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=1000

# External Services
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
SENDGRID_API_KEY=SG.xxx
SENTRY_DSN=https://xxx@sentry.io/xxx

# Logging
LOG_LEVEL=info
```

---

## 13. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
- [ ] Project setup (Express + Prisma + TypeScript)
- [ ] Database schema and RLS policies
- [ ] Authentication service (JWT + refresh tokens)
- [ ] Tenant middleware and isolation
- [ ] Basic RBAC implementation

### Phase 2: Core CRM (Week 3-4)
- [ ] Lead management CRUD
- [ ] Account management CRUD
- [ ] Contact management CRUD
- [ ] Opportunity management CRUD
- [ ] Activity and Task management

### Phase 3: Advanced Features (Week 5-6)
- [ ] Lead conversion workflow
- [ ] CSV import/export
- [ ] Audit logging
- [ ] API key management

### Phase 4: Admin & Billing (Week 7-8)
- [ ] User invitation system
- [ ] Billing integration (Stripe)
- [ ] Organization settings
- [ ] Reports dashboard

### Phase 5: Polish & Deploy (Week 9-10)
- [ ] API documentation (OpenAPI)
- [ ] Error handling improvements
- [ ] Performance optimization
- [ ] CI/CD pipeline setup
- [ ] Production deployment

---

## 14. Summary

This architecture provides:

| Capability | Implementation |
|------------|----------------|
| **Multi-Tenancy** | PostgreSQL RLS with tenant-scoped queries |
| **Data Isolation** | Organization-level row security + application checks |
| **Authentication** | JWT with refresh token rotation |
| **Authorization** | Role-based access with ownership model |
| **API Design** | RESTful with pagination, filtering, rate limiting |
| **Auditability** | Comprehensive audit logging on all operations |
| **Scalability** | Connection pooling, Redis caching, horizontal scaling |
| **Security** | TLS, hashed passwords, CSP, rate limiting |

The specification is production-ready and follows industry best practices for SaaS CRM applications. All implementation should adhere to Clean Architecture principles with clear separation between API, business logic, and data layers.
