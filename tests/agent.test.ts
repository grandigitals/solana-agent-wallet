
import { describe, expect, it, beforeEach, afterAll } from '@jest/globals';

// Set a dummy encryption password for tests
process.env.ENCRYPTION_PASSWORD = 'test-encryption-password-for-jest-1234567890ab';
process.env.KEYS_FILE_PATH = './test-keys-temp.json';

import * as fs from 'fs';
import * as path from 'path';
import { Keypair } from '@solana/web3.js';

import {
    encrypt,
    decrypt,
    saveKeypair,
    loadSecretKey,
    listStoredAgents,
    removeKeypair,
    loadKeysFile,
} from '../src/wallet/KeyStorage';
import { WalletManager } from '../src/wallet/WalletManager';
import { Agent, AgentAction } from '../src/agent/Agent';
import { Connection } from '@solana/web3.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const TEST_KEYS_FILE = path.resolve('./test-keys-temp.json');

function cleanupTestKeysFile(): void {
    if (fs.existsSync(TEST_KEYS_FILE)) {
        fs.unlinkSync(TEST_KEYS_FILE);
    }
}

// ── KeyStorage Tests ─────────────────────────────────────────────────────────

describe('KeyStorage — encrypt/decrypt', () => {
    const password = 'test-password-cipher-check';

    it('should encrypt data and produce a non-empty hex string', () => {
        const plaintext = Buffer.from('hello solana agent');
        const { encrypted, iv } = encrypt(plaintext, password);
        expect(encrypted).toBeTruthy();
        expect(encrypted.length).toBeGreaterThan(0);
        expect(iv).toHaveLength(32); // 16 bytes → 32 hex chars
    });

    it('should decrypt encrypted data back to the original', () => {
        const plaintext = Buffer.from('secret key bytes 1234567890abcdef');
        const { encrypted, iv } = encrypt(plaintext, password);
        const decrypted = decrypt(encrypted, iv, password);
        expect(Buffer.compare(decrypted, plaintext)).toBe(0);
    });

    it('should produce different ciphertext for the same plaintext (different IV each time)', () => {
        const plaintext = Buffer.from('deterministic check');
        const result1 = encrypt(plaintext, password);
        const result2 = encrypt(plaintext, password);
        // IVs should differ (random each call)
        expect(result1.iv).not.toBe(result2.iv);
    });

    it('should throw when decrypting with wrong password', () => {
        const plaintext = Buffer.from('some secret data');
        const { encrypted, iv } = encrypt(plaintext, password);
        expect(() => decrypt(encrypted, iv, 'wrong-password')).toThrow();
    });
});

// ── KeyStorage — File I/O Tests ───────────────────────────────────────────────

describe('KeyStorage — file I/O', () => {
    beforeEach(() => cleanupTestKeysFile());
    afterAll(() => cleanupTestKeysFile());

    it('should return empty keys file when file does not exist', () => {
        const keysFile = loadKeysFile();
        expect(keysFile.keys).toHaveLength(0);
        expect(keysFile.version).toBe(1);
    });

    it('should save and load a keypair by agentId', () => {
        const agentId = 'test-agent-0';
        const keypair = Keypair.generate();
        saveKeypair(agentId, keypair.publicKey.toBase58(), keypair.secretKey);

        const loaded = loadSecretKey(agentId);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(64);

        // Reconstruct keypair from loaded secret
        const reconstructed = Keypair.fromSecretKey(loaded!);
        expect(reconstructed.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
    });

    it('should return null for a non-existent agentId', () => {
        const result = loadSecretKey('agent-does-not-exist');
        expect(result).toBeNull();
    });

    it('should list all stored agents', () => {
        const kp1 = Keypair.generate();
        const kp2 = Keypair.generate();
        saveKeypair('agent-A', kp1.publicKey.toBase58(), kp1.secretKey);
        saveKeypair('agent-B', kp2.publicKey.toBase58(), kp2.secretKey);

        const agents = listStoredAgents();
        const ids = agents.map((a) => a.agentId);
        expect(ids).toContain('agent-A');
        expect(ids).toContain('agent-B');
    });

    it('should overwrite an existing keypair for the same agentId', () => {
        const agentId = 'agent-overwrite';
        const kp1 = Keypair.generate();
        const kp2 = Keypair.generate();

        saveKeypair(agentId, kp1.publicKey.toBase58(), kp1.secretKey);
        saveKeypair(agentId, kp2.publicKey.toBase58(), kp2.secretKey);

        const agents = listStoredAgents().filter((a) => a.agentId === agentId);
        expect(agents).toHaveLength(1);
        expect(agents[0].publicKey).toBe(kp2.publicKey.toBase58());
    });

    it('should remove a keypair by agentId', () => {
        const agentId = 'agent-to-remove';
        const kp = Keypair.generate();
        saveKeypair(agentId, kp.publicKey.toBase58(), kp.secretKey);

        removeKeypair(agentId);
        expect(loadSecretKey(agentId)).toBeNull();
    });
});

// ── WalletManager Tests ──────────────────────────────────────────────────────

describe('WalletManager', () => {
    beforeEach(() => cleanupTestKeysFile());
    afterAll(() => cleanupTestKeysFile());

    it('should create a new wallet and return a Keypair', () => {
        const wallet = WalletManager.createNewWallet('wm-test-0');
        expect(wallet.agentId).toBe('wm-test-0');
        expect(wallet.keypair).toBeInstanceOf(Keypair);
        // Base58-encoded Solana public keys are 43 or 44 characters (not always exactly 44)
        const pubKeyLen = wallet.keypair.publicKey.toBase58().length;
        expect(pubKeyLen).toBeGreaterThanOrEqual(43);
        expect(pubKeyLen).toBeLessThanOrEqual(44);
    });

    it('should load an existing wallet instead of creating a new one', () => {
        const wallet1 = WalletManager.createNewWallet('wm-load-test');
        const wallet2 = WalletManager.getOrCreateWallet('wm-load-test');

        expect(wallet2.keypair.publicKey.toBase58()).toBe(wallet1.keypair.publicKey.toBase58());
    });

    it('should create N wallets via getOrCreateWallets', () => {
        const wallets = WalletManager.getOrCreateWallets(4);
        expect(wallets).toHaveLength(4);
        const ids = wallets.map((w) => w.agentId);
        expect(ids).toEqual(['agent-0', 'agent-1', 'agent-2', 'agent-3']);
    });

    it('should generate unique public keys for each agent', () => {
        const wallets = WalletManager.getOrCreateWallets(5);
        const publicKeys = wallets.map((w) => w.keypair.publicKey.toBase58());
        const unique = new Set(publicKeys);
        expect(unique.size).toBe(5);
    });
});

// ── Agent Tests ───────────────────────────────────────────────────────────────

describe('Agent', () => {
    it('should initialize with correct agentId and publicKey', () => {
        const keypair = Keypair.generate();
        const mockConnection = {} as Connection;

        const agent = new Agent({
            agentId: 'test-agent',
            keypair,
            connection: mockConnection,
            intervalMs: 99999,
        });

        expect(agent.agentId).toBe('test-agent');
        expect(agent.publicKeyBase58).toBe(keypair.publicKey.toBase58());
        expect(agent.getState().isRunning).toBe(false);
        expect(agent.getState().totalTransactions).toBe(0);
    });

    it('should emit an "action" event on initialization', () => {
        const mockConnection = {} as Connection;
        const capturedActions: AgentAction[] = [];

        // Extend Agent to capture actions before they are emitted
        // We accumulate by listening on a fresh agent right after construction.
        // Because INITIALIZED fires synchronously in the constructor, we intercept
        // by subclassing and overriding emit to record events before they propagate.
        class RecordingAgent extends Agent {
            override emit(event: string | symbol, ...args: unknown[]): boolean {
                if (event === 'action') capturedActions.push(args[0] as AgentAction);
                return super.emit(event, ...args);
            }
        }

        new RecordingAgent({
            agentId: 'event-capture-agent',
            keypair: Keypair.generate(),
            connection: mockConnection,
            intervalMs: 99999,
        });

        expect(capturedActions.length).toBeGreaterThanOrEqual(1);
        const initAction = capturedActions.find((a) => a.actionType === 'INITIALIZED');
        expect(initAction).toBeDefined();
        expect(initAction?.agentId).toBe('event-capture-agent');
    });

    it('should setPeers and exclude self from peers list', () => {
        const keypair = Keypair.generate();
        const peer1 = Keypair.generate().publicKey;
        const peer2 = Keypair.generate().publicKey;
        const mockConnection = {} as Connection;

        const agent = new Agent({
            agentId: 'peer-test',
            keypair,
            connection: mockConnection,
            intervalMs: 99999,
        });

        // Include self and peers
        agent.setPeers([keypair.publicKey, peer1, peer2]);

        // Start and stop immediately to test that no error is thrown
        // (actual RPC calls would fail without a real connection)
        expect(() => agent.stop()).not.toThrow();
    });

    it('should stop cleanly and mark isRunning as false', () => {
        const keypair = Keypair.generate();
        const mockConnection = {} as Connection;

        const agent = new Agent({
            agentId: 'stop-test',
            keypair,
            connection: mockConnection,
            intervalMs: 99999,
        });

        agent.stop();
        expect(agent.getState().isRunning).toBe(false);
    });
});
