/**
 * Turn each engine's line-delimited output into one event shape the UI
 * understands. Pure: one line in, zero or more events out.
 *
 * Shapes observed 2026-11-12 (Claude Code 2.1.322 `--output-format
 * stream-json --verbose --include-partial-messages`; codex-cli 0.167.2
 * `exec --json`).
 */
import { shortToolName } from './prompt';

export type TurnEvent =
  /** Streamed answer text to append. */
  | { type: 'text'; delta: string }
  /** A new paragraph starts (between tool calls). */
  | { type: 'break' }
  /** The assistant called a Koinkat tool. */
  | { type: 'tool'; name: string }
  /** The turn finished. `text` is the clean final answer when the engine gives one. */
  | { type: 'done'; text: string | null }
  | { type: 'error'; message: string };

function parse(line: string): Record<string, unknown> | null {
  const t = line.trim();
  if (!t.startsWith('{')) return null;
  try {
    const v: unknown = JSON.parse(t);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

export function parseClaudeLine(line: string): TurnEvent[] {
  const j = parse(line);
  if (!j) return [];
  switch (j.type) {
    case 'stream_event': {
      const ev = obj(j.event);
      if (ev.type === 'content_block_start' && obj(ev.content_block).type === 'text') {
        return [{ type: 'break' }];
      }
      if (ev.type === 'content_block_delta') {
        const d = obj(ev.delta);
        if (d.type === 'text_delta' && typeof d.text === 'string') return [{ type: 'text', delta: d.text }];
      }
      return [];
    }
    case 'assistant': {
      const content = obj(j.message).content;
      if (!Array.isArray(content)) return [];
      return content
        .map(obj)
        .filter((c) => c.type === 'tool_use' && typeof c.name === 'string')
        .map((c) => ({ type: 'tool' as const, name: shortToolName(c.name as string) }));
    }
    case 'result': {
      if (j.is_error === true || (typeof j.subtype === 'string' && j.subtype.startsWith('error'))) {
        const msg = typeof j.result === 'string' && j.result ? j.result : String(j.subtype ?? 'error');
        return [{ type: 'error', message: msg }];
      }
      return [{ type: 'done', text: typeof j.result === 'string' ? j.result : null }];
    }
    default:
      return [];
  }
}

export function parseCodexLine(line: string): TurnEvent[] {
  const j = parse(line);
  if (!j) return [];
  const item = obj(j.item);
  switch (j.type) {
    case 'item.started':
      if (item.type === 'mcp_tool_call' && typeof item.tool === 'string') {
        return [{ type: 'tool', name: item.tool }];
      }
      return [];
    case 'item.completed':
      if (item.type === 'agent_message' && typeof item.text === 'string') {
        return [{ type: 'break' }, { type: 'text', delta: item.text }];
      }
      return [];
    case 'turn.completed':
      return [{ type: 'done', text: null }];
    case 'turn.failed': {
      const err = obj(j.error);
      return [{ type: 'error', message: typeof err.message === 'string' ? err.message : 'Codex could not finish.' }];
    }
    case 'error':
      return [{ type: 'error', message: typeof j.message === 'string' ? j.message : 'Codex reported an error.' }];
    default:
      return [];
  }
}

/**
 * Fold events into what the chat shows. Tool calls are kept in order;
 * `final` (from the engine's done event) replaces the streamed text when
 * present, so narration like "Let me check..." does not end up saved.
 */
export class TurnAccumulator {
  text = '';
  tools: string[] = [];
  final: string | null = null;
  error: string | null = null;
  done = false;
  /** Codex sends whole messages; the last one is the answer. */
  private lastBlock = '';

  apply(ev: TurnEvent): void {
    switch (ev.type) {
      case 'break':
        if (this.text.trim() !== '') this.text += '\n\n';
        this.lastBlock = '';
        break;
      case 'text':
        this.text += ev.delta;
        this.lastBlock += ev.delta;
        break;
      case 'tool':
        this.tools.push(ev.name);
        break;
      case 'done':
        this.done = true;
        this.final = ev.text ?? (this.lastBlock.trim() || null);
        break;
      case 'error':
        this.done = true;
        this.error = ev.message;
        break;
    }
  }

  /** The answer to save: the engine's clean final text, else everything streamed. */
  answer(): string {
    return (this.final ?? this.text).trim();
  }
}
