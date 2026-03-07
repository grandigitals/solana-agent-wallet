import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

import { connection } from './solana/connection';
import { AgentOrchestrator, OrchestratorEvent } from './agent/AgentOrchestrator';
import { AgentAction } from './agent/Agent';

const app = express();
const PORT = process.env.PORT || 3000;

// ── Parse CLI args & env ──────────────────────────────────────────────────
// Accept --agents=N from CLI, fall back to AGENT_COUNT env var, then default 3
function parseAgentCount(): number {
    const cliArg = process.argv.find((a) => a.startsWith('--agents='));
    if (cliArg) {
        const n = parseInt(cliArg.split('=')[1], 10);
        if (!isNaN(n) && n > 0) return n;
    }
    const envVal = parseInt(process.env.AGENT_COUNT ?? '', 10);
    if (!isNaN(envVal) && envVal > 0) return envVal;
    return 3; // default
}

const AGENT_COUNT = parseAgentCount();

// Serve static files from the dashboard directory
app.use(express.static(path.join(__dirname, '../dashboard')));
app.use(cors());

// Limit to 50 logs in memory
const MAX_LOGS = 50;
const actionLogs: AgentAction[] = [];

// Initialize the orchestrator with dynamic agent count
const orchestrator = new AgentOrchestrator({
    agentCount: AGENT_COUNT,
    connection,
    intervalMs: 10000,
    transferLamports: 1000,
});

orchestrator.on('orchestratorEvent', (event: OrchestratorEvent) => {
    if (event.type === 'agentAction') {
        const action = event.data as AgentAction;
        actionLogs.unshift(action);
        if (actionLogs.length > MAX_LOGS) {
            actionLogs.pop();
        }
    }
});

// ── API Routes ─────────────────────────────────────────────────────────────

app.get('/api/agents', (req, res) => {
    try {
        const states = orchestrator.getAllStates();
        res.json(states);
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

app.get('/api/logs', (req, res) => {
    res.json(actionLogs);
});

// (Fallback route removed due to Express 5 path-to-regexp strictness)

// ── Start Server & Agents ──────────────────────────────────────────────────

async function start() {
    if (!process.env.ENCRYPTION_PASSWORD) {
        console.error('[ERROR] ENCRYPTION_PASSWORD is not set in .env');
        process.exit(1);
    }

    console.log('[Server] Initializing agent wallets...');
    await orchestrator.initialize();

    console.log(`[Server] Starting ${orchestrator.agentCount} agents...`);
    orchestrator.start();

    app.listen(PORT, () => {
        console.log(`\n======================================================`);
        console.log(`🚀 Server & Agents running!`);
        console.log(`🌐 Dashboard: http://localhost:${PORT}`);
        console.log(`======================================================\n`);
    });
}

start().catch((err) => {
    console.error('Fatal error starting server:', err);
    process.exit(1);
});
