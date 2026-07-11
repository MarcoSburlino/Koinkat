import { getDb } from '../db/database';
import { requireActiveKoinkatAccountId } from '../lib/active-koinkat-account';

export type RuleSource = 'user' | 'learned' | 'mcc' | 'system';
export type RuleMatchType = 'exact' | 'prefix' | 'contains';
export type RuleMatchField = 'merchant_normalized' | 'remittance_info' | 'creditor_name';

export interface Rule {
  id: string;
  name: string | null;
  matchField: RuleMatchField;
  matchType: RuleMatchType;
  matchPattern: string;
  categoryId: string;
  /** Joined from categories - macro name + optional subcategory name. */
  categoryName: string;
  categoryParentName: string | null;
  priority: number;
  isActive: boolean;
  source: RuleSource;
  confidence: number;
  matchCount: number;
  lastMatchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RuleJoinedRow {
  id: string;
  name: string | null;
  match_field: string;
  match_type: string;
  match_pattern: string;
  category_id: string;
  category_name: string;
  parent_name: string | null;
  priority: number;
  is_active: number;
  source: string;
  confidence: number;
  match_count: number;
  last_matched_at: string | null;
  created_at: string;
  updated_at: string;
}

function toRule(row: RuleJoinedRow): Rule {
  return {
    id: row.id,
    name: row.name,
    matchField: row.match_field as RuleMatchField,
    matchType: row.match_type as RuleMatchType,
    matchPattern: row.match_pattern,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryParentName: row.parent_name,
    priority: row.priority,
    isActive: row.is_active === 1,
    source: row.source as RuleSource,
    confidence: row.confidence,
    matchCount: row.match_count,
    lastMatchedAt: row.last_matched_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ListRulesFilters {
  source?: RuleSource;
  isActive?: boolean;
  categoryId?: string;
}

export async function listRules(
  filters: ListRulesFilters = {},
): Promise<Rule[]> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  const conditions: string[] = ['r.koinkat_account_id = ?'];
  const values: unknown[] = [koinkatAccountId];

  if (filters.source) {
    conditions.push('r.source = ?');
    values.push(filters.source);
  }
  if (filters.isActive !== undefined) {
    conditions.push('r.is_active = ?');
    values.push(filters.isActive ? 1 : 0);
  }
  if (filters.categoryId) {
    conditions.push('r.category_id = ?');
    values.push(filters.categoryId);
  }

  const rows = await db.select<RuleJoinedRow[]>(
    `SELECT
       r.id, r.name, r.match_field, r.match_type, r.match_pattern,
       r.category_id, c.name AS category_name, pc.name AS parent_name,
       r.priority, r.is_active, r.source, r.confidence,
       r.match_count, r.last_matched_at, r.created_at, r.updated_at
     FROM categorization_rules r
     LEFT JOIN categories c ON c.id = r.category_id
     LEFT JOIN categories pc ON pc.id = c.parent_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY r.priority ASC, r.match_count DESC, r.created_at DESC`,
    values,
  );

  return rows.map(toRule);
}

export async function createRule(params: {
  name?: string | null;
  matchField?: RuleMatchField;
  matchType: RuleMatchType;
  matchPattern: string;
  categoryId: string;
  priority?: number;
}): Promise<Rule> {
  const pattern = params.matchPattern.trim();
  if (!pattern) throw new Error('Match pattern is required');

  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  // The category must exist in THIS workspace - a foreign id would create
  // a rule whose category join silently fails in the rule stage.
  await requireWorkspaceCategory(params.categoryId);

  const id = crypto.randomUUID();
  await db.execute(
    `INSERT INTO categorization_rules
       (id, koinkat_account_id, name, match_field, match_type,
        match_pattern, category_id, priority, is_active,
        source, confidence, match_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'user', 1.0, 0)`,
    [
      id,
      koinkatAccountId,
      params.name ?? null,
      params.matchField ?? 'merchant_normalized',
      params.matchType,
      pattern.toUpperCase(),
      params.categoryId,
      params.priority ?? 30,
    ],
  );

  const created = await getRuleById(id);
  if (!created) throw new Error('Failed to create rule');
  return created;
}

/** Targeted single-rule fetch with the same category join as listRules. */
async function getRuleById(id: string): Promise<Rule | null> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<RuleJoinedRow[]>(
    `SELECT
       r.id, r.name, r.match_field, r.match_type, r.match_pattern,
       r.category_id, c.name AS category_name, pc.name AS parent_name,
       r.priority, r.is_active, r.source, r.confidence,
       r.match_count, r.last_matched_at, r.created_at, r.updated_at
     FROM categorization_rules r
     LEFT JOIN categories c ON c.id = r.category_id
     LEFT JOIN categories pc ON pc.id = c.parent_id
     WHERE r.id = ? AND r.koinkat_account_id = ?`,
    [id, koinkatAccountId],
  );
  return rows.length > 0 ? toRule(rows[0]) : null;
}

/** Throw unless the category id exists in the active workspace. */
async function requireWorkspaceCategory(categoryId: string): Promise<void> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<{ id: string }[]>(
    'SELECT id FROM categories WHERE id = ? AND koinkat_account_id = ?',
    [categoryId, koinkatAccountId],
  );
  if (rows.length === 0) {
    throw new Error('Category not found in the active workspace');
  }
}

export async function updateRule(
  id: string,
  patch: Partial<{
    name: string | null;
    matchField: RuleMatchField;
    matchType: RuleMatchType;
    matchPattern: string;
    categoryId: string;
    priority: number;
    isActive: boolean;
  }>,
): Promise<void> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (patch.name !== undefined) {
    setClauses.push('name = ?');
    values.push(patch.name);
  }
  if (patch.matchField !== undefined) {
    setClauses.push('match_field = ?');
    values.push(patch.matchField);
  }
  if (patch.matchType !== undefined) {
    setClauses.push('match_type = ?');
    values.push(patch.matchType);
  }
  if (patch.matchPattern !== undefined) {
    const trimmed = patch.matchPattern.trim();
    if (!trimmed) throw new Error('Match pattern is required');
    setClauses.push('match_pattern = ?');
    values.push(trimmed.toUpperCase());
  }
  if (patch.categoryId !== undefined) {
    await requireWorkspaceCategory(patch.categoryId);
    setClauses.push('category_id = ?');
    values.push(patch.categoryId);
  }
  if (patch.priority !== undefined) {
    setClauses.push('priority = ?');
    values.push(patch.priority);
  }
  if (patch.isActive !== undefined) {
    setClauses.push('is_active = ?');
    values.push(patch.isActive ? 1 : 0);
  }

  if (setClauses.length === 0) return;
  setClauses.push("updated_at = datetime('now')");
  values.push(id, koinkatAccountId);

  await db.execute(
    `UPDATE categorization_rules
        SET ${setClauses.join(', ')}
      WHERE id = ? AND koinkat_account_id = ?`,
    values,
  );
}

export async function toggleRule(id: string, active: boolean): Promise<void> {
  await updateRule(id, { isActive: active });
}

export async function deleteRule(id: string): Promise<boolean> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const result = await db.execute(
    'DELETE FROM categorization_rules WHERE id = ? AND koinkat_account_id = ?',
    [id, koinkatAccountId],
  );
  return result.rowsAffected > 0;
}
