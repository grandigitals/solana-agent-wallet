import { Connection, PublicKey } from '@solana/web3.js';
import { EventEmitter } from 'events';
import { Agent, AgentAction, AgentState } from './Agent';
import { WalletManager } from '../wallet/WalletManager';

export interface OrchestratorConfig {
    agentCount: number;
    connection: Connection;
    intervalMs: number;
    /** Transfer amount per agent tick, in lamports. Defaults to 1000. */
    transferLamports?: number;
}

export interface OrchestratorEvent {
    type: 'agentAction' | 'agentStateChange';
    agentId: string;
    data: AgentAction | AgentState;
}

/**
 * AgentOrchestrator spins up N agents, registers them as each other's peers,
 * and provides a unified event stream for monitoring.
 */
export class AgentOrchestrator extends EventEmitter {
    private readonly config: OrchestratorConfig;
    private agents: Map<string, Agent> = new Map();
    private running = false;

    constructor(config: OrchestratorConfig) {
        super();
        this.config = config;
    }

    /**
     * Initializes all agents, loads or creates their wallets, sets up peers,
     * and attaches event listeners.
     */
    async initialize(): Promise<void> {
        const { agentCount, connection, intervalMs, transferLamports } = this.config;

        // Create/load wallets for all agents
        const wallets = WalletManager.getOrCreateWallets(agentCount);

        // Instantiate all Agent objects
        for (const wallet of wallets) {
            const agent = new Agent({
                agentId: wallet.agentId,
                keypair: wallet.keypair,
                connection,
                intervalMs,
                transferLamports,
            });

            this.agents.set(wallet.agentId, agent);
        }

        // Register all peers (all public keys except own)
        const allPublicKeys: PublicKey[] = wallets.map((w) => w.keypair.publicKey);
        for (const agent of this.agents.values()) {
            agent.setPeers(allPublicKeys);
        }

        // Attach event listeners to each agent
        for (const agent of this.agents.values()) {
            agent.on('action', (action: AgentAction) => {
                this.emit('orchestratorEvent', {
                    type: 'agentAction',
                    agentId: action.agentId,
                    data: action,
                } as OrchestratorEvent);
            });

            agent.on('stateChange', (state: AgentState) => {
                this.emit('orchestratorEvent', {
                    type: 'agentStateChange',
                    agentId: state.agentId,
                    data: state,
                } as OrchestratorEvent);
            });
        }
    }

    /**
     * Starts all agents.
     */
    start(): void {
        if (this.running) return;
        this.running = true;
        for (const agent of this.agents.values()) {
            agent.start();
        }
        this.emit('started', { agentCount: this.agents.size });
    }

    /**
     * Stops all agents gracefully.
     */
    stop(): void {
        if (!this.running) return;
        this.running = false;
        for (const agent of this.agents.values()) {
            agent.stop();
        }
        this.emit('stopped', {});
    }

    /**
     * Returns the state snapshot of all agents.
     */
    getAllStates(): AgentState[] {
        return Array.from(this.agents.values()).map((a) => a.getState());
    }

    /**
     * Returns the state for a specific agent.
     */
    getAgentState(agentId: string): AgentState | undefined {
        return this.agents.get(agentId)?.getState();
    }

    /**
     * Returns the number of managed agents.
     */
    get agentCount(): number {
        return this.agents.size;
    }

    /**
     * Returns all agent IDs.
     */
    getAgentIds(): string[] {
        return Array.from(this.agents.keys());
    }
}
