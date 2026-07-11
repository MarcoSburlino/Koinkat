import { getDb, withTransaction } from '../db/database';
import { requireActiveKoinkatAccountId } from '../lib/active-koinkat-account';
import type { Category, CategoryRow } from '../types/models';
import { toCategory } from '../types/models';
import type { CategoryType } from '../types/enums';

/* ── List / Read ─────────────────────────────────────────────────────── */

/**
 * Return ALL categories for the active workspace as a flat array,
 * ordered for display: type, then macro (parent first), then
 * subcategories underneath their parent, then alphabetical.
 */
export async function listCategories(): Promise<Category[]> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<CategoryRow[]>(
    `SELECT * FROM categories
      WHERE koinkat_account_id = ?
      ORDER BY type ASC,
               COALESCE(parent_id, id) ASC,
               parent_id IS NULL DESC,
               sort_order ASC,
               name ASC`,
    [koinkatAccountId],
  );
  return rows.map(toCategory);
}

/**
 * Return categories for the given type (or all if omitted). Flat list -
 * use `listCategoryTree` when you need the parent/children hierarchy.
 */
export async function listCategoriesByType(
  type: CategoryType,
): Promise<Category[]> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<CategoryRow[]>(
    `SELECT * FROM categories
      WHERE koinkat_account_id = ? AND type = ?
      ORDER BY parent_id IS NULL DESC, sort_order ASC, name ASC`,
    [koinkatAccountId, type],
  );
  return rows.map(toCategory);
}

/**
 * Load the full category tree - macro categories at the top level,
 * each with a populated `children` array of user-created subcategories.
 *
 * Pass `type` to restrict to income or expense only (the default returns
 * both).
 */
export async function listCategoryTree(
  type?: CategoryType,
): Promise<Category[]> {
  const flat = type
    ? await listCategoriesByType(type)
    : await listCategories();

  const macros = flat.filter((c) => c.parentId === null);
  const byParent = new Map<string, Category[]>();
  for (const c of flat) {
    if (c.parentId !== null) {
      const arr = byParent.get(c.parentId) ?? [];
      arr.push(c);
      byParent.set(c.parentId, arr);
    }
  }
  return macros.map((macro) => ({
    ...macro,
    children: (byParent.get(macro.id) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
  }));
}

export async function getCategoryById(id: string): Promise<Category | null> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<CategoryRow[]>(
    'SELECT * FROM categories WHERE id = ? AND koinkat_account_id = ? LIMIT 1',
    [id, koinkatAccountId],
  );
  return rows.length > 0 ? toCategory(rows[0]) : null;
}

/**
 * Look up a system macro category by name (e.g. "Food & Dining",
 * "Financial Fees", "Other Income"). Used by the categorization engine
 * for defaults (Stage 4 income fallback) and by `transaction-service`
 * for the fee-linked system category.
 */
export async function getSystemMacroByName(
  name: string,
  type: CategoryType,
): Promise<Category | null> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<CategoryRow[]>(
    `SELECT * FROM categories
      WHERE koinkat_account_id = ?
        AND name = ? AND type = ?
        AND parent_id IS NULL
        AND is_system = 1
      LIMIT 1`,
    [koinkatAccountId, name, type],
  );
  return rows.length > 0 ? toCategory(rows[0]) : null;
}

/* ── Create ──────────────────────────────────────────────────────────── */

/**
 * Create a user-defined top-level (macro) category. This sits alongside
 * the 24 seeded system macros. Rejects:
 * - empty name
 * - duplicate name + type at the macro level
 */
export async function createMacro(params: {
  name: string;
  type: CategoryType;
  icon?: string | null;
  color?: string | null;
}): Promise<Category> {
  const name = params.name.trim();
  if (!name) throw new Error('Category name is required');

  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  // Dedup: another macro with the same name + type?
  const existing = await db.select<CategoryRow[]>(
    `SELECT * FROM categories
      WHERE koinkat_account_id = ?
        AND parent_id IS NULL
        AND name = ?
        AND type = ?
      LIMIT 1`,
    [koinkatAccountId, name, params.type],
  );
  if (existing.length > 0) return toCategory(existing[0]);

  // sort_order: append to the end of the list for this type
  const sortRows = await db.select<{ max_sort: number | null }[]>(
    `SELECT MAX(sort_order) AS max_sort FROM categories
      WHERE koinkat_account_id = ? AND type = ? AND parent_id IS NULL`,
    [koinkatAccountId, params.type],
  );
  const nextSortOrder = (sortRows[0]?.max_sort ?? 0) + 1;

  const id = crypto.randomUUID();
  await db.execute(
    `INSERT INTO categories
       (id, koinkat_account_id, name, type, parent_id, icon, color, is_system, sort_order)
     VALUES (?, ?, ?, ?, NULL, ?, ?, 0, ?)`,
    [
      id,
      koinkatAccountId,
      name,
      params.type,
      params.icon ?? null,
      params.color ?? null,
      nextSortOrder,
    ],
  );

  const category = await getCategoryById(id);
  if (!category) throw new Error('Failed to create macro category');
  return category;
}

/**
 * Create a user subcategory under an existing macro. Rejects:
 * - empty name
 * - parent not found / belongs to another workspace
 * - parent is itself a subcategory (two-level max)
 * - duplicate name under the same parent
 */
export async function createSubcategory(params: {
  parentId: string;
  name: string;
  icon?: string | null;
  color?: string | null;
}): Promise<Category> {
  const name = params.name.trim();
  if (!name) throw new Error('Subcategory name is required');

  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  // Parent must exist in this workspace AND be a macro (parent_id IS NULL)
  const parentRows = await db.select<CategoryRow[]>(
    'SELECT * FROM categories WHERE id = ? AND koinkat_account_id = ? LIMIT 1',
    [params.parentId, koinkatAccountId],
  );
  if (parentRows.length === 0) {
    throw new Error('Parent category not found');
  }
  const parent = parentRows[0];
  if (parent.parent_id !== null) {
    throw new Error(
      'Cannot nest a subcategory under another subcategory - categories are two-level only.',
    );
  }

  // Dedup: same name under the same parent
  const existing = await db.select<CategoryRow[]>(
    `SELECT * FROM categories
      WHERE koinkat_account_id = ? AND parent_id = ? AND name = ? AND type = ?
      LIMIT 1`,
    [koinkatAccountId, parent.id, name, parent.type],
  );
  if (existing.length > 0) return toCategory(existing[0]);

  const id = crypto.randomUUID();
  await db.execute(
    `INSERT INTO categories
       (id, koinkat_account_id, name, type, parent_id, icon, color, is_system, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
    [
      id,
      koinkatAccountId,
      name,
      parent.type,
      parent.id,
      params.icon ?? null,
      params.color ?? null,
    ],
  );

  const category = await getCategoryById(id);
  if (!category) throw new Error('Failed to create subcategory');
  return category;
}

/* ── Update ──────────────────────────────────────────────────────────── */

export async function updateCategory(
  id: string,
  params: { name?: string; icon?: string | null; color?: string | null },
): Promise<Category | null> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  const current = await db.select<CategoryRow[]>(
    'SELECT * FROM categories WHERE id = ? AND koinkat_account_id = ? LIMIT 1',
    [id, koinkatAccountId],
  );
  if (current.length === 0) return null;

  const row = current[0];
  if (row.is_system === 1) {
    throw new Error('Cannot update a system category');
  }

  // Fragments are hardcoded literals only - never interpolate user input into a clause string; bind values via '?'.
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (params.name !== undefined) {
    const name = params.name.trim();
    if (!name) throw new Error('Category name is required');
    setClauses.push('name = ?');
    values.push(name);
  }
  if (params.icon !== undefined) {
    setClauses.push('icon = ?');
    values.push(params.icon);
  }
  if (params.color !== undefined) {
    setClauses.push('color = ?');
    values.push(params.color);
  }

  if (setClauses.length === 0) return getCategoryById(id);

  setClauses.push("updated_at = datetime('now')");
  values.push(id, koinkatAccountId);

  await db.execute(
    `UPDATE categories SET ${setClauses.join(', ')} WHERE id = ? AND koinkat_account_id = ?`,
    values,
  );

  return getCategoryById(id);
}

/* ── Delete ──────────────────────────────────────────────────────────── */

/**
 * Delete a subcategory. System macros are refused. Transactions that
 * reference the deleted subcategory are re-parented to the macro (or to
 * NULL if `reparentTo` is explicitly null - which drops them into the
 * Uncategorized bucket).
 */
export async function deleteCategory(
  id: string,
  opts: { reparentTo?: string | null } = {},
): Promise<boolean> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  const rows = await db.select<CategoryRow[]>(
    'SELECT * FROM categories WHERE id = ? AND koinkat_account_id = ? LIMIT 1',
    [id, koinkatAccountId],
  );
  if (rows.length === 0) return false;

  const row = rows[0];
  if (row.is_system === 1) {
    throw new Error('Cannot delete a system category');
  }

  // Macros with subcategories are refused: the FK `categories.parent_id
  // ON DELETE CASCADE` would silently delete the whole subtree, and every
  // transaction under those subcategories would drop to Uncategorized via
  // `category_id ON DELETE SET NULL` - bypassing the re-parent logic below.
  if (row.parent_id === null) {
    const children = await db.select<{ cnt: number }[]>(
      'SELECT COUNT(*) AS cnt FROM categories WHERE parent_id = ? AND koinkat_account_id = ?',
      [id, koinkatAccountId],
    );
    if ((children[0]?.cnt ?? 0) > 0) {
      throw new Error(
        'This category still has subcategories. Delete or move them first.',
      );
    }
  }

  // Determine where to move the child transactions. Default: the parent
  // macro. If the caller explicitly passes `reparentTo: null`, orphan
  // the transactions (they become Uncategorized).
  const moveTo =
    opts.reparentTo === null
      ? null
      : (opts.reparentTo ?? row.parent_id);

  return withTransaction(async (tx) => {
    await tx.execute(
      `UPDATE transactions
          SET category_id = ?, updated_at = datetime('now')
        WHERE koinkat_account_id = ? AND category_id = ?`,
      [moveTo, koinkatAccountId, id],
    );
    // Also clear any learned rule that pointed here (rules on a
    // now-deleted category become stale). The ON DELETE CASCADE on the
    // rules FK would kill the rule entirely, which is what we want.
    const result = await tx.execute(
      'DELETE FROM categories WHERE id = ? AND koinkat_account_id = ?',
      [id, koinkatAccountId],
    );
    return result.rowsAffected > 0;
  });
}

/* ── Counts (UI badges) ─────────────────────────────────────────────── */

/**
 * Count non-transfer transactions under each macro category (including
 * its subcategories). Keyed by macro id - useful for the categories
 * management page to show "37 transactions" next to each macro.
 */
export async function countTransactionsPerMacro(): Promise<
  Record<string, number>
> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<{ macro_id: string; cnt: number }[]>(
    `SELECT COALESCE(c.parent_id, c.id) AS macro_id, COUNT(*) AS cnt
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
      WHERE t.koinkat_account_id = ?
        AND t.category_id IS NOT NULL
      GROUP BY macro_id`,
    [koinkatAccountId],
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.macro_id] = r.cnt;
  return out;
}

/**
 * Count transactions per exact category id (no macro rollup). Used for
 * the per-subcategory badges on the categories page, so the user can
 * see how many rows a subcategory holds before deleting or renaming it.
 */
export async function countTransactionsPerCategory(): Promise<
  Record<string, number>
> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<{ category_id: string; cnt: number }[]>(
    `SELECT category_id, COUNT(*) AS cnt
       FROM transactions
      WHERE koinkat_account_id = ?
        AND category_id IS NOT NULL
      GROUP BY category_id`,
    [koinkatAccountId],
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.category_id] = r.cnt;
  return out;
}

/** Count transactions for a single category id (not macro rollup). */
export async function countTransactionsByCategory(
  categoryId: string,
): Promise<number> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<{ cnt: number }[]>(
    'SELECT COUNT(*) AS cnt FROM transactions WHERE category_id = ? AND koinkat_account_id = ?',
    [categoryId, koinkatAccountId],
  );
  return rows[0]?.cnt ?? 0;
}
