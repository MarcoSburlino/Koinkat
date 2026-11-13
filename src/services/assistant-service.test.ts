/**
 * Assistant storage against the real schema (migration v16): workspace
 * isolation, the consent gate on turning the assistant on, the
 * explicit-workspace append used at the end of a chat turn, and removal
 * with the workspace.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb, type Harness } from '../test/sqlite-harness';

let db: Harness;
let active = 'ws-1';

vi.mock('../db/database', () => ({
  getDb: vi.fn(async () => db),
  withTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => db.transaction(fn as never)),
}));

vi.mock('../lib/active-koinkat-account', () => ({
  requireActiveKoinkatAccountId: vi.fn(() => active),
  getActiveKoinkatAccountId: vi.fn(() => active),
  captureWorkspace: vi.fn(() => ({ id: active, assertUnchanged: () => {} })),
}));

vi.mock('./api-config-service', () => ({
  deletePemSecret: vi.fn(async () => {}),
}));

import {
  getAssistantSettings,
  saveAssistantSettings,
  createConversation,
  listConversations,
  listMessages,
  appendMessage,
  deleteConversation,
  renameConversation,
  titleFromQuestion,
  isLocalBaseUrl,
} from './assistant-service';
import { deleteKoinkatAccount } from './koinkat-account-service';

async function seedWorkspaces() {
  await db.execute(`INSERT INTO users (id, name) VALUES ('u1', 'Test')`);
  for (const ws of ['ws-1', 'ws-2']) {
    await db.execute(
      `INSERT INTO koinkat_accounts (id, user_id, name, connection_type, preferred_currency)
       VALUES (?, 'u1', ?, 'manual', 'EUR')`,
      [ws, ws],
    );
  }
}

beforeEach(async () => {
  db = createTestDb();
  active = 'ws-1';
  await seedWorkspaces();
});

afterEach(() => db.close());

describe('assistant settings', () => {
  it('defaults to off, with no consent', async () => {
    const s = await getAssistantSettings();
    expect(s.enabled).toBe(false);
    expect(s.consentedAt).toBeNull();
  });

  it('refuses to turn on without a recorded consent', async () => {
    await expect(saveAssistantSettings({ enabled: true })).rejects.toThrow(/data notice/);
    expect((await getAssistantSettings()).enabled).toBe(false);
  });

  it('turns on with consent and keeps it per workspace', async () => {
    await saveAssistantSettings({ enabled: true, consentedAt: '2026-11-12T10:00:00Z', engine: 'local', localBaseUrl: 'http://127.0.0.1:11434/v1/' });
    const s = await getAssistantSettings();
    expect(s).toMatchObject({ enabled: true, engine: 'local', localBaseUrl: 'http://127.0.0.1:11434/v1' });
    active = 'ws-2';
    expect((await getAssistantSettings()).enabled).toBe(false);
  });

  it('only accepts local addresses for the local engine', async () => {
    await expect(saveAssistantSettings({ localBaseUrl: 'https://api.example.com/v1' })).rejects.toThrow(/localhost/);
    expect(isLocalBaseUrl('http://localhost:1234/v1')).toBe(true);
    expect(isLocalBaseUrl('http://127.0.0.1:8081/v1')).toBe(true);
    expect(isLocalBaseUrl('http://127.0.0.1.evil.com:80/v1')).toBe(false);
    expect(isLocalBaseUrl('http://localhost@evil.com:80')).toBe(false);
  });

  it('rejects model names that could read as flags', async () => {
    await expect(saveAssistantSettings({ model: '--dangerously-skip-permissions' })).rejects.toThrow(/Model names/);
    await saveAssistantSettings({ model: 'qwen3:8b' });
    expect((await getAssistantSettings()).model).toBe('qwen3:8b');
  });

  it('only a local model answers: older Claude Code / Codex settings read as local', async () => {
    await db.execute(
      `INSERT INTO assistant_settings (koinkat_account_id, enabled, engine, model, consented_at, updated_at)
       VALUES ('ws-1', 1, 'claude-code', 'sonnet', '2026-11-12T10:00:00Z', datetime('now'))`,
    );
    // The Claude model name must not leak into the local engine.
    expect(await getAssistantSettings()).toMatchObject({ enabled: true, engine: 'local', model: null });
    await expect(saveAssistantSettings({ engine: 'codex' })).rejects.toThrow(/Unsupported/);
    await expect(saveAssistantSettings({ engine: 'claude-code' })).rejects.toThrow(/Unsupported/);
  });
});

describe('assistant chats', () => {
  it('lists only the active workspace chats', async () => {
    await createConversation('How much on food?', 'local');
    active = 'ws-2';
    await createConversation('Other workspace question', 'local');
    expect((await listConversations()).map((c) => c.title)).toEqual(['Other workspace question']);
    active = 'ws-1';
    expect((await listConversations()).map((c) => c.title)).toEqual(['How much on food?']);
  });

  it('appends to the captured workspace even after a switch', async () => {
    const chat = await createConversation('Question', 'local');
    await appendMessage('ws-1', chat.id, { role: 'user', content: 'Question' });
    active = 'ws-2'; // user switched while the answer streamed
    await appendMessage('ws-1', chat.id, { role: 'assistant', content: 'Answer', toolCalls: ['summarize_transactions'], engine: 'local' });
    active = 'ws-1';
    const msgs = await listMessages(chat.id);
    expect(msgs.map((m) => [m.role, m.content])).toEqual([['user', 'Question'], ['assistant', 'Answer']]);
    expect(msgs[1].toolCalls).toEqual(['summarize_transactions']);
  });

  it('never attaches a message to another workspace chat', async () => {
    const chat = await createConversation('Mine', 'local');
    await expect(appendMessage('ws-2', chat.id, { role: 'user', content: 'x' })).rejects.toThrow(/no longer exists/);
    expect(await listMessages(chat.id)).toHaveLength(0);
  });

  it('renames and deletes within the workspace only', async () => {
    const chat = await createConversation('Old', 'local');
    active = 'ws-2';
    await renameConversation(chat.id, 'Hijacked');
    await deleteConversation(chat.id);
    active = 'ws-1';
    expect((await listConversations())[0].title).toBe('Old');
    await renameConversation(chat.id, '  New   name ');
    expect((await listConversations())[0].title).toBe('New name');
    await appendMessage('ws-1', chat.id, { role: 'user', content: 'q' });
    await deleteConversation(chat.id);
    expect(await listConversations()).toHaveLength(0);
    const left = await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM assistant_messages');
    expect(left[0].n).toBe(0);
  });

  it('titles a chat from its first question', () => {
    expect(titleFromQuestion('  How much\n did I spend? ')).toBe('How much did I spend?');
    expect(titleFromQuestion('x'.repeat(200))).toHaveLength(80);
  });

  it('goes away with its workspace', async () => {
    await saveAssistantSettings({ enabled: true, consentedAt: '2026-11-12T10:00:00Z' });
    const chat = await createConversation('Q', 'local');
    await appendMessage('ws-1', chat.id, { role: 'user', content: 'Q' });
    await deleteKoinkatAccount('ws-1');
    for (const table of ['assistant_settings', 'assistant_conversations', 'assistant_messages']) {
      const rows = await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM ${table} WHERE koinkat_account_id = 'ws-1'`);
      expect(rows[0].n).toBe(0);
    }
  });
});
