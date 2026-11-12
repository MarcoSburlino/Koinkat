/**
 * Runs one chat turn and streams TurnEvents back. Koinkat starts the
 * read-only MCP server over stdio and runs the tool loop against an
 * OpenAI-compatible endpoint on this computer (Ollama, LM Studio,
 * llama.cpp). Nothing leaves the device.
 *
 * Every run can be stopped and times out, so nothing is left running.
 */
import { Command, type Child } from '@tauri-apps/plugin-shell';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { scopeName } from './programs';
import { nodeMcpArgs, type McpLaunch } from './commands';
import { type TurnEvent } from './parsers';
import { composeChatMessages, systemPrompt } from './prompt';
import { McpClient, type LineTransport } from './mcp-client';
import type { AssistantEnvironment } from './environment';
import type { AssistantMessage } from '../types/models';

const TURN_TIMEOUT_MS = 5 * 60_000;
const LOCAL_MAX_TOOL_ROUNDS = 8;

export interface TurnRequest {
  model: string | null;
  localBaseUrl: string | null;
  localApiKey: string | null;
  env: AssistantEnvironment;
  workspaceId: string;
  currency: string;
  history: AssistantMessage[];
  question: string;
  onEvent: (e: TurnEvent) => void;
}

export interface RunningTurn {
  /** Resolves when the turn ends (done, error, stopped or timed out). */
  finished: Promise<void>;
  stop: () => Promise<void>;
}

function launch(req: TurnRequest): McpLaunch {
  if (!req.env.node) {
    throw new Error('Koinkat needs Node.js 22.13 or newer to read your data for the assistant. Install it, then check again in Settings.');
  }
  return {
    nodePath: req.env.node.path,
    bundlePath: req.env.bundlePath,
    dbPath: req.env.dbPath,
    workspaceId: req.workspaceId,
  };
}

const today = () => new Date().toISOString().slice(0, 10);

export function runTurn(req: TurnRequest): RunningTurn {
  return runLocal(req);
}

// ── Local OpenAI-compatible engine ────────────────────────────────────

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/** Remove reasoning blocks some local models print before the answer. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function runLocal(req: TurnRequest): RunningTurn {
  let child: Child | null = null;
  let client: McpClient | null = null;
  const abort = new AbortController();
  let ended = false;
  let resolveFinished: () => void = () => {};
  const finished = new Promise<void>((r) => (resolveFinished = r));

  const end = (ev: TurnEvent) => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    abort.abort();
    req.onEvent(ev);
    void (client ? client.close() : child?.kill())?.catch(() => {});
    resolveFinished();
  };
  const timer = setTimeout(
    () => end({ type: 'error', message: 'The local model took longer than 5 minutes and was stopped.' }),
    TURN_TIMEOUT_MS,
  );

  (async () => {
    if (!req.localBaseUrl) throw new Error('Set the address of your local model in Settings first.');
    if (!req.model) throw new Error('Set the name of your local model in Settings first.');
    if (!req.env.node) throw new Error('Koinkat needs Node.js 22.13 or newer to read your data for the assistant.');
    const l = launch(req);

    // Start the read-only data server and connect over stdio.
    const lineHandlers: ((line: string) => void)[] = [];
    const cmd = Command.create(scopeName('node', req.env.node.index, 'mcp'), nodeMcpArgs(l), { cwd: req.env.workdir });
    cmd.stdout.on('data', (line) => String(line).split('\n').forEach((x) => x && lineHandlers.forEach((h) => h(x))));
    cmd.on('close', () => {
      if (!ended) end({ type: 'error', message: 'The Koinkat data server stopped unexpectedly.' });
    });
    child = await cmd.spawn();
    const transport: LineTransport = {
      send: (line) => child!.write(line),
      onLine: (h) => lineHandlers.push(h),
      close: () => child!.kill(),
    };
    client = new McpClient(transport);
    await client.initialize();
    const tools = await client.listTools();

    const messages: ChatMessage[] = composeChatMessages(
      systemPrompt(today(), req.currency),
      req.history,
      req.question,
    );
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (req.localApiKey) headers.Authorization = `Bearer ${req.localApiKey}`;

    for (let round = 0; round <= LOCAL_MAX_TOOL_ROUNDS; round++) {
      const res = await tauriFetch(`${req.localBaseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        signal: abort.signal,
        body: JSON.stringify({
          model: req.model,
          messages,
          tools: tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description ?? '', parameters: t.inputSchema },
          })),
          // The last round withholds tools so the model has to answer.
          tool_choice: round === LOCAL_MAX_TOOL_ROUNDS ? 'none' : 'auto',
          stream: false,
        }),
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => '')).slice(0, 300);
        throw new Error(`The local model answered ${res.status}${body ? `: ${body}` : ''}`);
      }
      const data = (await res.json()) as { choices?: { message?: ChatMessage }[] };
      const reply = data.choices?.[0]?.message;
      if (!reply) throw new Error('The local model sent an empty reply.');
      const calls = reply.tool_calls ?? [];
      if (calls.length === 0) {
        const text = stripThinking(reply.content ?? '');
        req.onEvent({ type: 'break' });
        req.onEvent({ type: 'text', delta: text });
        end({ type: 'done', text });
        return;
      }
      messages.push({ role: 'assistant', content: reply.content ?? null, tool_calls: calls });
      for (const call of calls) {
        if (ended) return;
        req.onEvent({ type: 'tool', name: call.function.name });
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          args = {};
        }
        let content: string;
        try {
          const r = await client.callTool(call.function.name, args);
          content = r.text;
        } catch (e) {
          content = `Tool error: ${e instanceof Error ? e.message : String(e)}`;
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content });
      }
    }
    throw new Error('The local model kept calling tools without answering.');
  })().catch((e: unknown) => {
    if (abort.signal.aborted && ended) return;
    end({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  });

  return {
    finished,
    stop: async () => end({ type: 'error', message: 'Stopped.' }),
  };
}
