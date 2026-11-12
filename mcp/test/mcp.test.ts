import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fixture } from './fixtures.js';
import { join } from 'node:path';
import { ReadDatabase } from '../src/database.js';
import { FinanceRepository } from '../src/repository.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

test('real MCP stdio handshake, discovery and all ten tools work against a synthetic Koinkat database', { timeout: 20_000 }, async t => {
  const f = fixture(); t.after(() => f.close());
  const before = readFileSync(f.path);
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [cli, '--database', f.path, '--workspace', 'demo'], stderr: 'pipe' });
  const errors: string[] = [];
  transport.stderr?.on('data', chunk => errors.push(String(chunk)));
  const client = new Client({ name: 'koinkat-mcp-integration-test', version: '1.0.0' });
  t.after(async () => { await client.close(); });
  await client.connect(transport);
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 10);
  for (const tool of listed.tools) {
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.openWorldHint, false);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  const inputs: Record<string, Record<string, unknown>> = {
    get_context: {}, list_accounts: {}, list_categories: {}, search_transactions: { limit: 1 },
    get_transaction: { transactionId: 'split' }, summarize_transactions: { groupBy: 'month' },
    get_budgets: { year: 2026 }, list_recurring_expenses: {}, list_split_expenses: {},
    calculate: { operation: 'sum', operands: [{ value: '0.1', currency: 'EUR' }, { value: '0.2', currency: 'EUR' }] },
  };
  const responses = new Map<string, Record<string, unknown>>();
  for (const [name, args] of Object.entries(inputs)) {
    const response = await client.callTool({ name, arguments: args });
    assert.notEqual(response.isError, true, `${name}: ${JSON.stringify(response)}`);
    const result = response.structuredContent as { workspaceId: string; data: Record<string, unknown> };
    assert.equal(result.workspaceId, 'demo');
    responses.set(name, result.data);
    assert.doesNotMatch(JSON.stringify(response), /CANARY|PRIVATE_OTHER|private_key|session_id|authorization_id|iban/i);
  }
  assert.equal(responses.get('calculate')!.value, '0.30');
  assert.equal(responses.get('summarize_transactions')!.expenses, '134.10');
  assert.equal(responses.get('search_transactions')!.totalMatching, 17);
  const bad = await client.callTool({ name: 'search_transactions', arguments: { workspaceId: 'other', amount: '1' } });
  assert.equal(bad.isError, true);
  const other = await client.callTool({ name: 'get_transaction', arguments: { transactionId: 'other-transaction' } });
  assert.equal(other.isError, true);
  const unknown = await client.callTool({ name: 'delete_transaction', arguments: { transactionId: 'split' } });
  assert.equal(unknown.isError, true);
  const invalidDate = await client.callTool({ name: 'search_transactions', arguments: { startDate: '2026-02-30' } });
  assert.equal(invalidDate.isError, true);
  const numberMoney = await client.callTool({ name: 'calculate', arguments: { operation: 'sum', operands: [{ value: 0.1 }] } });
  assert.equal(numberMoney.isError, true);
  assert.deepEqual(readFileSync(f.path), before);
  assert.doesNotMatch(errors.join(''), /CANARY|PRIVATE_OTHER/);
});

test('CLI fails closed for missing arguments and prints help only on stderr', () => {
  const missing = spawnSync(process.execPath, [cli], { encoding: 'utf8', timeout: 5000 });
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, '');
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(help.status, 0);
  assert.equal(help.stdout, '');
  assert.match(help.stderr, /Usage:/);
});

test('documented demo generator creates usable synthetic data and refuses to overwrite it', t => {
  const f = fixture(); t.after(() => f.close());
  const path = join(f.directory, 'generated-demo.db');
  const generator = fileURLToPath(new URL('../scripts/create-demo.ts', import.meta.url));
  const args = ['--import', 'tsx', generator, '--output', path];
  const generated = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 5000 });
  assert.equal(generated.status, 0, generated.stderr);
  const database = new ReadDatabase(path, 'demo');
  try {
    assert.equal(new FinanceRepository(database).summarizeTransactions({}).expenses, '134.10');
  } finally { database.close(); }
  const before = readFileSync(path);
  const repeat = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 5000 });
  assert.notEqual(repeat.status, 0);
  assert.match(repeat.stderr, /Refusing to overwrite/);
  assert.deepEqual(readFileSync(path), before);
});
