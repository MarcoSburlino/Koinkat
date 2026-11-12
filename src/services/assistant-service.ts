/**
 * Storage for the opt-in AI assistant: per-workspace settings, chats and
 * messages (migration v16). No network, no process spawning here - the
 * engines live in `src/assistant/`. Every query is scoped by
 * `koinkat_account_id` (invariant 3).
 *
 * A chat turn can take a minute while the user switches workspace, so the
 * functions that run at the END of a turn take an explicit workspace id
 * (the one captured when the turn started) instead of re-reading the
 * global: the answer lands in the chat it belongs to, never in whichever
 * workspace happens to be active (invariant 2).
 */
import { getDb, withTransaction } from '../db/database';
import { requireActiveKoinkatAccountId } from '../lib/active-koinkat-account';
import {
  toAssistantSettings,
  toAssistantConversation,
  toAssistantMessage,
  type AssistantSettings,
  type AssistantSettingsRow,
  type AssistantConversation,
  type AssistantConversationRow,
  type AssistantMessage,
  type AssistantMessageRow,
  type AssistantEngine,
  type AssistantMessageRole,
  type AssistantMessageStatus,
} from '../types/models';

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
  enabled: false,
  engine: 'local',
  model: null,
  localBaseUrl: null,
  consentedAt: null,
};

/** Longest title stored for a chat (taken from its first question). */
const TITLE_MAX = 80;

// ── Settings ──────────────────────────────────────────────────────────

export async function getAssistantSettings(): Promise<AssistantSettings> {
  const ws = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<AssistantSettingsRow[]>(
    'SELECT * FROM assistant_settings WHERE koinkat_account_id = ?',
    [ws],
  );
  return rows.length > 0 ? toAssistantSettings(rows[0]) : { ...DEFAULT_ASSISTANT_SETTINGS };
}

/**
 * Save settings. Turning the assistant ON requires a recorded consent: a
 * caller that enables without `consentedAt` (and no earlier consent) is
 * refused, so no code path can switch it on silently.
 */
export async function saveAssistantSettings(
  changes: Partial<AssistantSettings>,
): Promise<AssistantSettings> {
  const ws = requireActiveKoinkatAccountId();
  const current = await getAssistantSettings();
  const next: AssistantSettings = { ...current, ...changes };

  if (next.engine !== 'local') {
    // Only a model on this computer may answer (see AssistantEngine).
    throw new Error(`Unsupported assistant engine: ${String(next.engine)}`);
  }
  if (next.enabled && !next.consentedAt) {
    throw new Error('Confirm the data notice before turning the assistant on.');
  }
  if (next.model !== null) {
    const m = next.model.trim();
    next.model = m === '' ? null : m;
    if (next.model !== null && !/^[A-Za-z0-9][A-Za-z0-9._:/\-[\]]{0,63}$/.test(next.model)) {
      throw new Error('Model names use letters, digits and . _ : / - only.');
    }
  }
  if (next.localBaseUrl !== null) {
    const u = next.localBaseUrl.trim().replace(/\/+$/, '');
    next.localBaseUrl = u === '' ? null : u;
    if (next.localBaseUrl !== null && !isLocalBaseUrl(next.localBaseUrl)) {
      throw new Error(
        'The local model address must be http://localhost or http://127.0.0.1 with a port, e.g. http://127.0.0.1:11434/v1',
      );
    }
  }

  const db = await getDb();
  await db.execute(
    `INSERT INTO assistant_settings
       (koinkat_account_id, enabled, engine, model, local_base_url, consented_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(koinkat_account_id) DO UPDATE SET
       enabled = excluded.enabled,
       engine = excluded.engine,
       model = excluded.model,
       local_base_url = excluded.local_base_url,
       consented_at = excluded.consented_at,
       updated_at = excluded.updated_at`,
    [ws, next.enabled ? 1 : 0, next.engine, next.model, next.localBaseUrl, next.consentedAt],
  );
  return next;
}

/**
 * The local engine may only talk to this computer. The HTTP capability
 * enforces the same rule; checking here gives a readable error first.
 */
export function isLocalBaseUrl(url: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}(\/[A-Za-z0-9._~\-/]*)?$/.test(url);
}

// ── Conversations ─────────────────────────────────────────────────────

export async function listConversations(): Promise<AssistantConversation[]> {
  const ws = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<AssistantConversationRow[]>(
    `SELECT * FROM assistant_conversations
      WHERE koinkat_account_id = ?
      ORDER BY updated_at DESC, created_at DESC`,
    [ws],
  );
  return rows.map(toAssistantConversation);
}

export function titleFromQuestion(question: string): string {
  const oneLine = question.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= TITLE_MAX) return oneLine || 'New chat';
  return oneLine.slice(0, TITLE_MAX - 3).trimEnd() + '...';
}

export async function createConversation(
  firstQuestion: string,
  engine: AssistantEngine,
): Promise<AssistantConversation> {
  const ws = requireActiveKoinkatAccountId();
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.execute(
    `INSERT INTO assistant_conversations (id, koinkat_account_id, title, engine)
     VALUES (?, ?, ?, ?)`,
    [id, ws, titleFromQuestion(firstQuestion), engine],
  );
  const rows = await db.select<AssistantConversationRow[]>(
    'SELECT * FROM assistant_conversations WHERE id = ? AND koinkat_account_id = ?',
    [id, ws],
  );
  return toAssistantConversation(rows[0]);
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const ws = requireActiveKoinkatAccountId();
  const clean = title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  if (!clean) throw new Error('A chat needs a name.');
  const db = await getDb();
  await db.execute(
    'UPDATE assistant_conversations SET title = ? WHERE id = ? AND koinkat_account_id = ?',
    [clean, id, ws],
  );
}

export async function deleteConversation(id: string): Promise<void> {
  const ws = requireActiveKoinkatAccountId();
  await withTransaction(async (tx) => {
    await tx.execute(
      'DELETE FROM assistant_messages WHERE conversation_id = ? AND koinkat_account_id = ?',
      [id, ws],
    );
    await tx.execute(
      'DELETE FROM assistant_conversations WHERE id = ? AND koinkat_account_id = ?',
      [id, ws],
    );
  });
}

/** Delete every chat in the active workspace (Settings > Clear chats). */
export async function deleteAllConversations(): Promise<void> {
  const ws = requireActiveKoinkatAccountId();
  await withTransaction(async (tx) => {
    await tx.execute('DELETE FROM assistant_messages WHERE koinkat_account_id = ?', [ws]);
    await tx.execute('DELETE FROM assistant_conversations WHERE koinkat_account_id = ?', [ws]);
  });
}

// ── Messages ──────────────────────────────────────────────────────────

export async function listMessages(conversationId: string): Promise<AssistantMessage[]> {
  const ws = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<AssistantMessageRow[]>(
    `SELECT * FROM assistant_messages
      WHERE conversation_id = ? AND koinkat_account_id = ?
      ORDER BY created_at ASC, rowid ASC`,
    [conversationId, ws],
  );
  return rows.map(toAssistantMessage);
}

/**
 * Append a message to a chat of an EXPLICIT workspace (captured at the
 * start of the turn). Refuses when the chat is not in that workspace, so
 * a message can never be attached across workspaces.
 */
export async function appendMessage(
  workspaceId: string,
  conversationId: string,
  message: {
    role: AssistantMessageRole;
    content: string;
    toolCalls?: string[];
    engine?: AssistantEngine | null;
    status?: AssistantMessageStatus;
  },
): Promise<AssistantMessage> {
  const id = crypto.randomUUID();
  let row: AssistantMessageRow | undefined;
  await withTransaction(async (tx) => {
    const owner = await tx.select<{ id: string }[]>(
      'SELECT id FROM assistant_conversations WHERE id = ? AND koinkat_account_id = ?',
      [conversationId, workspaceId],
    );
    if (owner.length === 0) throw new Error('That chat no longer exists.');
    await tx.execute(
      `INSERT INTO assistant_messages
         (id, conversation_id, koinkat_account_id, role, content, tool_calls, engine, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        conversationId,
        workspaceId,
        message.role,
        message.content,
        message.toolCalls && message.toolCalls.length > 0 ? JSON.stringify(message.toolCalls) : null,
        message.engine ?? null,
        message.status ?? 'complete',
      ],
    );
    await tx.execute(
      `UPDATE assistant_conversations SET updated_at = datetime('now')
        WHERE id = ? AND koinkat_account_id = ?`,
      [conversationId, workspaceId],
    );
    const rows = await tx.select<AssistantMessageRow[]>(
      'SELECT * FROM assistant_messages WHERE id = ?',
      [id],
    );
    row = rows[0];
  });
  if (!row) throw new Error('Could not save the message.');
  return toAssistantMessage(row);
}
