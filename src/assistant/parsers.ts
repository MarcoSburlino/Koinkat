/**
 * The event shape a chat turn streams to the UI, and the accumulator that
 * folds those events into the message that gets saved.
 */
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
  /** Text since the last break; the answer when `done` carries none. */
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
