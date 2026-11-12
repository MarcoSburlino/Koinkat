import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Check, CircleAlert, Copy, Cpu, RefreshCw, Sparkles, Terminal } from 'lucide-react';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Modal } from '../ui/Modal';
import { UPPERCASE_LABEL } from '../../lib/label-styles';
import { useAssistantStore } from '../../stores/assistant-store';
import { requireActiveKoinkatAccountId } from '../../lib/active-koinkat-account';
import { deleteAllConversations } from '../../services/assistant-service';
import { getLocalApiKey, setLocalApiKey } from '../../assistant/secrets';
import { runCollect } from '../../assistant/environment';
import { scopeName } from '../../assistant/programs';
import { registerArgs, mcpServerJsonForOtherClients, DEFAULT_CLAUDE_MODEL, type McpLaunch } from '../../assistant/commands';
import type { AssistantEngine } from '../../types/models';

const ENGINE_INFO: Record<AssistantEngine, { name: string; detail: string; icon: typeof Bot }> = {
  'claude-code': {
    name: 'Claude Code',
    detail: 'Uses your Claude subscription. Questions and the data they need go to Anthropic.',
    icon: Sparkles,
  },
  codex: {
    name: 'Codex',
    detail: 'Uses your ChatGPT / Codex plan. Questions and the data they need go to OpenAI.',
    icon: Terminal,
  },
  local: {
    name: 'Local model',
    detail: 'Ollama, LM Studio or a llama.cpp server on this computer. Nothing leaves it.',
    icon: Cpu,
  },
};

const CLAUDE_MODELS = [
  { value: 'sonnet', label: 'Sonnet (balanced)' },
  { value: 'opus', label: 'Opus (most capable)' },
  { value: 'haiku', label: 'Haiku (fastest)' },
];

/**
 * Settings > AI assistant. OFF until the user reads and confirms where
 * their data goes; the confirmation is stored (`consented_at`) and the
 * service refuses to turn the assistant on without it.
 */
export function AssistantSettingsCard() {
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

  useEffect(() => {
    if (settings?.enabled) void detect();
  }, [settings?.enabled, detect]);

  useEffect(() => {
    if (!settings) return;
    setLocalUrl(settings.localBaseUrl ?? '');
    setLocalModel(settings.engine === 'local' ? settings.model ?? '' : '');
  }, [settings]);

  useEffect(() => {
    if (settings?.engine !== 'local') return;
    let cancelled = false;
    getLocalApiKey(requireActiveKoinkatAccountId()).then((k) => {
      if (!cancelled) setLocalKey(k ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [settings?.engine]);

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

  // ── Off: one clear explanation and a single way in ─────────────────
  if (!settings.enabled) {
    return (
      <Card className="mt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="uppercase mb-2" style={UPPERCASE_LABEL}>
              AI assistant
            </p>
            <p style={{ color: 'var(--text)', fontSize: 'var(--fs-body)' }}>
              Ask questions about your money in plain language: "how much did I spend on food in
              October?", "am I on track this month?".
            </p>
            <p className="mt-1" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
              Uses your own Claude Code or Codex subscription, or a model running on this computer.
              Off until you turn it on. Read-only: it can't change anything.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setConsentOpen(true)}>
            <Bot size={16} /> Set up the assistant
          </Button>
        </div>
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
              await save({ enabled: true, consentedAt: new Date().toISOString() });
              setConsentOpen(false);
              setUnderstood(false);
            })
          }
        />
      </Card>
    );
  }

  // ── On: engine, model, connections ─────────────────────────────────
  const engine = settings.engine;
  const found = env ? { 'claude-code': env.claude, codex: env.codex, local: null } : null;

  return (
    <Card className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <p className="uppercase" style={UPPERCASE_LABEL}>
            AI assistant
          </p>
          <p className="mt-1" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
            On for this workspace · read-only ·{' '}
            <Link to="/assistant" style={{ color: 'var(--nav-active-fg)' }}>
              open the assistant
            </Link>
          </p>
        </div>
        <Button variant="ghost" onClick={() => void detect(true)} disabled={detecting}>
          <RefreshCw size={14} className={detecting ? 'animate-spin' : ''} /> Check again
        </Button>
      </div>

      {/* Engine choice */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5" role="radiogroup" aria-label="Who answers">
        {(Object.keys(ENGINE_INFO) as AssistantEngine[]).map((key) => {
          const info = ENGINE_INFO[key];
          const Icon = info.icon;
          const selected = engine === key;
          const program = found?.[key];
          const status =
            key === 'local'
              ? 'Needs an address below'
              : !env
                ? 'Checking...'
                : program
                  ? `Found · ${program.version.replace(/\s*\(.*\)$/, '')}`
                  : 'Not found on this computer';
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => run('engine', async () => void (await save({ engine: key, model: key === 'claude-code' ? DEFAULT_CLAUDE_MODEL : null })))}
              className="text-left p-4 rounded-lg transition-colors cursor-pointer"
              style={{
                border: `1px solid ${selected ? 'var(--primary)' : 'var(--border)'}`,
                backgroundColor: selected ? 'var(--nav-active-bg)' : 'var(--surface)',
              }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <Icon size={16} style={{ color: selected ? 'var(--nav-active-fg)' : 'var(--text-secondary)' }} />
                <span style={{ color: 'var(--text)', fontWeight: 'var(--fw-semibold)', fontSize: 'var(--fs-body)' }}>{info.name}</span>
                {selected && <Check size={14} className="ml-auto" style={{ color: 'var(--nav-active-fg)' }} />}
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>{info.detail}</p>
              <p
                className="mt-2"
                style={{
                  fontSize: 'var(--fs-rate)',
                  color: key !== 'local' && env && !program ? 'var(--warning)' : 'var(--text-secondary)',
                }}
              >
                {status}
              </p>
            </button>
          );
        })}
      </div>

      {/* Engine specifics */}
      {engine === 'claude-code' && (
        <div className="max-w-sm mb-5">
          <Select
            label="Model"
            options={CLAUDE_MODELS}
            value={settings.model ?? DEFAULT_CLAUDE_MODEL}
            onChange={(e) => run('model', async () => void (await save({ model: e.target.value })))}
          />
        </div>
      )}
      {engine === 'codex' && (
        <p className="mb-5" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
          Uses your Codex default model. Koinkat starts Codex with its shell, browser and file tools
          switched off, so it can only use Koinkat's read-only data tools.
        </p>
      )}
      {engine === 'local' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
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
                  await save({ localBaseUrl: localUrl, model: localModel });
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

      {/* Requirement: Node runs the read-only data server */}
      {env && !env.node && (
        <div className="flex items-start gap-2 mb-5" style={{ color: 'var(--warning)', fontSize: 'var(--fs-body-sm)' }}>
          <CircleAlert size={16} className="mt-0.5 shrink-0" />
          <span>
            Node.js 22.13 or newer is needed to read your data for the assistant
            {env.nodeTooOld ? ` (found ${env.nodeTooOld})` : ''}. Install it from nodejs.org, then
            press "Check again".
          </span>
        </div>
      )}

      {/* Use Koinkat from your own CLI too */}
      <div className="pt-4 mb-4" style={{ borderTop: '1px solid var(--border)' }}>
        <p className="mb-1" style={{ color: 'var(--text)', fontSize: 'var(--fs-body)', fontWeight: 'var(--fw-medium)' }}>
          Use this workspace in your own Claude Code or Codex
        </p>
        <p className="mb-3" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
          Adds Koinkat's read-only data server to the app you already use, so you can ask about
          your money in any session there. Those chats stay in that app, not in Koinkat.
        </p>
        <div className="flex flex-wrap gap-2">
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
                setNotice('Copied an MCP server entry for other apps.');
              })
            }
          >
            <Copy size={14} /> Copy setup for other apps
          </Button>
        </div>
      </div>

      {(error || notice) && (
        <p className="mb-3" style={{ color: error ? 'var(--danger)' : 'var(--text-secondary)', fontSize: 'var(--fs-body-sm)' }}>
          {error ?? notice}
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
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
          Turn the assistant off
        </Button>
      </div>

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
    </Card>
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
    ['Where it goes', 'With Claude Code or Codex, your question and the data needed to answer it go to Anthropic or OpenAI, under your own account and their privacy terms. With a local model, nothing leaves this computer.'],
    ['What it can do', 'Read and calculate. It cannot change, delete or move anything in Koinkat.'],
    ['Where chats are kept', 'In this workspace on this device, and in your backups. You can delete them at any time.'],
  ];
  return (
    <Modal open={open} onClose={onCancel} title="Turn on the AI assistant?" size="lg">
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
        I understand that with Claude Code or Codex my financial data is sent to that company to answer my questions.
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
  return (
    <Modal open={kind !== null} onClose={onCancel} title={`Connect ${name}?`}>
      <div className="flex flex-col gap-3 mb-5" style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-body-sm)' }}>
        <p>
          {name} will be able to read this workspace in <strong style={{ color: 'var(--text)' }}>every</strong> session
          where you use it, also outside Koinkat. It stays read-only.
        </p>
        <p>
          Inside {name} the model may also have its usual tools (shell, files). Koinkat's own
          Assistant page runs it with those switched off; your own sessions follow your {name}{' '}
          settings.
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
