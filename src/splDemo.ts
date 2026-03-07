/**
 * splDemo.ts
 * ──────────
 * Fully dynamic end-to-end SPL Token demo.
 *
 * Usage:
 *   npm run spl-demo               (default: 3 agents)
 *   npm run spl-demo -- --agents=5 (5 agents)
 *
 * What it does:
 *  1. Loads N agent wallets from encrypted storage (creates if missing)
 *  2. Creates a new SPL Token mint (agent-0 is mint authority)
 *  3. Mints (N × 250,000) tokens to agent-0
 *  4. Distributes 250,000 tokens equally to every other agent
 *  5. Prints all final token balances
 *  Every transaction signature is printed as a Solana Explorer devnet link.
 *
 * Prerequisites:
 *  - agent-0 must have some Devnet SOL (pays for all transactions)
 *  - ENCRYPTION_PASSWORD must be set in .env
 */

import dotenv from 'dotenv';
dotenv.config();

import { connection } from './solana/connection';
import { WalletManager, ManagedWallet } from './wallet/WalletManager';
import {
    createMint,
    getOrCreateAssociatedTokenAccount,
    mintTokens,
    transferTokens,
    getTokenBalance,
} from './solana/tokens';

// ── CLI argument parsing ───────────────────────────────────────────────────

function parseArgs(): { agentCount: number } {
    const raw = process.argv.find((a) => a.startsWith('--agents='));
    const agentCount = raw ? parseInt(raw.split('=')[1], 10) : 3;

    if (isNaN(agentCount) || agentCount < 1) {
        console.error('[ERROR] --agents must be a positive integer');
        process.exit(1);
    }
    return { agentCount };
}

// ── Constants ──────────────────────────────────────────────────────────────

const MINT_DECIMALS = 6;
const TOKENS_PER_AGENT = 250_000;  // each non-mint agent receives this many tokens

// ── Helpers ────────────────────────────────────────────────────────────────

function line(char = '─', width = 60): string { return char.repeat(width); }
function log(msg: string): void { console.log(msg); }
function logStep(step: number, title: string): void {
    log(`\n${line()}\n  STEP ${step}: ${title}\n${line()}`);
}
function logTx(label: string, sig: string, url: string): void {
    log(`  ✅ ${label}`);
    log(`     Sig      : ${sig.slice(0, 20)}...${sig.slice(-8)}`);
    log(`     Explorer : ${url}`);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    if (!process.env.ENCRYPTION_PASSWORD) {
        console.error('[ERROR] ENCRYPTION_PASSWORD is not set in .env');
        process.exit(1);
    }

    const { agentCount } = parseArgs();
    const TOTAL_MINT = BigInt(agentCount * TOKENS_PER_AGENT * 10 ** MINT_DECIMALS);
    const TRANSFER_AMOUNT = BigInt(TOKENS_PER_AGENT * 10 ** MINT_DECIMALS);

    log('\n' + '═'.repeat(60));
    log('  🪙  Solana Agent Wallet — SPL Token Demo');
    log('═'.repeat(60));
    log(`  Network     : Devnet`);
    log(`  Agent Count : ${agentCount}`);
    log(`  Tokens/Agent: ${TOKENS_PER_AGENT.toLocaleString()}`);
    log(`  Total Mint  : ${(agentCount * TOKENS_PER_AGENT).toLocaleString()}`);
    log(`  Time        : ${new Date().toISOString()}`);

    // ── Step 1: Load wallets ─────────────────────────────────────────────────
    logStep(1, 'Loading Agent Wallets');

    const wallets: ManagedWallet[] = WalletManager.getOrCreateWallets(agentCount);
    for (const w of wallets) {
        log(`  ${w.agentId.padEnd(10)} : ${w.keypair.publicKey.toBase58()}`);
    }

    const agent0 = wallets[0];
    const peers = wallets.slice(1);

    // Verify agent-0 has enough SOL to pay for everything
    const agent0Sol = await connection.getBalance(agent0.keypair.publicKey);
    log(`\n  agent-0 SOL balance : ${(agent0Sol / 1e9).toFixed(6)} SOL`);

    if (agent0Sol < 10_000_000) {
        log('\n  ⚠️  agent-0 has insufficient SOL on Devnet.');
        log(`  Fund it at : https://faucet.solana.com`);
        log(`  Address    : ${agent0.keypair.publicKey.toBase58()}`);
        process.exit(1);
    }

    // ── Step 2: Create SPL Token Mint ───────────────────────────────────────
    logStep(2, 'Creating SPL Token Mint');
    log(`  Mint Authority : agent-0`);
    log(`  Decimals       : ${MINT_DECIMALS}`);

    const mintResult = await createMint(
        connection,
        agent0.keypair,
        agent0.keypair.publicKey,
        MINT_DECIMALS
    );
    log(`  Mint Address   : ${mintResult.mintPublicKey.toBase58()}`);
    logTx('Mint Created', mintResult.signature, mintResult.explorerUrl);

    // ── Step 3: Set up ATAs for all agents ──────────────────────────────────
    logStep(3, `Setting Up Token Accounts (${agentCount} agents)`);

    for (const w of wallets) {
        const result = await getOrCreateAssociatedTokenAccount(
            connection,
            agent0.keypair,             // agent-0 pays for all ATAs
            mintResult.mintPublicKey,
            w.keypair.publicKey
        );
        log(`  ${w.agentId.padEnd(10)} ATA : ${result.ata.toBase58()}`);
        if (result.signature) {
            logTx(`${w.agentId} ATA Created`, result.signature, result.explorerUrl!);
        } else {
            log(`    (already existed)`);
        }
    }

    // ── Step 4: Mint total supply to agent-0 ────────────────────────────────
    logStep(4, `Minting ${(agentCount * TOKENS_PER_AGENT).toLocaleString()} Tokens to agent-0`);

    const mintToResult = await mintTokens(
        connection,
        agent0.keypair,
        mintResult.mintPublicKey,
        agent0.keypair.publicKey,
        TOTAL_MINT
    );
    logTx('Tokens Minted', mintToResult.signature, mintToResult.explorerUrl);

    // ── Step 5: Distribute to all peers ─────────────────────────────────────
    logStep(5, `Distributing ${TOKENS_PER_AGENT.toLocaleString()} Tokens to Each of ${peers.length} Peers`);

    for (const peer of peers) {
        const result = await transferTokens(
            connection,
            agent0.keypair,
            mintResult.mintPublicKey,
            agent0.keypair,
            peer.keypair.publicKey,
            TRANSFER_AMOUNT
        );
        logTx(`agent-0 → ${peer.agentId}`, result.signature, result.explorerUrl);
    }

    // ── Step 6: Final Balances ────────────────────────────────────────────────
    logStep(6, 'Final Token Balances');

    let grandTotal = 0;
    for (const w of wallets) {
        const bal = await getTokenBalance(
            connection,
            mintResult.mintPublicKey,
            w.keypair.publicKey
        );
        const label = w.agentId === 'agent-0'
            ? `${w.agentId} (minter)`
            : w.agentId;
        log(`  ${label.padEnd(18)} : ${bal.uiAmount.toLocaleString()} tokens`);
        grandTotal += bal.uiAmount;
    }
    log(`  ${'─'.repeat(38)}`);
    log(`  ${'Total'.padEnd(18)} : ${grandTotal.toLocaleString()} tokens`);

    log(`\n${'═'.repeat(60)}`);
    log('  ✅ SPL Token Demo Complete!');
    log('═'.repeat(60) + '\n');
}

main().catch((err) => {
    console.error('\n[FATAL]', err.message ?? err);
    process.exit(1);
});
