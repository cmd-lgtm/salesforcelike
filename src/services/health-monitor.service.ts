/**
 * 🏥 Health Monitor
 *
 * Continuously monitors all services and infrastructure.
 * Detects issues BEFORE they become problems.
 * TypeScript port of the Python health_monitor.py spec.
 */
import * as os from 'os';
import { prisma } from '../config/database';

// ============================================
// CONSTANTS
// ============================================

const THRESHOLDS = {
    cpu_warning: 70,
    cpu_critical: 90,
    memory_warning: 75,
    memory_critical: 90,
    disk_warning: 80,
    disk_critical: 95,
    latency_warning_ms: 500,
    latency_critical_ms: 2000,
    error_rate_warning: 0.01,
    error_rate_critical: 0.05,
};

// ============================================
// TYPES
// ============================================

export interface ServiceHealth {
    status: 'healthy' | 'warning' | 'degraded' | 'down' | 'error';
    score: number;
    latency_ms?: number;
    error?: string;
    uptime?: string;
    version?: string;
}

export interface InfraHealth {
    cpu: { usage_percent: number; cores: number; status: string };
    memory: { usage_percent: number; total_gb: number; available_gb: number; status: string };
}

export interface HealthCheckResult {
    timestamp: string;
    overall_status: 'healthy' | 'warning' | 'degraded' | 'critical';
    overall_score: number;
    services: Record<string, ServiceHealth>;
    infrastructure: InfraHealth;
    database: Record<string, any>;
    predictions: any[];
    alerts: any[];
}

// ============================================
// HEALTH MONITOR
// ============================================

export class HealthMonitor {
    private healthHistory: HealthCheckResult[] = [];

    /**
     * Run comprehensive health check on all services
     */
    async runHealthCheck(): Promise<HealthCheckResult> {
        const result: HealthCheckResult = {
            timestamp: new Date().toISOString(),
            overall_status: 'healthy',
            overall_score: 100,
            services: {},
            infrastructure: this.checkInfrastructure(),
            database: await this.checkDatabase(),
            predictions: [],
            alerts: [],
        };

        // Check infrastructure thresholds
        const cpu = result.infrastructure.cpu.usage_percent;
        const mem = result.infrastructure.memory.usage_percent;

        if (cpu >= THRESHOLDS.cpu_critical || mem >= THRESHOLDS.memory_critical) {
            result.alerts.push({
                severity: 'critical',
                service: 'infrastructure',
                message: `Critical resource usage: CPU ${cpu.toFixed(1)}%, Memory ${mem.toFixed(1)}%`,
            });
        } else if (cpu >= THRESHOLDS.cpu_warning || mem >= THRESHOLDS.memory_warning) {
            result.alerts.push({
                severity: 'warning',
                service: 'infrastructure',
                message: `High resource usage: CPU ${cpu.toFixed(1)}%, Memory ${mem.toFixed(1)}%`,
            });
        }

        // Check database health
        if (result.database.status === 'down') {
            result.alerts.push({
                severity: 'critical',
                service: 'database',
                message: `Database is unreachable: ${result.database.error}`,
            });
        }

        // Calculate overall score
        result.overall_score = this.calculateOverallScore(result);
        result.overall_status = this.determineStatus(result.overall_score);

        // AI Predictions (only if we have enough history)
        result.predictions = await this.predictIssues(result);

        // Store history (max 1000)
        this.healthHistory.push(result);
        if (this.healthHistory.length > 1000) {
            this.healthHistory = this.healthHistory.slice(-500);
        }

        return result;
    }

    /**
     * Check server infrastructure using Node.js `os` module
     */
    private checkInfrastructure(): InfraHealth {
        const cpus = os.cpus();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const memPercent = (usedMem / totalMem) * 100;

        // Compute CPU usage from load averages (normalized for core count)
        const loadAvg = os.loadavg()[0]; // 1-minute average
        const cpuPercent = Math.min(100, (loadAvg / cpus.length) * 100);

        return {
            cpu: {
                usage_percent: parseFloat(cpuPercent.toFixed(1)),
                cores: cpus.length,
                status: cpuPercent >= THRESHOLDS.cpu_critical ? 'critical'
                    : cpuPercent >= THRESHOLDS.cpu_warning ? 'warning' : 'healthy',
            },
            memory: {
                usage_percent: parseFloat(memPercent.toFixed(1)),
                total_gb: parseFloat((totalMem / 1024 ** 3).toFixed(2)),
                available_gb: parseFloat((freeMem / 1024 ** 3).toFixed(2)),
                status: memPercent >= THRESHOLDS.memory_critical ? 'critical'
                    : memPercent >= THRESHOLDS.memory_warning ? 'warning' : 'healthy',
            },
        };
    }

    /**
     * Check database health via Prisma ping
     */
    private async checkDatabase(): Promise<Record<string, any>> {
        try {
            const start = Date.now();
            await prisma.$queryRaw`SELECT 1`;
            const latency = Date.now() - start;

            return {
                status: latency > THRESHOLDS.latency_critical_ms ? 'degraded' : 'healthy',
                latency_ms: latency,
                connections_active: 0,
                connections_max: 100,
            };
        } catch (error: any) {
            return { status: 'down', error: String(error?.message || error) };
        }
    }

    /**
     * AI predicts future issues based on historical trends
     */
    private async predictIssues(_current: HealthCheckResult): Promise<any[]> {
        if (this.healthHistory.length < 10) return [];

        const predictions: any[] = [];
        const recent = this.healthHistory.slice(-20);

        // CPU trend analysis
        const cpuValues = recent.map(h => h.infrastructure.cpu.usage_percent);
        if (cpuValues.length > 5) {
            const trend = cpuValues[cpuValues.length - 1] - cpuValues[0];
            const avg = cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length;
            if (trend > 20) {
                const minsToAlert = avg < 90 ? Math.round((90 - avg) / trend * 20) : 0;
                predictions.push({
                    type: 'cpu_exhaustion',
                    severity: 'high',
                    prediction: `CPU trending up ${trend.toFixed(0)}% over last 20 checks. May hit critical in ~${minsToAlert} minutes.`,
                    recommended_action: 'scale_up',
                });
            }
        }

        // Memory trend analysis
        const memValues = recent.map(h => h.infrastructure.memory.usage_percent);
        if (memValues.length > 5) {
            const trend = memValues[memValues.length - 1] - memValues[0];
            if (trend > 15) {
                predictions.push({
                    type: 'memory_leak',
                    severity: 'high',
                    prediction: 'Possible memory leak detected — usage increasing steadily.',
                    recommended_action: 'investigate_memory_leak',
                });
            }
        }

        // DB latency trend
        const dbLatencies = recent
            .map(h => h.database?.latency_ms)
            .filter((v): v is number => typeof v === 'number');
        if (dbLatencies.length > 5) {
            const avg = dbLatencies.reduce((a, b) => a + b, 0) / dbLatencies.length;
            if (avg > THRESHOLDS.latency_warning_ms) {
                predictions.push({
                    type: 'db_slowdown',
                    severity: 'medium',
                    prediction: `Average DB latency is ${avg.toFixed(0)}ms — above ${THRESHOLDS.latency_warning_ms}ms threshold.`,
                    recommended_action: 'optimize_queries',
                });
            }
        }

        return predictions;
    }

    /**
     * Calculate overall health score (0–100)
     */
    private calculateOverallScore(result: HealthCheckResult): number {
        const scores: number[] = [];

        // Infrastructure score
        const cpu = result.infrastructure.cpu.usage_percent;
        const mem = result.infrastructure.memory.usage_percent;
        scores.push(Math.max(0, 100 - cpu));
        scores.push(Math.max(0, 100 - mem));

        // Database score
        if (result.database.status === 'down') {
            scores.push(0);
        } else if (result.database.status === 'degraded') {
            scores.push(50);
        } else {
            scores.push(100);
        }

        return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 100;
    }

    /**
     * Convert score to status string
     */
    private determineStatus(score: number): HealthCheckResult['overall_status'] {
        if (score >= 90) return 'healthy';
        if (score >= 70) return 'warning';
        if (score >= 50) return 'degraded';
        return 'critical';
    }

    /**
     * Get recent health history
     */
    getHistory(limit = 50): HealthCheckResult[] {
        return this.healthHistory.slice(-limit);
    }
}

export const healthMonitor = new HealthMonitor();
