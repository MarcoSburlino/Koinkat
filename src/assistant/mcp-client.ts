/**
 * Minimal MCP client (JSON-RPC 2.0, newline-delimited, stdio) for the
 * local-model engine, where Koinkat itself runs the tool loop. Only the
 * three calls it needs: initialize, tools/list, tools/call. The transport
 * is injected so the protocol is unit-tested without a process.
 */

export interface LineTransport {
  send(line: string): Promise<void>;
  /** Register the handler for each line the server writes to stdout. */
  onLine(handler: (line: string) => void): void;
  close(): Promise<void>;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

const PROTOCOL_VERSION = '2025-06-18';
const CALL_TIMEOUT_MS = 30_000;

export class McpClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private transport: LineTransport) {
    transport.onLine((line) => this.receive(line));
  }

  private receive(line: string) {
    let msg: { id?: unknown; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(line);
    } catch {
      return; // not a protocol line (the server logs to stderr, not here)
    }
    if (typeof msg.id !== 'number') return; // notifications are ignored
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message ?? 'MCP error'));
    else p.resolve(msg.result);
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The Koinkat data server did not answer ${method} in time.`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.transport
        .send(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
        .catch((e: unknown) => {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(e instanceof Error ? e : new Error(String(e)));
        });
    });
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'koinkat-app', version: '1' },
    });
    await this.transport.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  }

  async listTools(): Promise<McpTool[]> {
    const res = (await this.request('tools/list', {})) as { tools?: McpTool[] };
    return res.tools ?? [];
  }

  /** Returns the tool's text output (what the model reads). */
  async callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const res = (await this.request('tools/call', { name, arguments: args })) as {
      content?: { type: string; text?: string }[];
      isError?: boolean;
    };
    const text = (res.content ?? [])
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n');
    return { text, isError: res.isError === true };
  }

  async close(): Promise<void> {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Closed'));
    }
    this.pending.clear();
    await this.transport.close();
  }
}
