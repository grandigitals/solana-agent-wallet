import blessed from 'blessed';
import { AgentState, AgentAction } from '../agent/Agent';

const MAX_LOG_LINES = 200;

/**
 * CLI Dashboard powered by `blessed`.
 * Renders a two-panel layout:
 *  - Top: Agent status table (ID, public key, balance, tx counts)
 *  - Bottom: Scrollable live action log
 */
export class Dashboard {
    private screen: blessed.Widgets.Screen;
    private agentBox: blessed.Widgets.BoxElement;
    private logBox: blessed.Widgets.Log;
    private headerBox: blessed.Widgets.BoxElement;
    private footerBox: blessed.Widgets.BoxElement;

    private agentStates: Map<string, AgentState> = new Map();
    private logLines: string[] = [];

    constructor() {
        this.screen = blessed.screen({
            smartCSR: true,
            title: 'Solana Agent Wallet — Live Dashboard',
            fullUnicode: true,
        });

        // ── Header ──────────────────────────────────────────────────────────────
        this.headerBox = blessed.box({
            top: 0,
            left: 0,
            width: '100%',
            height: 3,
            content:
                '{center}{bold}{cyan-fg}⬡  Solana Agent Wallet — Devnet Dashboard  ⬡{/cyan-fg}{/bold}{/center}',
            tags: true,
            style: {
                bg: '#0a0a1a',
                fg: '#00d4ff',
                border: { fg: '#00d4ff' },
            },
            border: { type: 'line' },
        });

        // ── Agent Status Panel ───────────────────────────────────────────────────
        this.agentBox = blessed.box({
            top: 3,
            left: 0,
            width: '100%',
            height: '40%',
            label: ' {bold}{yellow-fg}🤖 Agent Status{/yellow-fg}{/bold} ',
            tags: true,
            scrollable: true,
            alwaysScroll: true,
            style: {
                bg: '#0a0a1a',
                fg: '#e0e0e0',
                border: { fg: '#444488' },
                label: { fg: '#ffcc00' },
            },
            border: { type: 'line' },
            padding: { top: 0, left: 1, right: 1, bottom: 0 },
        });

        // ── Log Panel ────────────────────────────────────────────────────────────
        this.logBox = blessed.log({
            bottom: 1,
            left: 0,
            width: '100%',
            height: '56%',
            label: ' {bold}{green-fg}📋 Live Action Log{/green-fg}{/bold} ',
            tags: true,
            scrollable: true,
            alwaysScroll: true,
            mouse: true,
            keys: true,
            vi: true,
            style: {
                bg: '#06060f',
                fg: '#b0ffb0',
                border: { fg: '#226622' },
                label: { fg: '#00ff88' },
                scrollbar: { bg: '#226622' },
            },
            border: { type: 'line' },
            scrollbar: { ch: '▐', track: { bg: '#1a1a2e' } },
        });

        // ── Footer ───────────────────────────────────────────────────────────────
        this.footerBox = blessed.box({
            bottom: 0,
            left: 0,
            width: '100%',
            height: 1,
            content:
                ' {grey-fg}[Q]{/grey-fg} Quit   {grey-fg}[↑/↓]{/grey-fg} Scroll Log   {grey-fg}[R]{/grey-fg} Refresh',
            tags: true,
            style: {
                bg: '#111122',
                fg: '#888888',
            },
        });

        this.screen.append(this.headerBox);
        this.screen.append(this.agentBox);
        this.screen.append(this.logBox);
        this.screen.append(this.footerBox);

        // Key bindings
        this.screen.key(['q', 'Q', 'C-c'], () => {
            this.destroy();
            process.exit(0);
        });

        this.screen.render();
    }

    /**
     * Updates the state for a given agent and re-renders the status panel.
     */
    updateAgentState(state: AgentState): void {
        this.agentStates.set(state.agentId, state);
        this.renderAgentTable();
    }

    /**
     * Appends an action to the live log panel with formatting.
     */
    appendLog(action: AgentAction): void {
        const time = action.timestamp.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
        const color = this.actionColor(action.actionType);
        const shortKey = this.agentStates.get(action.agentId)?.publicKey?.slice(0, 8) ?? '????????';
        const details = this.formatDetails(action);

        const line =
            `{grey-fg}${time}{/grey-fg} ` +
            `{cyan-fg}[${action.agentId}]{/cyan-fg} ` +
            `{${color}-fg}[${shortKey}…]{/} ` +
            `{bold}{${color}-fg}${action.actionType}{/bold}{/} ` +
            details;

        this.logLines.push(line);
        if (this.logLines.length > MAX_LOG_LINES) {
            this.logLines.shift();
        }

        this.logBox.log(line);
        this.screen.render();
    }

    /**
     * Logs a plain info message to the log panel.
     */
    logInfo(message: string): void {
        const time = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
        const line = `{grey-fg}${time}{/grey-fg} {white-fg}{bold}[INFO]{/bold} ${message}{/white-fg}`;
        this.logBox.log(line);
        this.screen.render();
    }

    /**
     * Logs an error message to the log panel.
     */
    logError(message: string): void {
        const time = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
        const line = `{grey-fg}${time}{/grey-fg} {red-fg}{bold}[ERROR]{/bold} ${message}{/red-fg}`;
        this.logBox.log(line);
        this.screen.render();
    }

    /**
     * Destroys the blessed screen and returns the terminal to normal.
     */
    destroy(): void {
        this.screen.destroy();
    }

    // ── Private ─────────────────────────────────────────────────────────────

    private renderAgentTable(): void {
        const states = Array.from(this.agentStates.values());
        if (states.length === 0) {
            this.agentBox.setContent('  {grey-fg}No agents registered yet…{/grey-fg}');
            this.screen.render();
            return;
        }

        // Column widths
        const idW = 10;
        const keyW = 46;
        const balW = 16;
        const txW = 8;
        const stW = 9;

        const sep = '{grey-fg}│{/grey-fg}';

        const pad = (s: string, w: number): string =>
            s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w);

        const header =
            `{bold}{yellow-fg}` +
            `${'ID'.padEnd(idW)} ${sep} ${'Public Key'.padEnd(keyW)} ${sep} ` +
            `${'Balance (SOL)'.padEnd(balW)} ${sep} ${'OK TX'.padEnd(txW)} ${sep} ${'Fail TX'.padEnd(txW)} ${sep} ${'Status'.padEnd(stW)}` +
            `{/yellow-fg}{/bold}`;

        const divider = '{grey-fg}' + '─'.repeat(idW + keyW + balW + txW * 2 + stW + 20) + '{/grey-fg}';

        const rows = states.map((s) => {
            const running = s.isRunning ? '{green-fg}●  RUN   {/green-fg}' : '{red-fg}◉  STOP  {/red-fg}';
            const balance = s.balanceSOL.toFixed(6);
            return (
                `{cyan-fg}${pad(s.agentId, idW)}{/cyan-fg} ${sep} ` +
                `{white-fg}${pad(s.publicKey, keyW)}{/white-fg} ${sep} ` +
                `{yellow-fg}${pad(balance, balW)}{/yellow-fg} ${sep} ` +
                `{green-fg}${pad(String(s.successfulTransactions), txW)}{/green-fg} ${sep} ` +
                `{red-fg}${pad(String(s.failedTransactions), txW)}{/red-fg} ${sep} ` +
                running
            );
        });

        const content = [header, divider, ...rows].join('\n');
        this.agentBox.setContent(content);
        this.screen.render();
    }

    private actionColor(type: string): string {
        switch (type) {
            case 'TRANSFER_SUCCESS': return 'green';
            case 'TRANSFER_ATTEMPT': return 'yellow';
            case 'TRANSFER_ERROR': return 'red';
            case 'INSUFFICIENT_FUNDS': return 'magenta';
            case 'BALANCE_CHECK': return 'cyan';
            case 'INITIALIZED': return 'blue';
            case 'STOPPED': return 'grey';
            default: return 'white';
        }
    }

    private formatDetails(action: AgentAction): string {
        const d = action.details;
        switch (action.actionType) {
            case 'BALANCE_CHECK':
                return `balance={bold}${Number(d.balanceSOL ?? 0).toFixed(6)}{/bold} SOL`;
            case 'TRANSFER_ATTEMPT':
                return `→ {white-fg}${String(d.to ?? '').slice(0, 12)}…{/white-fg} {bold}${Number(d.lamports)}lam{/bold}`;
            case 'TRANSFER_SUCCESS':
                return `→ {white-fg}${String(d.to ?? '').slice(0, 12)}…{/white-fg} sig={bold}{green-fg}${String(d.signature ?? '').slice(0, 16)}…{/green-fg}{/bold}`;
            case 'TRANSFER_ERROR':
                return `{red-fg}${String(d.error ?? '').slice(0, 60)}{/red-fg}`;
            case 'INSUFFICIENT_FUNDS':
                return `balance={bold}${Number(d.balance ?? 0)}{/bold}lam required={bold}${Number(d.required ?? 0)}{/bold}lam`;
            case 'INITIALIZED':
                return `key={white-fg}${String(d.publicKey ?? '').slice(0, 20)}…{/white-fg}`;
            default:
                return '';
        }
    }
}
