import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
    LAMPORTS_PER_SOL,
} from '@solana/web3.js';

export interface TransferResult {
    signature: string;
    fromPublicKey: string;
    toPublicKey: string;
    lamports: number;
    solAmount: number;
    slot?: number;
}

export interface TransferError {
    fromPublicKey: string;
    toPublicKey: string;
    lamports: number;
    error: string;
}

/**
 * Retrieves the SOL balance (in lamports) for a given public key.
 */
export async function getBalance(
    connection: Connection,
    publicKey: PublicKey
): Promise<number> {
    return await connection.getBalance(publicKey);
}

/**
 * Retrieves the SOL balance and converts it to SOL (floating point).
 */
export async function getBalanceInSOL(
    connection: Connection,
    publicKey: PublicKey
): Promise<number> {
    const lamports = await connection.getBalance(publicKey);
    return lamports / LAMPORTS_PER_SOL;
}

/**
 * Builds a system-program SOL transfer transaction.
 */
export function buildTransferTransaction(
    from: PublicKey,
    to: PublicKey,
    lamports: number
): Transaction {
    const transaction = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: from,
            toPubkey: to,
            lamports,
        })
    );
    return transaction;
}

/**
 * Signs and sends a SOL transfer, waiting for confirmation.
 * Returns a TransferResult on success, or throws a TransferError on failure.
 */
export async function sendSolTransfer(
    connection: Connection,
    fromKeypair: Keypair,
    toPublicKey: PublicKey,
    lamports: number
): Promise<TransferResult> {
    const transaction = buildTransferTransaction(
        fromKeypair.publicKey,
        toPublicKey,
        lamports
    );

    // Get a recent blockhash
    const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;
    transaction.feePayer = fromKeypair.publicKey;

    const signature = await sendAndConfirmTransaction(connection, transaction, [fromKeypair], {
        commitment: 'confirmed',
        maxRetries: 3,
    });

    return {
        signature,
        fromPublicKey: fromKeypair.publicKey.toBase58(),
        toPublicKey: toPublicKey.toBase58(),
        lamports,
        solAmount: lamports / LAMPORTS_PER_SOL,
    };
}

/**
 * Requests a devnet airdrop for testing purposes.
 * NOTE: Public devnet faucet is rate-limited; use sparingly.
 */
export async function requestAirdrop(
    connection: Connection,
    publicKey: PublicKey,
    lamports: number = LAMPORTS_PER_SOL
): Promise<string> {
    const signature = await connection.requestAirdrop(publicKey, lamports);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    return signature;
}

/**
 * Converts lamports to SOL.
 */
export function lamportsToSol(lamports: number): number {
    return lamports / LAMPORTS_PER_SOL;
}

/**
 * Converts SOL to lamports.
 */
export function solToLamports(sol: number): number {
    return Math.floor(sol * LAMPORTS_PER_SOL);
}
