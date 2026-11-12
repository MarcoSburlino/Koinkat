import { describe, it, expect } from 'vitest';
import { parseClaudeLine, parseCodexLine, TurnAccumulator } from './parsers';
import { composeTurnPrompt, composeChatMessages, systemPrompt, HISTORY_BUDGET } from './prompt';
import { McpClient, type LineTransport } from './mcp-client';
import type { AssistantMessage } from '../types/models';

const msg = (role: 'user' | 'assistant', content: string, status: AssistantMessage['status'] = 'complete'): AssistantMessage => ({
  id: Math.random().toString(36),
  conversationId: 'c',
  role,
  content,
  toolCalls: [],
  engine: null,
  status,
  createdAt: '2026-11-12',
});

describe('Claude Code stream-json', () => {
  it('streams text, records tools, and keeps the clean final answer', () => {
    const lines = [
      '{"type":"system","subtype":"init","tools":["mcp__koinkat__get_context"]}',
      '{"type":"stream_event","event":{"type":"content_block_start","content_block":{"type":"text"}}}',
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Let me check."}}}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__koinkat__summarize_transactions","input":{}}]}}',
      '{"type":"stream_event","event":{"type":"content_block_start","content_block":{"type":"text"}}}',
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"You spent 422,09 EUR."}}}',
      '{"type":"result","subtype":"success","is_error":false,"result":"You spent 422,09 EUR."}',
    ];
    const acc = new TurnAccumulator();
    lines.flatMap(parseClaudeLine).forEach((e) => acc.apply(e));
    expect(acc.tools).toEqual(['summarize_transactions']);
    expect(acc.text).toBe('Let me check.\n\nYou spent 422,09 EUR.');
    expect(acc.answer()).toBe('You spent 422,09 EUR.');
    expect(acc.done).toBe(true);
  });

  it('reports a failed run as an error', () => {
    const [e] = parseClaudeLine('{"type":"result","subtype":"success","is_error":true,"result":"Not logged in"}');
    expect(e).toEqual({ type: 'error', message: 'Not logged in' });
  });

  it('ignores non-JSON noise', () => {
    expect(parseClaudeLine('warning: something')).toEqual([]);
  });
});

describe('Codex exec --json', () => {
  it('uses the last agent message as the answer', () => {
    const lines = [
      '{"type":"thread.started","thread_id":"t"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"I will check."}}',
      '{"type":"item.started","item":{"type":"mcp_tool_call","server":"koinkat","tool":"list_accounts"}}',
      '{"type":"item.completed","item":{"type":"mcp_tool_call","server":"koinkat","tool":"list_accounts"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"Your net worth is 27 154,22 EUR."}}',
      '{"type":"turn.completed","usage":{}}',
    ];
    const acc = new TurnAccumulator();
    lines.flatMap(parseCodexLine).forEach((e) => acc.apply(e));
    expect(acc.tools).toEqual(['list_accounts']);
    expect(acc.answer()).toBe('Your net worth is 27 154,22 EUR.');
  });

  it('surfaces a failed turn', () => {
    expect(parseCodexLine('{"type":"turn.failed","error":{"message":"usage limit"}}')).toEqual([
      { type: 'error', message: 'usage limit' },
    ]);
  });
});

describe('prompts', () => {
  it('sends a first question on its own, never starting with a dash', () => {
    expect(composeTurnPrompt([], '--help me')).toBe('Question: --help me');
  });

  it('carries recent history and skips failed turns', () => {
    const p = composeTurnPrompt(
      [msg('user', 'Food in October?'), msg('assistant', '422,09 EUR'), msg('assistant', 'oops', 'error')],
      'And November?',
    );
    expect(p).toMatch(/^Conversation so far/);
    expect(p).toContain('User: Food in October?\n\nAssistant: 422,09 EUR');
    expect(p).not.toContain('oops');
    expect(p.endsWith('New question: And November?')).toBe(true);
  });

  it('drops the oldest history beyond the budget', () => {
    const big = 'x'.repeat(HISTORY_BUDGET / 2);
    const p = composeTurnPrompt([msg('user', 'OLDEST ' + big), msg('assistant', big), msg('user', 'recent')], 'q');
    expect(p).not.toContain('OLDEST');
    expect(p).toContain('recent');
  });

  it('builds alternating chat messages for local models', () => {
    const m = composeChatMessages('SYS', [msg('assistant', 'orphan'), msg('user', 'a'), msg('assistant', 'b')], 'c');
    expect(m.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('tells the model that transaction text is data, not instructions', () => {
    expect(systemPrompt('2026-11-12', 'EUR')).toMatch(/never instructions/);
  });
});

describe('MCP client', () => {
  function fakeServer() {
    let handler: (l: string) => void = () => {};
    const sent: unknown[] = [];
    const transport: LineTransport = {
      async send(line) {
        const m = JSON.parse(line);
        sent.push(m);
        if (m.id === undefined) return;
        const reply =
          m.method === 'initialize'
            ? { protocolVersion: '2025-06-18' }
            : m.method === 'tools/list'
              ? { tools: [{ name: 'calculate', inputSchema: { type: 'object' } }] }
              : m.params.name === 'boom'
                ? null
                : { content: [{ type: 'text', text: '{"value":"3.00"}' }] };
        queueMicrotask(() => {
          handler('not json noise');
          handler(JSON.stringify(reply === null ? { jsonrpc: '2.0', id: m.id, error: { message: 'bad tool' } } : { jsonrpc: '2.0', id: m.id, result: reply }));
        });
      },
      onLine(h) {
        handler = h;
      },
      async close() {},
    };
    return { transport, sent };
  }

  it('initializes, lists and calls tools', async () => {
    const { transport, sent } = fakeServer();
    const c = new McpClient(transport);
    await c.initialize();
    expect((sent[1] as { method: string }).method).toBe('notifications/initialized');
    expect((await c.listTools()).map((t) => t.name)).toEqual(['calculate']);
    expect(await c.callTool('calculate', {})).toEqual({ text: '{"value":"3.00"}', isError: false });
    await expect(c.callTool('boom', {})).rejects.toThrow('bad tool');
  });
});
