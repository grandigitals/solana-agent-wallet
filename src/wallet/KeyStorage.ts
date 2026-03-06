import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const ALGORITHM = 'aes-256-cbc';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits

export interface StoredKeypair {
    agentId: string;
    publicKey: string;
    encryptedSecretKey: string; // hex-encoded encrypted data
    iv: string;                  // hex-encoded IV used for this entry
    createdAt: string;
}

export interface KeysFile {
    version: number;
    keys: StoredKeypair[];
}

/**
 * Derives a 32-byte encryption key from the password using scrypt.
 * A fixed salt is used per-file (the salt is stored in the keys file itself
 * or derived from a constant) — for this implementation we use a well-known
 * salt so key derivation is deterministic across runs with the same password.
 */
function deriveKey(password: string): Buffer {
    const salt = 'solana-agent-wallet-v1-salt-2024'; // static salt for simplicity
    return crypto.scryptSync(password, salt, KEY_LENGTH);
}

function getPassword(): string {
    const password = process.env.ENCRYPTION_PASSWORD;
    if (!password) {
        throw new Error(
            'ENCRYPTION_PASSWORD is not set in environment. Copy .env.example to .env and set a strong password.'
        );
    }
    return password;
}

function getFilePath(): string {
    return path.resolve(process.env.KEYS_FILE_PATH ?? 'keys.json');
}

/**
 * Encrypts a Buffer (e.g. secret key bytes) and returns { encrypted, iv } as hex strings.
 */
export function encrypt(data: Buffer, password: string): { encrypted: string; iv: string } {
    const key = deriveKey(password);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    return {
        encrypted: encrypted.toString('hex'),
        iv: iv.toString('hex'),
    };
}

/**
 * Decrypts a hex-encoded encrypted string using the given IV, and returns the original Buffer.
 */
export function decrypt(encryptedHex: string, ivHex: string, password: string): Buffer {
    const key = deriveKey(password);
    const iv = Buffer.from(ivHex, 'hex');
    const encryptedData = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
}

/**
 * Loads the keys file from disk. Returns an empty KeysFile if it doesn't exist.
 */
export function loadKeysFile(): KeysFile {
    const filePath = getFilePath();
    if (!fs.existsSync(filePath)) {
        return { version: 1, keys: [] };
    }
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw) as KeysFile;
    } catch (err) {
        throw new Error(`Failed to parse keys file at "${filePath}": ${(err as Error).message}`);
    }
}

/**
 * Saves the keys file to disk atomically.
 */
export function saveKeysFile(keysFile: KeysFile): void {
    const filePath = getFilePath();
    const tempPath = filePath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(keysFile, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
}

/**
 * Persists a StoredKeypair to the keys file.
 * If an entry for the agentId already exists, it is replaced.
 */
export function saveKeypair(agentId: string, publicKeyBase58: string, secretKey: Uint8Array): void {
    const password = getPassword();
    const { encrypted, iv } = encrypt(Buffer.from(secretKey), password);

    const keysFile = loadKeysFile();
    const existingIndex = keysFile.keys.findIndex((k) => k.agentId === agentId);

    const entry: StoredKeypair = {
        agentId,
        publicKey: publicKeyBase58,
        encryptedSecretKey: encrypted,
        iv,
        createdAt: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
        keysFile.keys[existingIndex] = entry;
    } else {
        keysFile.keys.push(entry);
    }

    saveKeysFile(keysFile);
}

/**
 * Loads and decrypts a keypair's secret key bytes for a given agentId.
 * Returns null if not found.
 */
export function loadSecretKey(agentId: string): Uint8Array | null {
    const password = getPassword();
    const keysFile = loadKeysFile();
    const entry = keysFile.keys.find((k) => k.agentId === agentId);
    if (!entry) return null;

    const decrypted = decrypt(entry.encryptedSecretKey, entry.iv, password);
    return new Uint8Array(decrypted);
}

/**
 * Returns all stored agent entries (without decrypting secret keys).
 */
export function listStoredAgents(): StoredKeypair[] {
    return loadKeysFile().keys;
}

/**
 * Removes a stored keypair by agentId.
 */
export function removeKeypair(agentId: string): void {
    const keysFile = loadKeysFile();
    keysFile.keys = keysFile.keys.filter((k) => k.agentId !== agentId);
    saveKeysFile(keysFile);
}
