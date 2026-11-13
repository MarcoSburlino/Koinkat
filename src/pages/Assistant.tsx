import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, CircleAlert, Loader2, MessageSquarePlus, Square, Trash2, Wrench } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useAppStore } from '../stores/app-store';
import { useAssistantStore } from '../stores/assistant-store';
import { captureWorkspace } from '../lib/active-koinkat-account';
import * as assistantService from '../services/assistant-service';
import { runTurn, type RunningTurn } from '../assistant/engines';
import { TurnAccumulator } from '../assistant/parsers';
import { toolLabel } from '../assistant/prompt';
import { getLocalApiKey } from '../assistant/secrets';
import type { AssistantConversation, AssistantMessage } from '../types/models';

const SUGGESTIONS = [
  'How much have I spent this month, and on what?',
  'Am I on track with my budget this month?',
  'What are my recurring costs and what do they add up to per month?',
  'Compare my spending this month with last month.',
];

interface LiveTurn {
  conversationId: string;
  question: string;
  text: string;
  tools: string[];
}

export function Assistant() {
  const settings = useAppStore((s) => s.settings);
  const { settings: aSettings, env, detect } = useAssistantStore();
  const [chats, setChats] = useState<AssistantConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const turnRef = useRef<RunningTurn | null>(null);
  const stopRequested = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const reloadChats = useCallback(async () => {
    setChats(await assistantService.listConversations());
  }, []);

  useEffect(() => {
    void reloadChats();
    void detect();
  }, [reloadChats, detect]);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    assistantService.listMessages(activeId).then((m) => {
      if (!cancelled) setMessages(m);
    });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  // Keep the newest content in view while an answer streams in.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, live?.text, live?.tools.length]);

  // Stop a running turn when leaving the page; it is saved as "stopped".
  useEffect(
    () => () => {
      if (turnRef.current) {
        stopRequested.current = true;
        void turnRef.current.stop();
      }
    },
    [],
  );

  const busy = live !== null;

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy || !aSettings) return;
    setError(null);
    setDraft('');
    stopRequested.current = false;
    // The whole turn belongs to the workspace it started in (invariant 2).
    const ctx = captureWorkspace();
    try {
      const environment = env ?? (await detect());
      let chatId = activeId;
      if (!chatId) {
        const chat = await assistantService.createConversation(q, aSettings.engine);
        chatId = chat.id;
        setActiveId(chat.id);
      }
      const history = chatId === activeId ? messages : [];
      const userMsg = await assistantService.appendMessage(ctx.id, chatId, { role: 'user', content: q });
      setMessages((m) => [...m, userMsg]);
      setLive({ conversationId: chatId, question: q, text: '', tools: [] });

      const acc = new TurnAccumulator();
      const localApiKey = await getLocalApiKey(ctx.id);
      const turn = runTurn({
        model: aSettings.model,
        localBaseUrl: aSettings.localBaseUrl,
        localApiKey,
        env: environment,
        workspaceId: ctx.id,
        currency: settings.preferredCurrency,
        history,
        question: q,
        onEvent: (ev) => {
          acc.apply(ev);
          setLive((l) => (l ? { ...l, text: acc.text, tools: [...acc.tools] } : l));
        },
      });
      turnRef.current = turn;
      await turn.finished;
      turnRef.current = null;

      const stopped = stopRequested.current;
      const answer = acc.answer();
      const saved = await assistantService.appendMessage(ctx.id, chatId, {
        role: 'assistant',
        content: stopped ? answer || 'Stopped before an answer.' : acc.error ? acc.error : answer || 'No answer came back.',
        toolCalls: acc.tools,
        engine: aSettings.engine,
        status: stopped ? 'stopped' : acc.error ? 'error' : 'complete',
      });
      // Only show it if the user is still looking at this chat.
      setMessages((m) => (m.length && m[0].conversationId === chatId ? [...m, saved] : m));
      await reloadChats();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLive(null);
      inputRef.current?.focus();
    }
  };

  const activeChat = useMemo(() => chats.find((c) => c.id === activeId) ?? null, [chats, activeId]);

  if (aSettings && !aSettings.enabled) {
    return (
      <div>
        <PageHeader serif label="Insights" title="Assistant" />
        <Card>
          <p style={{ color: 'var(--text)' }}>The assistant is off for this workspace.</p>
          <p className="mt-1 mb-4" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
            Turn it on in Settings. Answers come from a model running on this computer, such as
            Ollama or LM Studio. To ask from Claude Code or Codex instead, connect them in Settings.
          </p>
          <Link to="/settings">
            <Button variant="primary">Open Settings</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const engineName = aSettings?.model ? aSettings.model : 'Your local model';

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - var(--header-h) - 48px)' }}>
      <PageHeader
        serif
        label="Insights"
        title="Assistant"
        subtitle="Ask about your money. Answers come from a model on this computer using Koinkat's read-only data."
        className="mb-5"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4 flex-1 min-h-0">
        {/* Chats */}
        <aside className="hidden lg:flex flex-col min-h-0">
          <Button
            variant="secondary"
            className="mb-3 w-full"
            disabled={busy}
            onClick={() => {
              setActiveId(null);
              setError(null);
              inputRef.current?.focus();
            }}
          >
            <MessageSquarePlus size={16} /> New chat
          </Button>
          <nav className="flex flex-col gap-0.5 overflow-y-auto min-h-0" aria-label="Chats">
            {chats.length === 0 && (
              <p className="px-3 py-2" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
                Your chats will be listed here.
              </p>
            )}
            {chats.map((c) => (
              <div key={c.id} className="group relative">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setActiveId(c.id)}
                  className={`kk-nav-item w-full text-left pr-9 ${c.id === activeId ? 'kk-nav-active' : ''}`}
                  title={c.title}
                >
                  <span className="truncate">{c.title}</span>
                </button>
                <button
                  type="button"
                  className="kk-icon-btn absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  data-tone="danger"
                  aria-label={`Delete chat ${c.title}`}
                  disabled={busy}
                  onClick={async () => {
                    await assistantService.deleteConversation(c.id);
                    if (c.id === activeId) setActiveId(null);
                    await reloadChats();
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </nav>
        </aside>

        {/* Conversation */}
        <section
          className="flex flex-col min-h-0 rounded-lg"
          style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
          aria-label={activeChat?.title ?? 'New chat'}
        >
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6" aria-live="polite">
            {messages.length === 0 && !live ? (
              <EmptyState onPick={(s) => void ask(s)} disabled={busy} engine={engineName} />
            ) : (
              <div className="flex flex-col gap-6 max-w-3xl mx-auto">
                {messages.map((m) => (
                  <MessageView key={m.id} message={m} />
                ))}
                {live && <LiveView live={live} engine={engineName} />}
              </div>
            )}
          </div>

          {error && (
            <p className="px-6 pb-2 flex items-center gap-2" style={{ color: 'var(--danger)', fontSize: 'var(--fs-body-sm)' }}>
              <CircleAlert size={14} /> {error}
            </p>
          )}

          {/* Composer */}
          <form
            className="p-4"
            style={{ borderTop: '1px solid var(--border)' }}
            onSubmit={(e) => {
              e.preventDefault();
              void ask(draft);
            }}
          >
            <div
              className="flex items-end gap-2 max-w-3xl mx-auto rounded-lg px-3 py-2"
              style={{ border: '1px solid var(--border-strong)', backgroundColor: 'var(--input-bg)' }}
            >
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void ask(draft);
                  }
                }}
                rows={Math.min(6, Math.max(1, draft.split('\n').length))}
                placeholder="Ask about your spending, budgets, accounts..."
                aria-label="Your question"
                className="flex-1 resize-none bg-transparent outline-none py-1.5"
                style={{ color: 'var(--text)', fontSize: 'var(--fs-body)' }}
                disabled={busy}
              />
              {busy ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    stopRequested.current = true;
                    void turnRef.current?.stop();
                  }}
                  aria-label="Stop"
                >
                  <Square size={14} /> Stop
                </Button>
              ) : (
                <Button type="submit" variant="primary" disabled={!draft.trim()} aria-label="Send">
                  <ArrowUp size={16} />
                </Button>
              )}
            </div>
            <p className="max-w-3xl mx-auto mt-2" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}>
              Read-only. Runs on this computer. Check important figures in Koinkat.
            </p>
          </form>
        </section>
      </div>
    </div>
  );
}

function EmptyState({ onPick, disabled, engine }: { onPick: (s: string) => void; disabled: boolean; engine: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center max-w-xl mx-auto">
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-h2)', color: 'var(--text)' }}>
        What would you like to know?
      </h2>
      <p className="mt-2 mb-6" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
        {engine} reads this workspace through Koinkat's tools and does the maths with exact decimals.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => onPick(s)}
            className="text-left px-4 py-3 rounded-lg transition-colors cursor-pointer hover:bg-[var(--surface-alt)]"
            style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: 'var(--fs-body-sm)' }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToolChips({ tools, working }: { tools: string[]; working?: boolean }) {
  if (tools.length === 0 && !working) return null;
  // Same tool twice in a row reads as one step.
  const steps = tools.filter((t, i) => t !== tools[i - 1]);
  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-2">
      {steps.map((t, i) => (
        <span key={`${t}-${i}`} className="kk-chip">
          <Wrench size={10} aria-hidden /> {toolLabel(t)}
        </span>
      ))}
      {working && (
        <span className="kk-chip" data-tone="primary">
          <Loader2 size={10} className="animate-spin" aria-hidden /> Working
        </span>
      )}
    </div>
  );
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="kk-prose" data-privacy-field>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function MessageView({ message }: { message: AssistantMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[80%] px-4 py-2.5 rounded-2xl whitespace-pre-wrap"
          style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text)', fontSize: 'var(--fs-body)' }}
          data-privacy-field
        >
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div>
      <ToolChips tools={message.toolCalls} />
      {message.status === 'error' ? (
        <p className="flex items-start gap-2" style={{ color: 'var(--danger)', fontSize: 'var(--fs-body-sm)' }}>
          <CircleAlert size={14} className="mt-0.5 shrink-0" /> {message.content}
        </p>
      ) : (
        <>
          <Markdown text={message.content} />
          {message.status === 'stopped' && (
            <p className="mt-1" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}>
              Stopped
            </p>
          )}
        </>
      )}
    </div>
  );
}

function LiveView({ live, engine }: { live: LiveTurn; engine: string }) {
  return (
    <div>
      <ToolChips tools={live.tools} working />
      {live.text ? (
        <Markdown text={live.text} />
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>{engine} is looking at your data...</p>
      )}
    </div>
  );
}
