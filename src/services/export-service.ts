import { getDb } from '../db/database';
import { requireActiveKoinkatAccountId } from '../lib/active-koinkat-account';

const SCOPED_TABLES = [
  'accounts',
  'transactions',
  'categories',
  'categorization_rules',
  'budget_events',
  'recurring_budgets',
  'budget_periods',
  'bank_connections',
  'linked_accounts',
  'split_external_reimbursements',
  'recurring_series',
  'recurring_dismissals',
] as const;

type ScopedTable = (typeof SCOPED_TABLES)[number];

export interface WorkspaceExport {
  version: 1;
  exportedAt: string;
  appVersion: string;
  workspace: Record<string, unknown>;
  data: Record<ScopedTable, unknown[]>;
}

// `tags`, `api_configs`, and `mcc_mappings` are intentionally excluded:
//   - tags: legacy classification, superseded by categories.
//   - api_configs: stores Enable Banking private_key_pem; exporting a PEM
//     in a JSON file the user might share is a credential-leak footgun.
//   - mcc_mappings: seeded from static data on workspace creation;
//     re-seeding is idempotent, so exporting it only bloats the file.
//     The full-database backup includes it; the JSON export does not.
export async function exportWorkspaceAsJson(): Promise<string> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  const workspaceRows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM koinkat_accounts WHERE id = ?',
    [koinkatAccountId],
  );
  const workspace = workspaceRows[0];
  if (!workspace) throw new Error('Active workspace not found');

  const data = {} as Record<ScopedTable, unknown[]>;
  for (const table of SCOPED_TABLES) {
    data[table] = await db.select<unknown[]>(
      `SELECT * FROM ${table} WHERE koinkat_account_id = ?`,
      [koinkatAccountId],
    );
  }

  const payload: WorkspaceExport = {
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion: __APP_VERSION__,
    workspace,
    data,
  };
  return JSON.stringify(payload, null, 2);
}
