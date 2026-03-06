import dotenv from 'dotenv';
dotenv.config();

import { connection } from './solana/connection';
import { AgentOrchestrator } from './agent/AgentOrchestrator';
import { Dashboard } from './dashboard/Dashboard';
import { OrchestratorEvent } from './agent/AgentOrchestrator';
import { AgentAction, AgentState } from './agent/Agent';

// ── CLI Argument Parsing ─────────────────────────────────────────────────────

function parseArgs(): { agents: number; interval: number } {
    const args = process.argv.slice(2);
    let agents = 3;
    let interval = 10;

    for (const arg of args) {
        const agentsMatch = arg.match(/^--agents=(\d+)$/);
        const intervalMatch = arg.match(/^--interval=(\d+)$/);
        if (agentsMatch) agents = Math.max(1, parseInt(agentsMatch[1], 10));
        if (intervalMatch) interval = Math.max(1, parseInt(intervalMatch[1], 10));
    }

    return { agents, interval };
}

// ── Entry Point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const { agents: agentCount, interval: intervalSeconds } = parseArgs();
    const intervalMs = intervalSeconds * 1000;

    // Check for encryption password early
    if (!process.env.ENCRYPTION_PASSWORD) {
        console.error(
            '\n[ERROR] ENCRYPTION_PASSWORD is not set.\n' +
            'Copy .env.example to .env and set a strong password.\n'
        );
        process.exit(1);
    }

    // Initialize the dashboard
    const dashboard = new Dashboard();
    dashboard.logInfo(
        `Starting {bold}${agentCount}{/bold} agents with {bold}${intervalSeconds}s{/bold} transfer interval…`
    );
    dashboard.logInfo(`RPC: ${process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'}`);

    // Initialize the orchestrator
    const orchestrator = new AgentOrchestrator({
        agentCount,
        connection,
        intervalMs,
        transferLamports: 1000, // 0.000001 SOL per transfer
    });

    dashboard.logInfo('Initializing agent wallets (loading/creating keypairs)…');

    try {
        await orchestrator.initialize();
    } catch (err) {
        dashboard.logError(`Initialization failed: ${(err as Error).message}`);
        setTimeout(() => {
            dashboard.destroy();
            process.exit(1);
        }, 3000);
        return;
    }

    dashboard.logInfo(`✅ ${orchestrator.agentCount} agents initialized. Starting autonomous loops…`);

    // Log agent IDs and public keys
    const agentIds = orchestrator.getAgentIds();
    for (const id of agentIds) {
        const state = orchestrator.getAgentState(id);
        if (state) {
            dashboard.logInfo(`  ${id} → {white-fg}${state.publicKey}{/white-fg}`);
            dashboard.updateAgentState(state);
        }
    }

    // Wire up the orchestrator event bus → dashboard
    orchestrator.on('orchestratorEvent', (event: OrchestratorEvent) => {
        if (event.type === 'agentAction') {
            dashboard.appendLog(event.data as AgentAction);
        } else if (event.type === 'agentStateChange') {
            dashboard.updateAgentState(event.data as AgentState);
        }
    });

    // Start all agents
    orchestrator.start();
    dashboard.logInfo('🚀 All agents are running!');

    // Graceful shutdown
    const shutdown = (): void => {
        dashboard.logInfo('⚠️  Shutdown signal received. Stopping all agents…');
        orchestrator.stop();
        setTimeout(() => {
            dashboard.destroy();
            process.exit(0);
        }, 1000);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
    console.error('Fatal error:', (err as Error).message);
    process.exit(1);
});
