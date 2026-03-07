# SKILLS.md — Agent Capabilities

This document describes the skills and capabilities of the autonomous agents within the `solana-agent-wallet` system.

## Core Skills

### 1. Wallet Management
- **Generate Keypair**: Each agent can create a new unique Ed25519 Solana keypair on instantiation.
- **Persist Identity**: Keypairs are encrypted (AES-256-CBC) and saved to a local `keys.json` file, persisting agent identity across restarts.
- **Load Identity**: On startup, agents attempt to reload their saved keypair from the encrypted store before generating a new one.

### 2. Solana Interaction
- **Query Balance**: Agents can query their current SOL balance on Solana Devnet at any time.
- **Build Transactions**: Agents can construct SOL transfer `Transaction` objects targeting other agents' public keys.
- **Sign & Send**: Agents sign transactions with their private key and broadcast them to the Devnet RPC.
- **Confirm Transactions**: Agents wait for and log transaction confirmation signatures.

### 3. Autonomous Decision Making
- **Peer Discovery**: Each agent knows the public keys of all other agents managed by the `AgentOrchestrator`.
- **Target Selection**: On each cycle, an agent randomly selects a peer agent as a transfer target (not itself).
- **Interval-Based Action**: Each agent operates on a configurable timer, triggering autonomous actions at regular intervals.
- **Balance Gating**: Agents check their balance before attempting a transfer and skip the action if funds are insufficient.

### 4. Observability & Logging
- **Structured Action Logs**: Every action (balance check, transfer attempt, success, error) is logged with:
  - Timestamp (ISO 8601)
  - Agent ID
  - Action Type (BALANCE_CHECK, TRANSFER_ATTEMPT, TRANSFER_SUCCESS, TRANSFER_ERROR, IDLE)
  - Details (target, amount, signature, error message)
- **Dashboard Reporting**: Agents emit state updates to the `Dashboard` for real-time visualization.

### 5. DeFi Protocol Interaction (SPL Tokens)
- **Token Mint Creation**: Agents can programmatically deploy new SPL Token mint programs to the blockchain.
- **ATA Management**: Agents know how to automatically resolve, fetch, and conditionally create Associated Token Accounts for themselves and their peers.
- **Token Minting & Distribution**: Agents acting as Mint Authorities can autonomously mint raw token supply and distribute it to peers using `createTransferInstruction`.

## Agent Lifecycle

```
Created → Keypair Loaded/Generated → Registered with Orchestrator → Started (timer active)
  → [On each tick]: Check Balance → Select Target → Build Tx → Sign → Send → Log Result
  → Stopped (timer cleared) → Terminated
```

## Limitations (Devnet)

- Transfer amounts are kept small (e.g., 1000 lamports = 0.000001 SOL) to preserve devnet balances.
- Agents cannot airdrop themselves; wallets must be topped up externally.
- RPC rate limits on the public Devnet endpoint may cause some requests to fail; the system handles these gracefully.
