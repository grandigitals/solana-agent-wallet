import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
    TOKEN_PROGRAM_ID,
    createInitializeMintInstruction,
    createAssociatedTokenAccountInstruction,
    createMintToInstruction,
    createTransferInstruction,
    getAssociatedTokenAddress,
    getAccount,
    getMint,
    MINT_SIZE,
    getMinimumBalanceForRentExemptMint,
} from '@solana/spl-token';

export interface MintResult {
    mintPublicKey: PublicKey;
    signature: string;
    explorerUrl: string;
}

export interface TokenAccountResult {
    associatedTokenAccount: PublicKey;
    signature: string;
    explorerUrl: string;
}

export interface MintToResult {
    signature: string;
    explorerUrl: string;
}

export interface TransferResult {
    signature: string;
    explorerUrl: string;
}

export interface TokenBalance {
    mint: string;
    owner: string;
    tokenAccount: string;
    amount: bigint;
    decimals: number;
    uiAmount: number;
}

const EXPLORER_BASE = 'https://explorer.solana.com/tx';

function explorerUrl(signature: string): string {
    return `${EXPLORER_BASE}/${signature}?cluster=devnet`;
}

/**
 * Creates a new SPL Token Mint on Devnet.
 * @param connection  - Active Solana connection
 * @param payer       - Keypair paying for rent + fees
 * @param mintAuthority - PublicKey that can mint new tokens
 * @param decimals    - Number of decimal places (e.g. 6 like USDC)
 */
export async function createMint(
    connection: Connection,
    payer: Keypair,
    mintAuthority: PublicKey,
    decimals: number = 6
): Promise<MintResult> {
    // Generate a new keypair for the mint account
    const mintKeypair = Keypair.generate();

    const lamports = await getMinimumBalanceForRentExemptMint(connection);

    const transaction = new Transaction().add(
        // 1. Create mint account
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: mintKeypair.publicKey,
            space: MINT_SIZE,
            lamports,
            programId: TOKEN_PROGRAM_ID,
        }),
        // 2. Initialize the mint
        createInitializeMintInstruction(
            mintKeypair.publicKey,
            decimals,
            mintAuthority,
            null, // no freeze authority
            TOKEN_PROGRAM_ID
        )
    );

    const signature = await sendAndConfirmTransaction(connection, transaction, [
        payer,
        mintKeypair,
    ]);

    return {
        mintPublicKey: mintKeypair.publicKey,
        signature,
        explorerUrl: explorerUrl(signature),
    };
}

/**
 * Gets or creates the Associated Token Account for a given wallet + mint.
 * If it already exists the existing address is returned without creating.
 */
export async function getOrCreateAssociatedTokenAccount(
    connection: Connection,
    payer: Keypair,
    mint: PublicKey,
    owner: PublicKey
): Promise<{ ata: PublicKey; signature?: string; explorerUrl?: string }> {
    const ata = await getAssociatedTokenAddress(mint, owner);

    try {
        await getAccount(connection, ata);
        // Already exists — return without tx
        return { ata };
    } catch {
        // Doesn't exist — create it
        const transaction = new Transaction().add(
            createAssociatedTokenAccountInstruction(
                payer.publicKey,
                ata,
                owner,
                mint
            )
        );
        const signature = await sendAndConfirmTransaction(connection, transaction, [payer]);
        return {
            ata,
            signature,
            explorerUrl: explorerUrl(signature),
        };
    }
}

/**
 * Mints `amount` raw tokens to a recipient's associated token account.
 * The payer/authority must be the mint authority.
 */
export async function mintTokens(
    connection: Connection,
    payer: Keypair,
    mint: PublicKey,
    destinationOwner: PublicKey,
    amount: bigint
): Promise<MintToResult> {
    const { ata } = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        mint,
        destinationOwner
    );

    const transaction = new Transaction().add(
        createMintToInstruction(mint, ata, payer.publicKey, amount)
    );

    const signature = await sendAndConfirmTransaction(connection, transaction, [payer]);
    return { signature, explorerUrl: explorerUrl(signature) };
}

/**
 * Transfers SPL tokens from one owner to another.
 * The sender keypair must own the source token account.
 */
export async function transferTokens(
    connection: Connection,
    payer: Keypair,
    mint: PublicKey,
    senderKeypair: Keypair,
    destinationOwner: PublicKey,
    amount: bigint
): Promise<TransferResult> {
    const sourceAta = await getAssociatedTokenAddress(mint, senderKeypair.publicKey);

    // Ensure destination ATA exists
    const { ata: destAta } = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        mint,
        destinationOwner
    );

    const transaction = new Transaction().add(
        createTransferInstruction(
            sourceAta,
            destAta,
            senderKeypair.publicKey,
            amount
        )
    );

    const signature = await sendAndConfirmTransaction(connection, transaction, [
        payer,
        senderKeypair,
    ]);

    return { signature, explorerUrl: explorerUrl(signature) };
}

/**
 * Returns the SPL token balance for a given wallet + mint pair.
 */
export async function getTokenBalance(
    connection: Connection,
    mint: PublicKey,
    owner: PublicKey
): Promise<TokenBalance> {
    const ata = await getAssociatedTokenAddress(mint, owner);
    const mintInfo = await getMint(connection, mint);

    try {
        const account = await getAccount(connection, ata);
        const rawAmount = account.amount;
        const uiAmount = Number(rawAmount) / Math.pow(10, mintInfo.decimals);
        return {
            mint: mint.toBase58(),
            owner: owner.toBase58(),
            tokenAccount: ata.toBase58(),
            amount: rawAmount,
            decimals: mintInfo.decimals,
            uiAmount,
        };
    } catch {
        return {
            mint: mint.toBase58(),
            owner: owner.toBase58(),
            tokenAccount: ata.toBase58(),
            amount: BigInt(0),
            decimals: mintInfo.decimals,
            uiAmount: 0,
        };
    }
}
