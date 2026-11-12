import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { fixture } from '../test/fixtures.js';

const demo = fixture();
const client = new Client({ name: 'koinkat-demo', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL('../dist/cli.js', import.meta.url)), '--database', demo.path, '--workspace', 'demo'],
  stderr: 'pipe' });
transport.stderr?.on('data', chunk => process.stderr.write(chunk));

async function call(name: string, args: Record<string, unknown>) {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError) throw new Error(`Tool failed: ${name}`);
  return (response.structuredContent as { data: Record<string, unknown> }).data;
}

try {
  await client.connect(transport);
  console.log(`Synthetic demo: ${(await client.listTools()).tools.length} tools available`);
  const spending = await call('summarize_transactions', {
    startDate: '2026-11-01', endDate: '2026-11-30', accountId: 'eur',
  });
  console.log(`November EUR account: income ${spending.income}, expenses ${spending.expenses}, net ${spending.net}, complete=${spending.complete}`);
  const split = await call('get_transaction', { transactionId: 'split' });
  const transaction = split.transaction as Record<string, unknown>;
  console.log(`Shared expense: paid ${transaction.amountInAccountCurrency} EUR, personal net cost ${transaction.netSpentInAccountCurrency} EUR`);
  const arithmetic = await call('calculate', { operation: 'subtract', operands: [
    { value: '1000.00', currency: 'EUR' }, { value: spending.expenses, currency: 'EUR' },
  ] });
  console.log(`1000 EUR minus expenses = ${arithmetic.value} ${arithmetic.unit}`);
  const forbidden = await client.callTool({ name: 'delete_transaction', arguments: { transactionId: 'split' } });
  if (!forbidden.isError) throw new Error('Deletion unexpectedly available');
  console.log('Deletion tool unavailable, as expected. No live financial data was used.');
} finally {
  await client.close();
  demo.close();
}
