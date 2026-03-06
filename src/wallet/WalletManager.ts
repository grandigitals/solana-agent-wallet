import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import {
    saveKeypair,
    loadSecretKey,
    listStoredAgents,
    StoredKeypair,
} from './KeyStorage';

export interface ManagedWallet {
    agentId: string;
    keypair: Keypair;
}

/**
 * WalletManager creates, loads, and manages Solana Keypairs for agents.
 * Each agent gets a deterministic agentId (e.g., "agent-0", "agent-1") and
 * its keypair is stored encrypted in keys.json.
 */
export class WalletManager {
    /**
     * Creates or loads a wallet for the given agentId.
     * If a keypair already exists in storage for this agentId, it is loaded.
     * Otherwise, a new Keypair is generated and saved.
     */
    static getOrCreateWallet(agentId: string): ManagedWallet {
        const existingSecret = loadSecretKey(agentId);

        if (existingSecret) {
            const keypair = Keypair.fromSecretKey(existingSecret);
            return { agentId, keypair };
        }

        // Generate a fresh keypair
        const keypair = Keypair.generate();
        const publicKeyBase58 = keypair.publicKey.toBase58();
        saveKeypair(agentId, publicKeyBase58, keypair.secretKey);
        return { agentId, keypair };
    }

    /**
     * Generates a brand-new wallet regardless of storage state. Overwrites any
     * existing entry for the agentId.
     */
    static createNewWallet(agentId: string): ManagedWallet {
        const keypair = Keypair.generate();
        const publicKeyBase58 = keypair.publicKey.toBase58();
        saveKeypair(agentId, publicKeyBase58, keypair.secretKey);
        return { agentId, keypair };
    }

    /**
     * Creates or loads wallets for N agents numbered 0..N-1.
     */
    static getOrCreateWallets(count: number): ManagedWallet[] {
        const wallets: ManagedWallet[] = [];
        for (let i = 0; i < count; i++) {
            const agentId = `agent-${i}`;
            wallets.push(WalletManager.getOrCreateWallet(agentId));
        }
        return wallets;
    }

    /**
     * Returns the public key in base58 format for the given keypair.
     */
    static getPublicKeyBase58(keypair: Keypair): string {
        return keypair.publicKey.toBase58();
    }

    /**
     * Returns the secret key in base58 format (handle with care!).
     */
    static getSecretKeyBase58(keypair: Keypair): string {
        return bs58.encode(keypair.secretKey);
    }

    /**
     * Lists all agents that have stored wallets.
     */
    static listStoredWallets(): StoredKeypair[] {
        return listStoredAgents();
    }
}
