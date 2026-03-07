/**
 * splDemo.ts
 * ──────────
 * End-to-end SPL Token demo using existing encrypted agent wallets.
 *
 * What it does:
 *  1. Loads agent-0 and agent-1 keypairs from local encrypted storage
 *  2. Creates a new SPL Token mint (agent-0 is mint authority)
 *  3. Mints 1,000,000 tokens to agent-0's Associated Token Account
 *  4. Transfers 250,000 tokens from agent-0 → agent-1
 *  5. Prints both agents' final token balances
 *
 * Prerequisites:
 *  - agent-0 must have some Devnet SOL to pay for transactions
 *  - ENCRYPTION_PASSWORD must be set in .env
 *
 * Run with:
 *  npm run spl-demo
 */

import dotenv from 'dotenv';
dotenv.config();

import { connection } from './solana/connection';
import { WalletManager } from './wallet/WalletManager';
import {
    createMint,
    getOrCreateAssociatedTokenAccount,
    mintTokens,
    transferTokens,
    getTokenBalance,
} from './solana/tokens';

const MINT_DECIMALS = 6;
const MINT_AMOUNT = BigInt(1_000_000 * 10 ** MINT_DECIMALS); // 1,000,000 tokens
const TRANSFER_AMOUNT = BigInt(250_000 * 10 ** MINT_DECIMALS); // 250,000 tokens

function line(char: string = '─', width: number = 60): string {
    return char.repeat(width);
}

function log(msg: string): void {
    console.log(msg);
}

function logStep(step: number, title: string): void {
    log(`\n${line()}`);
    log(`  STEP ${step}: ${title}`);
    log(line());
}

function logTx(label: string, sig: string, url: string): void {
    log(`  ✅ ${label}`);
    log(`     Signature : ${sig.slice(0, 20)}...${sig.slice(-8)}`);
    log(`     Explorer  : ${url}`);
}

async function main(): Promise<void> {
    // ── Validate environment ──────────────────────────────────────────────────
    if (!process.env.ENCRYPTION_PASSWORD) {
        console.error('[ERROR] ENCRYPTION_PASSWORD is not set in .env');
        process.exit(1);
    }

    log('\n' + '═'.repeat(60));
    log('  🪙  Solana Agent Wallet — SPL Token Demo');
    log('═'.repeat(60));
    log(`  Network : Devnet`);
    log(`  Time    : ${new Date().toISOString()}`);

    // ── Step 1: Load wallets ──────────────────────────────────────────────────
    logStep(1, 'Loading Agent Wallets');

    const agent0Wallet = WalletManager.getOrCreateWallet('agent-0');
    const agent1Wallet = WalletManager.getOrCreateWallet('agent-1');
    const agent2Wallet = WalletManager.getOrCreateWallet('agent-2');

    log(`  agent-0 : ${agent0Wallet.keypair.publicKey.toBase58()}`);
    log(`  agent-1 : ${agent1Wallet.keypair.publicKey.toBase58()}`);
    log(`  agent-2 : ${agent2Wallet.keypair.publicKey.toBase58()}`);

    // Check SOL balance of agent-0 (needs SOL to pay for txs)
    const agent0Sol = await connection.getBalance(agent0Wallet.keypair.publicKey);
    log(`\n  agent-0 SOL balance: ${(agent0Sol / 1e9).toFixed(6)} SOL`);

    if (agent0Sol < 10_000_000) {
        console.error('\n  ⚠️  agent-0 has insufficient SOL on Devnet.');
        console.error('  Fund it at: https://faucet.solana.com');
        console.error(`  Address: ${agent0Wallet.keypair.publicKey.toBase58()}`);
        process.exit(1);
    }

    // ── Step 2: Create SPL Token Mint ─────────────────────────────────────────
    logStep(2, 'Creating SPL Token Mint');
    log(`  Mint Authority : agent-0`);
    log(`  Decimals       : ${MINT_DECIMALS}`);
    log(`  Creating...`);

    const mintResult = await createMint(
        connection,
        agent0Wallet.keypair,
        agent0Wallet.keypair.publicKey,
        MINT_DECIMALS
    );

    log(`  Mint Address   : ${mintResult.mintPublicKey.toBase58()}`);
    logTx('Mint Created', mintResult.signature, mintResult.explorerUrl);

    // ── Step 3: Create Associated Token Accounts ──────────────────────────────
    logStep(3, 'Setting Up Token Accounts');

    const agent0AtaResult = await getOrCreateAssociatedTokenAccount(
        connection,
        agent0Wallet.keypair,
        mintResult.mintPublicKey,
        agent0Wallet.keypair.publicKey
    );
    log(`  agent-0 ATA : ${agent0AtaResult.ata.toBase58()}`);
    if (agent0AtaResult.signature) {
        logTx('agent-0 ATA Created', agent0AtaResult.signature, agent0AtaResult.explorerUrl!);
    } else {
        log(`  ✅ agent-0 ATA already existed`);
    }

    const agent1AtaResult = await getOrCreateAssociatedTokenAccount(
        connection,
        agent0Wallet.keypair, // agent-0 pays for agent-1's ATA creation
        mintResult.mintPublicKey,
        agent1Wallet.keypair.publicKey
    );
    log(`  agent-1 ATA : ${agent1AtaResult.ata.toBase58()}`);
    if (agent1AtaResult.signature) {
        logTx('agent-1 ATA Created', agent1AtaResult.signature, agent1AtaResult.explorerUrl!);
    } else {
        log(`  ✅ agent-1 ATA already existed`);
    }

    const agent2AtaResult = await getOrCreateAssociatedTokenAccount(
        connection,
        agent0Wallet.keypair, // agent-0 pays for agent-2's ATA creation
        mintResult.mintPublicKey,
        agent2Wallet.keypair.publicKey
    );
    log(`  agent-2 ATA : ${agent2AtaResult.ata.toBase58()}`);
    if (agent2AtaResult.signature) {
        logTx('agent-2 ATA Created', agent2AtaResult.signature, agent2AtaResult.explorerUrl!);
    } else {
        log(`  ✅ agent-2 ATA already existed`);
    }

    // ── Step 4: Mint 1,000,000 tokens to agent-0 ─────────────────────────────
    logStep(4, `Minting 1,000,000 Tokens to agent-0`);

    const mintToResult = await mintTokens(
        connection,
        agent0Wallet.keypair,
        mintResult.mintPublicKey,
        agent0Wallet.keypair.publicKey,
        MINT_AMOUNT
    );
    logTx('Tokens Minted', mintToResult.signature, mintToResult.explorerUrl);

    // ── Step 5: Transfer 250,000 tokens to agent-1 ───────────────────────────
    logStep(5, 'Transferring 250,000 Tokens: agent-0 → agent-1 and agent-0 → agent-2');

    const transfer1Result = await transferTokens(
        connection,
        agent0Wallet.keypair,
        mintResult.mintPublicKey,
        agent0Wallet.keypair,
        agent1Wallet.keypair.publicKey,
        TRANSFER_AMOUNT
    );
    logTx('Tokens Sent to agent-1', transfer1Result.signature, transfer1Result.explorerUrl);

    const transfer2Result = await transferTokens(
        connection,
        agent0Wallet.keypair,
        mintResult.mintPublicKey,
        agent0Wallet.keypair,
        agent2Wallet.keypair.publicKey,
        TRANSFER_AMOUNT
    );
    logTx('Tokens Sent to agent-2', transfer2Result.signature, transfer2Result.explorerUrl);

    // ── Step 6: Final Balances ────────────────────────────────────────────────
    logStep(6, 'Final Token Balances');

    const agent0Balance = await getTokenBalance(
        connection,
        mintResult.mintPublicKey,
        agent0Wallet.keypair.publicKey
    );

    const agent1Balance = await getTokenBalance(
        connection,
        mintResult.mintPublicKey,
        agent1Wallet.keypair.publicKey
    );

    const agent2Balance = await getTokenBalance(
        connection,
        mintResult.mintPublicKey,
        agent2Wallet.keypair.publicKey
    );

    log(`  agent-0 : ${agent0Balance.uiAmount.toLocaleString()} tokens  (minted 1,000,000 − sent 500,000)`);
    log(`  agent-1 : ${agent1Balance.uiAmount.toLocaleString()} tokens`);
    log(`  agent-2 : ${agent2Balance.uiAmount.toLocaleString()} tokens`);
    log(`  Total   : ${(agent0Balance.uiAmount + agent1Balance.uiAmount + agent2Balance.uiAmount).toLocaleString()} tokens`);

    log(`\n${'═'.repeat(60)}`);
    log('  ✅ SPL Token Demo Complete!');
    log('═'.repeat(60) + '\n');
}

main().catch((err) => {
    console.error('\n[FATAL]', err.message ?? err);
    process.exit(1);
});
