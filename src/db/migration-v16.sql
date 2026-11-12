-- Migration v16: AI assistant (opt-in, read-only)
--
-- The assistant is OFF until the user turns it on per workspace and
-- confirms the notice about where data goes (`consented_at`). It answers
-- through the user's own Claude Code / Codex CLI or a local
-- OpenAI-compatible endpoint, using the read-only Koinkat MCP server.
--
-- Chats live here, in the workspace, so they are covered by backups,
-- removed with the workspace, and never left behind in a CLI's own
-- session folder. Every row carries `koinkat_account_id`.
--
-- `engine`: 'claude-code' | 'codex' | 'local'. The local endpoint's API
-- key (when it needs one) is NOT stored here: it lives in the OS
-- credential store under `assistant-local-<workspace id>`.

CREATE TABLE IF NOT EXISTS assistant_settings (
    koinkat_account_id TEXT PRIMARY KEY,
    enabled            INTEGER NOT NULL DEFAULT 0,
    engine             TEXT NOT NULL DEFAULT 'claude-code',
    model              TEXT,
    local_base_url     TEXT,
    consented_at       TEXT,
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assistant_conversations (
    id                 TEXT PRIMARY KEY,
    koinkat_account_id TEXT NOT NULL,
    title              TEXT NOT NULL,
    engine             TEXT NOT NULL,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assistant_conversations_workspace
    ON assistant_conversations(koinkat_account_id, updated_at);

CREATE TABLE IF NOT EXISTS assistant_messages (
    id                 TEXT PRIMARY KEY,
    conversation_id    TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
    koinkat_account_id TEXT NOT NULL,
    role               TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content            TEXT NOT NULL,
    tool_calls         TEXT,
    engine             TEXT,
    status             TEXT NOT NULL DEFAULT 'complete',
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assistant_messages_conversation
    ON assistant_messages(conversation_id, created_at);
