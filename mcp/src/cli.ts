import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ReadDatabase } from './database.js';
import { FinanceRepository } from './repository.js';
import { createServer } from './server.js';

async function main() {
  const { values } = parseArgs({ options: {
    database: { type: 'string' }, workspace: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    process.stderr.write('Usage: node dist/cli.js --database /absolute/path/to/koinkat.db --workspace WORKSPACE_ID\nRead-only. No database discovery, migrations, network calls or write tools.\n');
    return;
  }
  if (!values.database || !values.workspace) throw new Error('Both --database and --workspace are required; use --help');
  const database = new ReadDatabase(values.database, values.workspace);
  const server = createServer(new FinanceRepository(database));
  let closed = false;
  const closeDatabase = () => { if (!closed) { closed = true; database.close(); } };
  const shutdown = async () => { await server.close(); closeDatabase(); };
  server.server.onclose = closeDatabase;
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
  try { await server.connect(new StdioServerTransport()); }
  catch (error) { closeDatabase(); throw error; }
}

main().catch(() => {
  // Do not echo user-supplied paths, argument values or database errors to a host log.
  process.stderr.write('Koinkat MCP failed to start. Supply an existing absolute database path and valid workspace ID; the database must use a supported Koinkat schema.\n');
  process.exitCode = 1;
});
