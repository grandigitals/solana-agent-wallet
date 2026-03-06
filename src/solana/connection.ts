import { Connection, clusterApiUrl } from '@solana/web3.js';
import dotenv from 'dotenv';

dotenv.config();

const rpcUrl = process.env.SOLANA_RPC_URL ?? clusterApiUrl('devnet');

/**
 * A shared Connection instance targeting Solana Devnet.
 * Uses the RPC URL from SOLANA_RPC_URL env var, falling back to the
 * official public Devnet endpoint.
 */
export const connection = new Connection(rpcUrl, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 60000,
});

/**
 * Returns the configured RPC endpoint URL.
 */
export function getRpcUrl(): string {
    return rpcUrl;
}
