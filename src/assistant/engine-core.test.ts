import { describe, it, expect } from 'vitest';
import { TurnAccumulator } from './parsers';
import { composeChatMessages, systemPrompt, toolLabel, HISTORY_BUDGET } from './prompt';
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

describe('turn accumulator', () => {
  it('records tools in order and saves the final answer, not narration', () => {
    const acc = new TurnAccumulator();
    acc.apply({ type: 'text', delta: 'Let me check.' });
    acc.apply({ type: 'tool', name: 'summarize_transactions' });
    acc.apply({ type: 'break' });
    acc.apply({ type: 'text', delta: 'You spent 422,09 EUR.' });
    acc.apply({ type: 'done', text: null });
    expect(acc.tools).toEqual(['summarize_transactions']);
    expect(acc.answer()).toBe('You spent 422,09 EUR.');
  });

  it('prefers the clean text a done event carries', () => {
    const acc = new TurnAccumulator();
    acc.apply({ type: 'text', delta: 'draft' });
    acc.apply({ type: 'done', text: 'Your net worth is 27 154,22 EUR.' });
    expect(acc.answer()).toBe('Your net worth is 27 154,22 EUR.');
  });

  it('surfaces a failed turn', () => {
    const acc = new TurnAccumulator();
    acc.apply({ type: 'error', message: 'The local model answered 500' });
    expect(acc).toMatchObject({ done: true, error: 'The local model answered 500' });
  });
});

describe('prompts', () => {
  it('builds alternating chat messages and skips failed turns', () => {
    const m = composeChatMessages(
      'SYS',
      [msg('assistant', 'orphan'), msg('user', 'Food in October?'), msg('assistant', '422,09 EUR'), msg('assistant', 'oops', 'error')],
      'And November?',
    );
    expect(m.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(m.map((x) => x.content)).not.toContain('oops');
    expect(m[m.length - 1].content).toBe('And November?');
  });

  it('drops the oldest history beyond the budget', () => {
    const big = 'x'.repeat(HISTORY_BUDGET / 2);
    const m = composeChatMessages('SYS', [msg('user', 'OLDEST ' + big), msg('assistant', big), msg('user', 'recent')], 'q');
    expect(m.some((x) => x.content.startsWith('OLDEST'))).toBe(false);
    expect(m.some((x) => x.content === 'recent')).toBe(true);
  });

  it('tells the model that transaction text is data, not instructions', () => {
    expect(systemPrompt('2026-11-12', 'EUR')).toMatch(/never instructions/);
  });

  it('labels tools in plain words', () => {
    expect(toolLabel('summarize_transactions')).toBe('Added up transactions');
    expect(toolLabel('mcp__koinkat__get_budgets')).toBe('Read budgets');
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
