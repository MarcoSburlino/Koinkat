import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bot, CircleAlert, Copy, RefreshCw } from 'lucide-react';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { UPPERCASE_LABEL } from '../../lib/label-styles';
import { useAssistantStore } from '../../stores/assistant-store';
import { requireActiveKoinkatAccountId } from '../../lib/active-koinkat-account';
import { deleteAllConversations } from '../../services/assistant-service';
import { getLocalApiKey, setLocalApiKey } from '../../assistant/secrets';
import { runCollect, type AssistantEnvironment } from '../../assistant/environment';
import { scopeName } from '../../assistant/programs';
import { registerArgs, mcpServerJsonForOtherClients, type McpLaunch } from '../../assistant/commands';

/**
 * Settings > AI assistant, in two parts:
 *
 * 1. Ask in Koinkat: the in-app chat, answered by a model on THIS
 *    computer (Ollama, LM Studio, llama.cpp). OFF until the user confirms
 *    the notice; the service refuses to turn it on without `consented_at`.
 * 2. Use from your own AI app: add Koinkat's read-only MCP server to the
 *    user's own Claude Code / Codex, or copy the entry for any MCP client.
 *    Those chats happen in that app, under the user's own account.
 *
 * Koinkat never chats through Claude Code or Codex itself: Anthropic and
 * OpenAI do not allow third-party apps to route requests through a
 * user's subscription.
 */
/**
 * Embedded = inside a Settings section, which already draws the frame and
 * the "AI assistant" heading. Module-level (not defined inside the card)
 * so React keeps the same component between renders and inputs keep focus.
 */
function Frame({ embedded, children }: { embedded: boolean; children: ReactNode }) {
  return embedded ? <div className="p-5">{children}</div> : <Card className="mt-6">{children}</Card>;
}

const TITLE = { color: 'var(--text)', fontSize: 'var(--fs-body)', fontWeight: 'var(--fw-medium)' } as const;
const HELP = { color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' } as const;

export function AssistantSettingsCard({ embedded = false }: { embedded?: boolean } = {}) {
  const { settings, env, detecting, save, detect } = useAssistantStore();
  const [consentOpen, setConsentOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [localUrl, setLocalUrl] = useState('');
  const [localModel, setLocalModel] = useState('');
  const [localKey, setLocalKey] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [registerFor, setRegisterFor] = useState<'claude' | 'codex' | null>(null);

  // Node, Claude Code and Codex are needed by both parts.
  useEffect(() => {
    if (settings) void detect();
  }, [settings, detect]);

  useEffect(() => {
    if (!settings) return;
    setLocalUrl(settings.localBaseUrl ?? '');
    setLocalModel(settings.model ?? '');
  }, [settings]);

  const enabled = settings?.enabled ?? false;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getLocalApiKey(requireActiveKoinkatAccountId()).then((k) => {
      if (!cancelled) setLocalKey(k ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!settings) return null;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const launch = (): McpLaunch | null =>
    env?.node
      ? { nodePath: env.node.path, bundlePath: env.bundlePath, dbPath: env.dbPath, workspaceId: requireActiveKoinkatAccountId() }
      : null;

  return (
    <Frame embedded={embedded}>
      {!embedded && (
        <p className="uppercase mb-3" style={UPPERCASE_LABEL}>
          AI assistant
        </p>
      )}

      {/* ── 1. Ask in Koinkat (local model) ─────────────────────────── */}
      <section aria-labelledby="kk-ai-local">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-[240px] max-w-2xl">
            <p id="kk-ai-local" style={TITLE}>
              Ask in Koinkat
            </p>
            {enabled ? (
              <p className="mt-0.5" style={HELP}>
                On for this workspace · answered by a model on this computer · read-only ·{' '}
                <Link to="/assistant" style={{ color: 'var(--nav-active-fg)' }}>
                  open the assistant
                </Link>
              </p>
            ) : (
              <p className="mt-0.5" style={HELP}>
                Chat about your money inside Koinkat, answered by a model running on this computer
                (Ollama, LM Studio or llama.cpp). Nothing leaves it. Off until you turn it on.
              </p>
            )}
          </div>
          {!enabled && (
            <Button variant="secondary" onClick={() => setConsentOpen(true)}>
              <Bot size={16} /> Set up
            </Button>
          )}
        </div>

        {enabled && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-2">
            <Input
              label="Address"
              placeholder="http://127.0.0.1:11434/v1"
              value={localUrl}
              onChange={(e) => setLocalUrl(e.target.value)}
              helpText="Ollama 11434, LM Studio 1234, llama.cpp 8080 (end with /v1)"
            />
            <Input label="Model" placeholder="qwen3:8b" value={localModel} onChange={(e) => setLocalModel(e.target.value)} helpText="Must support tool calling" />
            <Input
              label="API key (optional)"
              type="password"
              value={localKey}
              onChange={(e) => setLocalKey(e.target.value)}
              helpText="Kept in your system keychain"
            />
            <div className="md:col-span-3 flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={busy !== null}
                onClick={() =>
                  run('local-save', async () => {
                    await save({ engine: 'local', localBaseUrl: localUrl, model: localModel });
                    await setLocalApiKey(requireActiveKoinkatAccountId(), localKey || null);
                    setNotice('Saved.');
                  })
                }
              >
                Save
              </Button>
              <Button
                variant="secondary"
                disabled={busy !== null || !localUrl}
                onClick={() =>
                  run('local-test', async () => {
                    const base = localUrl.trim().replace(/\/+$/, '');
                    const res = await tauriFetch(`${base}/models`, {
                      headers: localKey ? { Authorization: `Bearer ${localKey}` } : {},
                    });
                    if (!res.ok) throw new Error(`The model server answered ${res.status}.`);
                    const body = (await res.json()) as { data?: { id: string }[] };
                    const ids = (body.data ?? []).map((m) => m.id);
                    setNotice(ids.length ? `Connected. Models: ${ids.slice(0, 6).join(', ')}` : 'Connected.');
                  })
                }
              >
                Test connection
              </Button>
            </div>
          </div>
        )}
      </section>

      <NodeNotice env={env} detecting={detecting} onCheck={() => void detect(true)} />

      {/* ── 2. Use from your own AI app ────────────────────────────── */}
      <section aria-labelledby="kk-ai-own" className="pt-4 mt-4" style={{ borderTop: '1px solid var(--border)' }}>
        <p id="kk-ai-own" style={TITLE}>
          Use from your own AI app
        </p>
        <p className="mt-0.5 mb-3" style={HELP}>
          Add Koinkat's read-only data server to Claude Code, Codex or another app that supports MCP,
          and ask about this workspace there. Those chats happen in that app, under your own account
          and its terms, and are not saved in Koinkat.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled={!env?.claude || !env?.node || busy !== null} onClick={() => setRegisterFor('claude')}>
            Connect Claude Code
          </Button>
          <Button variant="secondary" disabled={!env?.codex || !env?.node || busy !== null} onClick={() => setRegisterFor('codex')}>
            Connect Codex
          </Button>
          <Button
            variant="ghost"
            disabled={!env?.node}
            onClick={() =>
              run('copy', async () => {
                const l = launch();
                if (!l) return;
                await navigator.clipboard.writeText(mcpServerJsonForOtherClients(l));
                setNotice('Copied. Paste it into the MCP settings of your app.');
              })
            }
          >
            <Copy size={14} /> Copy setup for other apps
          </Button>
          <Button variant="ghost" className="ml-auto" onClick={() => void detect(true)} disabled={detecting}>
            <RefreshCw size={14} className={detecting ? 'animate-spin' : ''} /> Check again
          </Button>
        </div>
        {env && (
          <p className="mt-2" style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-rate)' }}>
            {programStatus('Claude Code', env.claude)} · {programStatus('Codex', env.codex)}
          </p>
        )}
      </section>

      {(error || notice) && (
        <p className="mt-4" role="status" style={{ color: error ? 'var(--danger)' : 'var(--text-secondary)', fontSize: 'var(--fs-body-sm)' }}>
          {error ?? notice}
        </p>
      )}

      {enabled && (
        <div className="flex flex-wrap gap-2 pt-4 mt-4" style={{ borderTop: '1px solid var(--border)' }}>
          {confirmClear ? (
            <>
              <Button
                variant="danger"
                onClick={() =>
                  run('clear', async () => {
                    await deleteAllConversations();
                    setConfirmClear(false);
                    setNotice('All chats in this workspace were deleted.');
                  })
                }
              >
                Delete all chats
              </Button>
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmClear(true)}>
              Delete all chats...
            </Button>
          )}
          <Button variant="ghost" className="ml-auto" onClick={() => run('disable', async () => void (await save({ enabled: false })))}>
            Turn off chat in Koinkat
          </Button>
        </div>
      )}

      <ConsentModal
        open={consentOpen}
        understood={understood}
        setUnderstood={setUnderstood}
        error={error}
        onCancel={() => {
          setConsentOpen(false);
          setUnderstood(false);
        }}
        onConfirm={() =>
          run('enable', async () => {
            await save({ enabled: true, engine: 'local', consentedAt: new Date().toISOString() });
            setConsentOpen(false);
            setUnderstood(false);
          })
        }
      />

      <RegisterModal
        kind={registerFor}
        busy={busy === 'register'}
        onCancel={() => setRegisterFor(null)}
        onConfirm={() =>
          run('register', async () => {
            const kind = registerFor;
            const program = kind === 'claude' ? env?.claude : env?.codex;
            const l = launch();
            if (!kind || !program || !l) return;
            // Replace an older registration (e.g. another workspace) first.
            await runCollect(scopeName(kind, program.index, 'mcp-remove'), kind === 'claude' ? ['mcp', 'remove', 'koinkat', '--scope', 'user'] : ['mcp', 'remove', 'koinkat']);
            const r = await runCollect(scopeName(kind, program.index, 'mcp-add'), registerArgs(kind, l));
            if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ') || 'Registration failed.');
            setRegisterFor(null);
            setNotice(
              kind === 'claude'
                ? 'Connected. In Claude Code, type /mcp to see "koinkat". Remove it with: claude mcp remove koinkat --scope user'
                : 'Connected. In Codex, type /mcp to see "koinkat". Remove it with: codex mcp remove koinkat',
            );
          })
        }
      />
    </Frame>
  );
}

function programStatus(name: string, program: AssistantEnvironment['claude']): string {
  return program ? `${name} found (${program.version.replace(/\s*\(.*\)$/, '')})` : `${name} not found`;
}

/** Both parts need Node to run the data server. */
function NodeNotice({ env, detecting, onCheck }: { env: AssistantEnvironment | null; detecting: boolean; onCheck: () => void }) {
  if (!env || env.node) return null;
  return (
    <div className="flex items-start gap-2 mt-4" style={{ color: 'var(--warning)', fontSize: 'var(--fs-body-sm)' }}>
      <CircleAlert size={16} className="mt-0.5 shrink-0" />
      <span>
        Node.js 22.13 or newer is needed to read your data for an AI
        {env.nodeTooOld ? ` (found ${env.nodeTooOld})` : ''}. Install it from nodejs.org, then{' '}
        <button type="button" className="kk-text-action" disabled={detecting} onClick={onCheck}>
          check again
        </button>
        .
      </span>
    </div>
  );
}

function ConsentModal({
  open,
  understood,
  setUnderstood,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  understood: boolean;
  setUnderstood: (v: boolean) => void;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const points: [string, string][] = [
    ['What it reads', 'Only this workspace: balances, transactions (with notes and merchant names), categories, budgets. Never bank logins or keys.'],
    ['Where it goes', 'Only to the model server at the address you set, which must be on this computer (localhost). Nothing is sent over the internet.'],
    ['What it can do', 'Read and calculate. It cannot change, delete or move anything in Koinkat.'],
    ['Where chats are kept', 'In this workspace on this device, and in your backups. You can delete them at any time.'],
  ];
  return (
    <Modal open={open} onClose={onCancel} title="Turn on chat in Koinkat?" size="lg">
      <div className="flex flex-col gap-3 mt-3 mb-5">
        {points.map(([title, text]) => (
          <div key={title} className="grid grid-cols-[150px_1fr] gap-3">
            <span style={{ color: 'var(--text)', fontWeight: 'var(--fw-semibold)', fontSize: 'var(--fs-body-sm)' }}>{title}</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-body-sm)' }}>{text}</span>
          </div>
        ))}
      </div>
      <label className="flex items-start gap-2 mb-5 cursor-pointer" style={{ color: 'var(--text)', fontSize: 'var(--fs-body-sm)' }}>
        <input type="checkbox" className="mt-0.5" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
        I understand the assistant can read all of this workspace's financial data.
      </label>
      {error && <p className="mb-3" style={{ color: 'var(--danger)', fontSize: 'var(--fs-body-sm)' }}>{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!understood} onClick={onConfirm}>
          Turn on
        </Button>
      </div>
    </Modal>
  );
}

function RegisterModal({
  kind,
  busy,
  onCancel,
  onConfirm,
}: {
  kind: 'claude' | 'codex' | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const name = kind === 'claude' ? 'Claude Code' : 'Codex';
  const company = kind === 'claude' ? 'Anthropic' : 'OpenAI';
  return (
    <Modal open={kind !== null} onClose={onCancel} title={`Connect ${name}?`}>
      <div className="flex flex-col gap-3 mb-5" style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-body-sm)' }}>
        <p>
          {name} will be able to read this workspace in <strong style={{ color: 'var(--text)' }}>every</strong> session
          where you use it, also outside Koinkat. It can't change anything in Koinkat.
        </p>
        <p>
          When you ask about your money there, your question and the data needed to answer it go
          to {company} under your own account and their privacy terms. {name} keeps its usual
          tools (shell, files) as set up in your {name}.
        </p>
        <p>An earlier "koinkat" entry in {name} is replaced.</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy} onClick={onConfirm}>
          {busy ? 'Connecting...' : `Connect ${name}`}
        </Button>
      </div>
    </Modal>
  );
}
