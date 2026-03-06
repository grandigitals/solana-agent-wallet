import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { EventEmitter } from 'events';
import { getBalance, sendSolTransfer } from '../solana/transactions';

export type ActionType =
    | 'INITIALIZED'
    | 'BALANCE_CHECK'
    | 'TRANSFER_ATTEMPT'
    | 'TRANSFER_SUCCESS'
    | 'TRANSFER_ERROR'
    | 'INSUFFICIENT_FUNDS'
    | 'IDLE'
    | 'STOPPED';

export interface AgentAction {
    timestamp: string;
    agentId: string;
    actionType: ActionType;
    details: Record<string, unknown>;
}

export interface AgentState {
    agentId: string;
    publicKey: string;
    balanceLamports: number;
    balanceSOL: number;
    totalTransactions: number;
    successfulTransactions: number;
    failedTransactions: number;
    lastAction: AgentAction | null;
    isRunning: boolean;
}

export interface AgentConfig {
    agentId: string;
    keypair: Keypair;
    connection: Connection;
    intervalMs: number;
    /** Amount to send per transfer in lamports. Default: 1000 (~0.000001 SOL) */
    transferLamports?: number;
    /** Minimum balance required before attempting a transfer, in lamports */
    minBalanceLamports?: number;
}

/**
 * Represents an autonomous agent with its own Solana wallet.
 * The agent periodically selects a random peer and sends it a small SOL transfer.
 */
export class Agent extends EventEmitter {
    readonly agentId: string;
    readonly publicKey: PublicKey;
    readonly publicKeyBase58: string;

    private readonly keypair: Keypair;
    private readonly connection: Connection;
    private readonly intervalMs: number;
    private readonly transferLamports: number;
    private readonly minBalanceLamports: number;

    private peers: PublicKey[] = [];
    private timer: ReturnType<typeof setInterval> | null = null;
    private state: AgentState;

    constructor(config: AgentConfig) {
        super();
        this.agentId = config.agentId;
        this.keypair = config.keypair;
        this.publicKey = config.keypair.publicKey;
        this.publicKeyBase58 = config.keypair.publicKey.toBase58();
        this.connection = config.connection;
        this.intervalMs = config.intervalMs;
        this.transferLamports = config.transferLamports ?? 1000; // 0.000001 SOL
        this.minBalanceLamports = config.minBalanceLamports ?? 10000; // 0.00001 SOL

        this.state = {
            agentId: this.agentId,
            publicKey: this.publicKeyBase58,
            balanceLamports: 0,
            balanceSOL: 0,
            totalTransactions: 0,
            successfulTransactions: 0,
            failedTransactions: 0,
            lastAction: null,
            isRunning: false,
        };

        this.log('INITIALIZED', { publicKey: this.publicKeyBase58, intervalMs: this.intervalMs });
    }

    /**
     * Sets the list of peer public keys this agent can send transfers to.
     * Should be called before start(); will exclude this agent's own key automatically.
     */
    setPeers(peers: PublicKey[]): void {
        this.peers = peers.filter((p) => !p.equals(this.publicKey));
    }

    /**
     * Starts the agent's autonomous transfer loop.
     */
    start(): void {
        if (this.timer) return;
        this.state.isRunning = true;
        this.emit('stateChange', this.getState());

        // Run one tick immediately, then on interval
        void this.tick();
        this.timer = setInterval(() => void this.tick(), this.intervalMs);
    }

    /**
     * Stops the agent's autonomous transfer loop.
     */
    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.state.isRunning = false;
        this.log('STOPPED', {});
    }

    /**
     * Returns a snapshot of the agent's current state.
     */
    getState(): AgentState {
        return { ...this.state };
    }

    // ── Private ────────────────────────────────────────────────────────────────

    private async tick(): Promise<void> {
        await this.refreshBalance();

        if (this.peers.length === 0) {
            this.log('IDLE', { reason: 'No peers registered' });
            this.emit('stateChange', this.getState());
            return;
        }

        if (this.state.balanceLamports < this.minBalanceLamports) {
            this.log('INSUFFICIENT_FUNDS', {
                balance: this.state.balanceLamports,
                required: this.minBalanceLamports,
            });
            this.emit('stateChange', this.getState());
            return;
        }

        const target = this.selectRandomPeer();
        await this.attemptTransfer(target);
        this.emit('stateChange', this.getState());
    }

    private async refreshBalance(): Promise<void> {
        try {
            const lamports = await getBalance(this.connection, this.publicKey);
            this.state.balanceLamports = lamports;
            this.state.balanceSOL = lamports / LAMPORTS_PER_SOL;
            this.log('BALANCE_CHECK', { balanceLamports: lamports, balanceSOL: this.state.balanceSOL });
        } catch (err) {
            this.log('BALANCE_CHECK', { error: (err as Error).message });
        }
    }

    private selectRandomPeer(): PublicKey {
        const idx = Math.floor(Math.random() * this.peers.length);
        return this.peers[idx];
    }

    private async attemptTransfer(target: PublicKey): Promise<void> {
        const targetBase58 = target.toBase58();
        this.log('TRANSFER_ATTEMPT', {
            to: targetBase58,
            lamports: this.transferLamports,
            solAmount: this.transferLamports / LAMPORTS_PER_SOL,
        });
        this.state.totalTransactions++;

        try {
            const result = await sendSolTransfer(
                this.connection,
                this.keypair,
                target,
                this.transferLamports
            );
            this.state.successfulTransactions++;
            this.log('TRANSFER_SUCCESS', {
                to: targetBase58,
                lamports: this.transferLamports,
                signature: result.signature,
            });
        } catch (err) {
            this.state.failedTransactions++;
            this.log('TRANSFER_ERROR', {
                to: targetBase58,
                lamports: this.transferLamports,
                error: (err as Error).message,
            });
        }
    }

    private log(actionType: ActionType, details: Record<string, unknown>): void {
        const action: AgentAction = {
            timestamp: new Date().toISOString(),
            agentId: this.agentId,
            actionType,
            details,
        };
        this.state.lastAction = action;
        this.emit('action', action);
    }
}
