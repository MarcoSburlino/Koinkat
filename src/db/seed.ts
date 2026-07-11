import { getDb, withTransaction } from './database';
import { MCC_MAPPINGS } from '../data/mcc-mappings';

/**
 * System macro categories. These are seeded once per koinkat account and
 * marked `is_system = 1` so the UI renders them read-only. Users create
 * their own subcategories under these.
 *
 * Icons are Lucide icon names as strings - resolved at render time by
 * looking up the matching component. See `src/components/ui/Icon.tsx`
 * (built in Phase 2) for the name → component mapping.
 */

interface MacroCategorySeed {
  name: string;
  icon: string;
  sortOrder: number;
}

const EXPENSE_MACROS: MacroCategorySeed[] = [
  { name: 'Food & Dining',      icon: 'Utensils',        sortOrder:  1 },
  { name: 'Transportation',     icon: 'Car',             sortOrder:  2 },
  { name: 'Housing',            icon: 'Home',            sortOrder:  3 },
  { name: 'Utilities',          icon: 'Zap',             sortOrder:  4 },
  { name: 'Shopping',           icon: 'ShoppingBag',     sortOrder:  5 },
  { name: 'Health & Medical',   icon: 'Heart',           sortOrder:  6 },
  { name: 'Entertainment',      icon: 'Clapperboard',    sortOrder:  7 },
  { name: 'Travel',             icon: 'Plane',           sortOrder:  8 },
  { name: 'Subscriptions',      icon: 'RefreshCw',       sortOrder:  9 },
  // Lucide exposes `Sparkles` (plural), not `Sparkle`.
  { name: 'Personal Care',      icon: 'Sparkles',        sortOrder: 10 },
  { name: 'Education',          icon: 'GraduationCap',   sortOrder: 11 },
  { name: 'Financial Fees',     icon: 'Landmark',        sortOrder: 12 },
  { name: 'Insurance',          icon: 'Shield',          sortOrder: 13 },
  { name: 'Gifts & Donations',  icon: 'Gift',            sortOrder: 14 },
  { name: 'Children & Family',  icon: 'Baby',            sortOrder: 15 },
  { name: 'Pets',               icon: 'PawPrint',        sortOrder: 16 },
  { name: 'Taxes',              icon: 'Receipt',         sortOrder: 17 },
  { name: 'Miscellaneous',      icon: 'MoreHorizontal',  sortOrder: 18 },
];

const INCOME_MACROS: MacroCategorySeed[] = [
  { name: 'Salary & Employment',       icon: 'Briefcase',      sortOrder: 1 },
  { name: 'Self-Employment',           icon: 'Laptop',         sortOrder: 2 },
  { name: 'Investments',               icon: 'TrendingUp',     sortOrder: 3 },
  { name: 'Refunds & Reimbursements',  icon: 'RotateCcw',      sortOrder: 4 },
  { name: 'Gifts Received',            icon: 'Gift',           sortOrder: 5 },
  { name: 'Other Income',              icon: 'MoreHorizontal', sortOrder: 6 },
];

/**
 * Seed the 24 system macro categories for a newly-created koinkat account.
 * Idempotent - skips if system categories already exist for the account.
 */
export async function seedDefaultCategories(
  koinkatAccountId: string,
): Promise<void> {
  const db = await getDb();

  const result = await db.select<[{ count: number }]>(
    'SELECT COUNT(*) as count FROM categories WHERE koinkat_account_id = ? AND is_system = 1',
    [koinkatAccountId],
  );
  if (result[0].count > 0) return;

  // All-or-nothing: a crash after the first INSERT would otherwise trip the
  // COUNT(*) idempotency guard above on the next run, leaving the workspace
  // permanently missing most of its system categories.
  await withTransaction(async (tx) => {
    for (const macro of EXPENSE_MACROS) {
      await tx.execute(
        `INSERT OR IGNORE INTO categories
           (id, koinkat_account_id, name, type, parent_id, icon, is_system, sort_order)
         VALUES (?, ?, ?, 'expense', NULL, ?, 1, ?)`,
        [
          crypto.randomUUID(),
          koinkatAccountId,
          macro.name,
          macro.icon,
          macro.sortOrder,
        ],
      );
    }

    for (const macro of INCOME_MACROS) {
      await tx.execute(
        `INSERT OR IGNORE INTO categories
           (id, koinkat_account_id, name, type, parent_id, icon, is_system, sort_order)
         VALUES (?, ?, ?, 'income', NULL, ?, 1, ?)`,
        [
          crypto.randomUUID(),
          koinkatAccountId,
          macro.name,
          macro.icon,
          macro.sortOrder,
        ],
      );
    }
  });
}

/**
 * Seed the static MCC → macro category mapping for a koinkat account.
 * Idempotent - uses INSERT OR IGNORE on the (koinkat_account_id,
 * mcc_code) PK. Must run AFTER `seedDefaultCategories()` because it
 * resolves macro category names to ids via a lookup on `categories`.
 *
 * Unknown macro names in MCC_MAPPINGS are skipped with a warning (this
 * protects against typos in the data file).
 */
export async function seedMccMappings(
  koinkatAccountId: string,
): Promise<void> {
  const db = await getDb();

  // Build name → id map for the workspace's seeded macro categories
  const macroRows = await db.select<{ id: string; name: string }[]>(
    `SELECT id, name FROM categories
      WHERE koinkat_account_id = ? AND parent_id IS NULL AND is_system = 1`,
    [koinkatAccountId],
  );
  const nameToId = new Map<string, string>();
  for (const row of macroRows) nameToId.set(row.name, row.id);

  for (const mapping of MCC_MAPPINGS) {
    const categoryId = nameToId.get(mapping.macroName);
    if (!categoryId) {
      console.warn(
        `[seed] MCC ${mapping.code} references unknown macro "${mapping.macroName}", skipping.`,
      );
      continue;
    }
    await db.execute(
      `INSERT OR IGNORE INTO mcc_mappings
         (koinkat_account_id, mcc_code, category_id, description)
       VALUES (?, ?, ?, ?)`,
      [koinkatAccountId, mapping.code, categoryId, mapping.description],
    );
  }
}

/* -- Starter categorization rules ---------------------------------- */

interface StarterRuleSeed {
  /** Uppercase pattern matched against `merchant_normalized`. */
  pattern: string;
  matchType: 'contains' | 'prefix';
  macroName: string;
  categoryType: 'income' | 'expense';
}

/**
 * A broad set of "contains" rules covering common European + global
 * merchants. Seeded on first load so new bank imports get real
 * suggestions immediately (without these, the cascade has no rules to
 * match and every transaction falls through to the Miscellaneous /
 * Other Income fallback).
 *
 * Confidence is 0.7 - below the 0.8 review threshold so all
 * starter-rule matches still land in the review queue. Once the user
 * confirms a transaction, `learnFromCorrection` creates a 0.9
 * confidence exact-match rule that overrides the starter rule going
 * forward.
 */
const STARTER_RULES: StarterRuleSeed[] = [
  // Groceries / supermarkets
  { pattern: 'GROCERY',      matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'SUPERMARKET',  matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'NETTO',        matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'BILKA',        matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'REMA',         matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'LIDL',         matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'ALDI',         matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'COOP',         matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'FOTEX',        matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'IRMA',         matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'CARREFOUR',    matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'TESCO',        matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'ESSELUNGA',    matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'CONAD',        matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'COOP ITALIA',  matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'PAM ',         matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'ALBERT HEIJN', matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'EDEKA',        matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'REWE',         matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'MERCADONA',    matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },

  // Restaurants & cafes
  { pattern: 'RESTAURANT',   matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'CAFE',         matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'COFFEE',       matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'PIZZA',        matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'PIZZERIA',     matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'SUSHI',        matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'BURGER',       matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'MCDONALD',     matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'STARBUCKS',    matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'KFC',          matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'SUBWAY',       matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'DOMINO',       matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'DELIVEROO',    matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'UBER EATS',    matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'WOLT',         matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'JUST EAT',     matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },
  { pattern: 'GLOVO',        matchType: 'contains', macroName: 'Food & Dining', categoryType: 'expense' },

  // Travel (airlines + airports - added for Fix 2)
  { pattern: 'RYANAIR',      matchType: 'contains', macroName: 'Travel', categoryType: 'expense' },
  { pattern: 'EASYJET',      matchType: 'contains', macroName: 'Travel', categoryType: 'expense' },
  { pattern: 'WIZZAIR',      matchType: 'contains', macroName: 'Travel', categoryType: 'expense' },
  { pattern: 'AIRPORT',      matchType: 'contains', macroName: 'Travel', categoryType: 'expense' },
  { pattern: 'AEROPUERTO',   matchType: 'contains', macroName: 'Travel', categoryType: 'expense' },
  { pattern: 'AEROPORTO',    matchType: 'contains', macroName: 'Travel', categoryType: 'expense' },

  // Transportation
  { pattern: 'UBER',         matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },
  { pattern: 'LYFT',         matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },
  { pattern: 'TAXI',         matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },
  { pattern: 'BOLT',         matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },
  { pattern: 'FREE NOW',     matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },
  { pattern: 'DSB',          matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },
  { pattern: 'REJSEKORT',    matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },
  { pattern: 'METRO',        matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },
  { pattern: 'TRENITALIA',   matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },
  { pattern: 'ITALO',        matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },
  { pattern: 'FLIXBUS',      matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },
  { pattern: 'FLIXTRAIN',    matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },
  { pattern: 'SBB',          matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },
  { pattern: 'DB BAHN',      matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },
  { pattern: 'FUEL',         matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },
  { pattern: 'BENZIN',       matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },
  { pattern: 'SHELL',        matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },
  { pattern: 'ESSO',         matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },
  { pattern: 'Q8',           matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },
  { pattern: 'ENI',          matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },
  { pattern: 'AGIP',         matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },
  { pattern: 'TOTAL',        matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },
  { pattern: 'PARKING',      matchType: 'contains', macroName: 'Transportation', categoryType: 'expense' },

  // Housing
  { pattern: 'RENT ',        matchType: 'contains', macroName: 'Housing', categoryType: 'expense' },
  { pattern: 'HUSLEJE',      matchType: 'contains', macroName: 'Housing', categoryType: 'expense' },
  { pattern: 'AFFITTO',      matchType: 'contains', macroName: 'Housing', categoryType: 'expense' },
  { pattern: 'MORTGAGE',     matchType: 'contains', macroName: 'Housing', categoryType: 'expense' },
  { pattern: 'MIETE',        matchType: 'contains', macroName: 'Housing', categoryType: 'expense' },

  // Utilities
  { pattern: 'ELECTRIC',     matchType: 'contains', macroName: 'Utilities', categoryType: 'expense' },
  { pattern: 'INTERNET',     matchType: 'contains', macroName: 'Utilities', categoryType: 'expense' },
  { pattern: 'TELIA',        matchType: 'contains', macroName: 'Utilities', categoryType: 'expense' },
  { pattern: 'YOUSEE',       matchType: 'contains', macroName: 'Utilities', categoryType: 'expense' },
  { pattern: 'NORLYS',       matchType: 'contains', macroName: 'Utilities', categoryType: 'expense' },
  { pattern: 'VODAFONE',     matchType: 'contains', macroName: 'Utilities', categoryType: 'expense' },
  { pattern: 'TIM ',         matchType: 'contains', macroName: 'Utilities', categoryType: 'expense' },
  { pattern: 'ILIAD',        matchType: 'contains', macroName: 'Utilities', categoryType: 'expense' },
  { pattern: 'WINDTRE',      matchType: 'contains', macroName: 'Utilities', categoryType: 'expense' },
  { pattern: 'FASTWEB',      matchType: 'contains', macroName: 'Utilities', categoryType: 'expense' },
  { pattern: 'ORANGE',       matchType: 'contains', macroName: 'Utilities', categoryType: 'expense' },
  { pattern: 'TELEFONICA',   matchType: 'contains', macroName: 'Utilities', categoryType: 'expense' },
  { pattern: 'MOVISTAR',     matchType: 'contains', macroName: 'Utilities', categoryType: 'expense' },

  // Subscriptions (digital services)
  { pattern: 'NETFLIX',      matchType: 'contains', macroName: 'Subscriptions', categoryType: 'expense' },
  { pattern: 'SPOTIFY',      matchType: 'contains', macroName: 'Subscriptions', categoryType: 'expense' },
  { pattern: 'APPLE.COM',    matchType: 'contains', macroName: 'Subscriptions', categoryType: 'expense' },
  { pattern: 'ITUNES',       matchType: 'contains', macroName: 'Subscriptions', categoryType: 'expense' },
  { pattern: 'GOOGLE',       matchType: 'contains', macroName: 'Subscriptions', categoryType: 'expense' },
  { pattern: 'DISNEY',       matchType: 'contains', macroName: 'Subscriptions', categoryType: 'expense' },
  { pattern: 'YOUTUBE',      matchType: 'contains', macroName: 'Subscriptions', categoryType: 'expense' },
  { pattern: 'HBO',          matchType: 'contains', macroName: 'Subscriptions', categoryType: 'expense' },
  { pattern: 'PRIME VIDEO',  matchType: 'contains', macroName: 'Subscriptions', categoryType: 'expense' },
  { pattern: 'CHATGPT',      matchType: 'contains', macroName: 'Subscriptions', categoryType: 'expense' },
  { pattern: 'OPENAI',       matchType: 'contains', macroName: 'Subscriptions', categoryType: 'expense' },
  { pattern: 'ANTHROPIC',    matchType: 'contains', macroName: 'Subscriptions', categoryType: 'expense' },
  { pattern: 'CLAUDE',       matchType: 'contains', macroName: 'Subscriptions', categoryType: 'expense' },
  { pattern: 'DROPBOX',      matchType: 'contains', macroName: 'Subscriptions', categoryType: 'expense' },
  { pattern: 'ICLOUD',       matchType: 'contains', macroName: 'Subscriptions', categoryType: 'expense' },

  // Shopping
  { pattern: 'AMAZON',       matchType: 'contains', macroName: 'Shopping', categoryType: 'expense' },
  { pattern: 'AMZN',         matchType: 'contains', macroName: 'Shopping', categoryType: 'expense' },
  { pattern: 'EBAY',         matchType: 'contains', macroName: 'Shopping', categoryType: 'expense' },
  { pattern: 'ZALANDO',      matchType: 'contains', macroName: 'Shopping', categoryType: 'expense' },
  { pattern: 'H&M',          matchType: 'contains', macroName: 'Shopping', categoryType: 'expense' },
  { pattern: 'ZARA',         matchType: 'contains', macroName: 'Shopping', categoryType: 'expense' },
  { pattern: 'IKEA',         matchType: 'contains', macroName: 'Shopping', categoryType: 'expense' },
  { pattern: 'DECATHLON',    matchType: 'contains', macroName: 'Shopping', categoryType: 'expense' },
  { pattern: 'WH SMITH',     matchType: 'contains', macroName: 'Shopping', categoryType: 'expense' },
  { pattern: 'WHSMITH',      matchType: 'contains', macroName: 'Shopping', categoryType: 'expense' },

  // Health & Medical
  { pattern: 'PHARMACY',     matchType: 'contains', macroName: 'Health & Medical', categoryType: 'expense' },
  { pattern: 'APOTEK',       matchType: 'contains', macroName: 'Health & Medical', categoryType: 'expense' },
  { pattern: 'APOTHEKE',     matchType: 'contains', macroName: 'Health & Medical', categoryType: 'expense' },
  { pattern: 'FARMACIA',     matchType: 'contains', macroName: 'Health & Medical', categoryType: 'expense' },
  { pattern: 'HOSPITAL',     matchType: 'contains', macroName: 'Health & Medical', categoryType: 'expense' },
  { pattern: 'CLINIC',       matchType: 'contains', macroName: 'Health & Medical', categoryType: 'expense' },
  { pattern: 'DENTIST',      matchType: 'contains', macroName: 'Health & Medical', categoryType: 'expense' },

  // Insurance
  { pattern: 'INSURANCE',    matchType: 'contains', macroName: 'Insurance', categoryType: 'expense' },
  { pattern: 'FORSIKRING',   matchType: 'contains', macroName: 'Insurance', categoryType: 'expense' },
  { pattern: 'ASSICURAZIONE',matchType: 'contains', macroName: 'Insurance', categoryType: 'expense' },
  { pattern: 'VERSICHERUNG', matchType: 'contains', macroName: 'Insurance', categoryType: 'expense' },

  // Financial Fees
  { pattern: 'FEE',          matchType: 'contains', macroName: 'Financial Fees', categoryType: 'expense' },
  { pattern: 'GEBYR',        matchType: 'contains', macroName: 'Financial Fees', categoryType: 'expense' },
  { pattern: 'COMMISSIONE',  matchType: 'contains', macroName: 'Financial Fees', categoryType: 'expense' },

  // Taxes
  { pattern: 'SKAT',         matchType: 'contains', macroName: 'Taxes', categoryType: 'expense' },

  // Income
  { pattern: 'SALARY',       matchType: 'contains', macroName: 'Salary & Employment', categoryType: 'income' },
  { pattern: 'STIPENDIO',    matchType: 'contains', macroName: 'Salary & Employment', categoryType: 'income' },
  { pattern: 'PAYROLL',      matchType: 'contains', macroName: 'Salary & Employment', categoryType: 'income' },
  { pattern: 'WAGE',         matchType: 'contains', macroName: 'Salary & Employment', categoryType: 'income' },
  { pattern: 'GEHALT',       matchType: 'contains', macroName: 'Salary & Employment', categoryType: 'income' },
  { pattern: 'REFUND',       matchType: 'contains', macroName: 'Refunds & Reimbursements', categoryType: 'income' },
  { pattern: 'TILBAGEBETALING', matchType: 'contains', macroName: 'Refunds & Reimbursements', categoryType: 'income' },
  { pattern: 'RIMBORSO',     matchType: 'contains', macroName: 'Refunds & Reimbursements', categoryType: 'income' },
];

/**
 * Seed a set of starter `contains` rules for the active workspace.
 *
 * Idempotency is per-(pattern, match_type), NOT "any system rule
 * exists" - so when a new STARTER_RULES entry is added, it backfills on
 * existing workspaces at next boot. User-deleted system rules don't
 * come back because deletion removes the row entirely (so the next
 * seed pass re-inserts it). If that becomes a problem, swap delete for
 * `is_active = 0` in the rule UI: this guard only checks for presence,
 * not active-state, so paused rules survive.
 *
 * Starter rules have priority 90 (lower than learned rules at 50 and
 * user rules at 30, so custom/learned rules always win) and confidence
 * 0.7 (below the 0.8 fuzzy-match review threshold, so matched
 * transactions still go to the review queue).
 */
export async function seedStarterRules(
  koinkatAccountId: string,
): Promise<void> {
  const db = await getDb();

  // Load existing system rules so we can skip per-(pattern, match_type).
  const existingRules = await db.select<
    { match_pattern: string; match_type: string }[]
  >(
    `SELECT match_pattern, match_type FROM categorization_rules
      WHERE koinkat_account_id = ? AND source = 'system'`,
    [koinkatAccountId],
  );
  const existingKeys = new Set<string>();
  for (const r of existingRules) {
    existingKeys.add(`${r.match_pattern.toUpperCase()}::${r.match_type}`);
  }

  // Look up macro category ids by (name, type)
  const macroRows = await db.select<
    { id: string; name: string; type: string }[]
  >(
    `SELECT id, name, type FROM categories
      WHERE koinkat_account_id = ? AND parent_id IS NULL AND is_system = 1`,
    [koinkatAccountId],
  );
  const macroIdByKey = new Map<string, string>();
  for (const row of macroRows) {
    macroIdByKey.set(`${row.type}:${row.name}`, row.id);
  }

  for (const rule of STARTER_RULES) {
    const dedupeKey = `${rule.pattern.toUpperCase()}::${rule.matchType}`;
    if (existingKeys.has(dedupeKey)) continue;

    const key = `${rule.categoryType}:${rule.macroName}`;
    const categoryId = macroIdByKey.get(key);
    if (!categoryId) {
      console.warn(
        `[seed] Starter rule "${rule.pattern}" references unknown macro "${rule.macroName}" (${rule.categoryType}), skipping.`,
      );
      continue;
    }
    await db.execute(
      `INSERT INTO categorization_rules
         (id, koinkat_account_id, name, match_field, match_type,
          match_pattern, category_id, priority, is_active,
          source, confidence, match_count)
       VALUES (?, ?, ?, 'merchant_normalized', ?, ?, ?, 90, 1, 'system', 0.7, 0)`,
      [
        crypto.randomUUID(),
        koinkatAccountId,
        `Starter: ${rule.pattern}`,
        rule.matchType,
        rule.pattern,
        categoryId,
      ],
    );
  }
}
