import { getDb, withTransaction } from '../db/database';
import { requireActiveKoinkatAccountId } from '../lib/active-koinkat-account';
import { getSystemMacroByName } from './category-service';
import { normalizeMerchantName } from '../domain/merchant';
import type { TransactionRow } from '../types/models';
import type {
  CategoryResult,
  CategoryResultSource,
  CategorizerStage,
  LearnResult,
  TransactionCategorizer,
} from '../types/categorization';
import type { CategorizationSource } from '../types/enums';

/* ── Internal helpers ─────────────────────────────────────────────── */

/**
 * Map the internal `CategoryResult.source` onto the storage-level
 * `CategorizationSource` enum. These are deliberately different types:
 * the engine tracks WHERE the match came from (user_exact, learned,
 * mcc), while storage tracks WHAT HAPPENED to the transaction
 * (auto-applied by a rule vs. confirmed by a user vs. corrected).
 */
function storageSourceFromResult(
  source: CategoryResultSource,
): CategorizationSource | null {
  switch (source) {
    case 'user_exact':
    case 'user_rule':
    case 'learned':
      return 'rule_auto';
    case 'mcc':
      return 'mcc_auto';
    case 'uncategorized':
      return null;
  }
}

/* ── Stage context ────────────────────────────────────────────────── */

/**
 * Shared per-invocation context passed to every categorizer stage. Built
 * once at the top of `categorize()` so each stage doesn't have to re-derive
 * the same fields or re-fetch the workspace id.
 */
interface CategorizerContext {
  txn: TransactionRow;
  merchantNormalized: string | null;
  mcc: string | null;
  /** Null for transfers (which skip the rule stages). */
  txnTypeForRules: 'income' | 'expense' | null;
  koinkatAccountId: string;
  db: Awaited<ReturnType<typeof getDb>>;
}

/* ── Stages ───────────────────────────────────────────────────────── */

/**
 * Stage 1 - exact-match user / learned rules on `merchant_normalized`.
 * Matches strict equality (case-insensitive) and respects category type
 * via JOIN so an income rule can't categorize an expense.
 */
const exactMerchantRuleStage: CategorizerStage<CategorizerContext> = {
  name: 'exactMerchantRule',
  async run(ctx) {
    if (!ctx.merchantNormalized || !ctx.txnTypeForRules) return null;

    const exact = await ctx.db.select<
      {
        id: string;
        category_id: string;
        confidence: number;
        source: string;
      }[]
    >(
      `SELECT r.id, r.category_id, r.confidence, r.source
         FROM categorization_rules r
         JOIN categories c ON c.id = r.category_id
        WHERE r.koinkat_account_id = ?
          AND r.is_active = 1
          AND r.match_field = 'merchant_normalized'
          AND r.match_type = 'exact'
          AND UPPER(r.match_pattern) = UPPER(?)
          AND c.type = ?
        ORDER BY r.priority ASC, r.confidence DESC
        LIMIT 1`,
      [ctx.koinkatAccountId, ctx.merchantNormalized, ctx.txnTypeForRules],
    );

    if (exact.length === 0) return null;
    const rule = exact[0];
    return {
      categoryId: rule.category_id,
      confidence: rule.confidence,
      source: rule.source === 'user' ? 'user_exact' : 'learned',
      ruleId: rule.id,
      needsReview: rule.confidence < 0.9,
    };
  },
};

/**
 * Stage 2 - prefix / contains rules on `merchant_normalized`. Covers
 * user-created fuzzy rules AND seeded `source='system'` starter rules.
 * Walks rules in priority order and returns the first match.
 */
const fuzzyMerchantRuleStage: CategorizerStage<CategorizerContext> = {
  name: 'fuzzyMerchantRule',
  async run(ctx) {
    if (!ctx.merchantNormalized || !ctx.txnTypeForRules) return null;

    const fuzzyRules = await ctx.db.select<
      {
        id: string;
        match_type: string;
        match_pattern: string;
        category_id: string;
        confidence: number;
      }[]
    >(
      `SELECT r.id, r.match_type, r.match_pattern, r.category_id, r.confidence
         FROM categorization_rules r
         JOIN categories c ON c.id = r.category_id
        WHERE r.koinkat_account_id = ?
          AND r.is_active = 1
          AND r.match_field = 'merchant_normalized'
          AND r.match_type IN ('prefix', 'contains')
          AND c.type = ?
        ORDER BY r.priority ASC, r.confidence DESC`,
      [ctx.koinkatAccountId, ctx.txnTypeForRules],
    );

    const mn = ctx.merchantNormalized.toUpperCase();
    for (const rule of fuzzyRules) {
      const pat = rule.match_pattern.toUpperCase();
      const hit =
        rule.match_type === 'prefix' ? mn.startsWith(pat) : mn.includes(pat);
      if (hit) {
        return {
          categoryId: rule.category_id,
          confidence: rule.confidence,
          source: 'user_rule',
          ruleId: rule.id,
          needsReview: rule.confidence < 0.8,
        };
      }
    }
    return null;
  },
};

/**
 * Stage 3 - MCC code lookup. Always returns `needsReview: true` because
 * MCC is coarse (categorizes "Eating Places" rather than "Pizzeria da
 * Gigi").
 */
const mccLookupStage: CategorizerStage<CategorizerContext> = {
  name: 'mccLookup',
  async run(ctx) {
    if (!ctx.mcc) return null;
    const mccRows = await ctx.db.select<{ category_id: string }[]>(
      `SELECT category_id FROM mcc_mappings
        WHERE koinkat_account_id = ? AND mcc_code = ?
        LIMIT 1`,
      [ctx.koinkatAccountId, ctx.mcc],
    );
    if (mccRows.length === 0) return null;
    return {
      categoryId: mccRows[0].category_id,
      confidence: 0.6,
      source: 'mcc',
      ruleId: null,
      needsReview: true,
    };
  },
};

// ── LLM stage (future) ────────────────────────────────────────────────
// Insert an `llmStage` here once a Claude/Ollama integration lands. It
// should return null on low confidence (defer to typeFallbackStage) and
// confidence ≥ 0.6 with needsReview=true otherwise. Slots into the
// STAGES array below without touching anything else.

/**
 * Terminal stage - falls back to a system macro by transaction type.
 * Always returns a non-null result so the cascade can't escape with
 * a "no category" for income/expense rows.
 */
const typeFallbackStage: CategorizerStage<CategorizerContext> = {
  name: 'typeFallback',
  async run(ctx) {
    return fallbackByType(ctx.txn);
  },
};

/**
 * The ordered cascade. The terminal `typeFallbackStage` always returns
 * non-null, so the loop in `categorize()` is guaranteed to terminate
 * inside the list.
 *
 * Exported (along with the stage values + context type) for unit tests
 * - the runtime path is the same singleton `categorizer` either way.
 */
export const STAGES: ReadonlyArray<CategorizerStage<CategorizerContext>> = [
  exactMerchantRuleStage,
  fuzzyMerchantRuleStage,
  mccLookupStage,
  // ← LLM stage (future) slots here.
  typeFallbackStage,
];

export {
  exactMerchantRuleStage,
  fuzzyMerchantRuleStage,
  mccLookupStage,
  typeFallbackStage,
};
export type { CategorizerContext };

/* ── Rule-based categorizer ──────────────────────────────────────── */

class RuleBasedCategorizer implements TransactionCategorizer {
  async categorize(txn: TransactionRow): Promise<CategoryResult> {
    const koinkatAccountId = requireActiveKoinkatAccountId();
    const db = await getDb();

    const merchantNormalized = txn.merchant_normalized;
    const mcc = txn.merchant_category_code;

    // Pre-loop guard: when there's nothing to match on AT ALL (no
    // merchant, no MCC), jump straight to fallback so we don't burn
    // DB round-trips on stages that can't fire.
    if (!merchantNormalized && !mcc) {
      return fallbackByType(txn);
    }

    // Rule queries join `categories` and filter by type so an income
    // rule can never match an expense transaction (and vice versa).
    // Transfers never hit the rule stages.
    const txnTypeForRules =
      txn.type === 'income' || txn.type === 'expense' ? txn.type : null;

    const ctx: CategorizerContext = {
      txn,
      merchantNormalized,
      mcc,
      txnTypeForRules,
      koinkatAccountId,
      db,
    };

    for (const stage of STAGES) {
      const result = await stage.run(ctx);
      if (result !== null) return result;
    }
    // Unreachable: typeFallbackStage always returns non-null.
    return fallbackByType(txn);
  }

  async categorizeBatch(
    txnIds: string[],
  ): Promise<{ categorized: number; needsReview: number }> {
    if (txnIds.length === 0) return { categorized: 0, needsReview: 0 };

    const koinkatAccountId = requireActiveKoinkatAccountId();
    const db = await getDb();

    let categorized = 0;
    let needsReviewCount = 0;

    for (const id of txnIds) {
      const rows = await db.select<TransactionRow[]>(
        'SELECT * FROM transactions WHERE id = ? AND koinkat_account_id = ?',
        [id, koinkatAccountId],
      );
      if (rows.length === 0) continue;
      const txn = rows[0];

      let result: CategoryResult;
      try {
        result = await this.categorize(txn);
      } catch (err) {
        console.error(
          `[categorization] Failed to categorize ${id}:`,
          err,
        );
        continue;
      }

      const storageSource = storageSourceFromResult(result.source);
      await db.execute(
        `UPDATE transactions
            SET category_id = ?,
                categorization_source = ?,
                applied_rule_id = ?,
                needs_review = ?,
                updated_at = datetime('now')
          WHERE id = ? AND koinkat_account_id = ?`,
        [
          result.categoryId,
          storageSource,
          result.ruleId,
          result.needsReview ? 1 : 0,
          id,
          koinkatAccountId,
        ],
      );

      if (result.categoryId !== null) categorized++;
      if (result.needsReview) needsReviewCount++;

      // Audit log + rule stats
      if (result.ruleId) {
        await db.execute(
          `INSERT OR IGNORE INTO rule_applications
             (id, rule_id, transaction_id, applied_at)
           VALUES (?, ?, ?, datetime('now'))`,
          [crypto.randomUUID(), result.ruleId, id],
        );
        await db.execute(
          `UPDATE categorization_rules
              SET match_count = match_count + 1,
                  last_matched_at = datetime('now'),
                  updated_at = datetime('now')
            WHERE id = ? AND koinkat_account_id = ?`,
          [result.ruleId, koinkatAccountId],
        );
      }
    }

    return { categorized, needsReview: needsReviewCount };
  }

  async learnFromCorrection(params: {
    transactionId: string;
    newCategoryId: string;
    action: 'confirmed' | 'corrected';
    propagate: boolean;
  }): Promise<LearnResult> {
    const koinkatAccountId = requireActiveKoinkatAccountId();
    const db = await getDb();

    // Load the transaction
    const rows = await db.select<TransactionRow[]>(
      'SELECT * FROM transactions WHERE id = ? AND koinkat_account_id = ?',
      [params.transactionId, koinkatAccountId],
    );
    if (rows.length === 0) {
      return { kind: 'transaction_missing' };
    }
    const txn = rows[0];

    const merchantNormalized = txn.merchant_normalized;
    const confirmedSource: CategorizationSource =
      params.action === 'confirmed' ? 'user_confirmed' : 'user_corrected';

    // If there's no merchant to learn from (manual txn with no merchant
    // field, or a really ambiguous import), just update the transaction
    // and return - no rule to create, no retroactive pass.
    if (!merchantNormalized) {
      await db.execute(
        `UPDATE transactions
            SET category_id = ?,
                categorization_source = ?,
                needs_review = 0,
                confirmed_at = datetime('now'),
                updated_at = datetime('now')
          WHERE id = ?`,
        [params.newCategoryId, confirmedSource, params.transactionId],
      );
      return { kind: 'no_merchant' };
    }

    // Look up an existing learned/user exact-match rule for this merchant
    const existingRules = await db.select<
      {
        id: string;
        category_id: string;
        confidence: number;
        source: string;
      }[]
    >(
      `SELECT id, category_id, confidence, source
         FROM categorization_rules
        WHERE koinkat_account_id = ?
          AND match_field = 'merchant_normalized'
          AND match_type = 'exact'
          AND UPPER(match_pattern) = UPPER(?)
          AND source IN ('learned', 'user')
        ORDER BY priority ASC
        LIMIT 1`,
      [koinkatAccountId, merchantNormalized],
    );

    // Rule write + transaction update + audit trail + retroactive pass are
    // one atomic unit: a failure mid-way previously left a learned rule
    // pointing at the new category with the source transaction unchanged.
    return withTransaction(async (tx): Promise<LearnResult> => {
    let ruleId: string;
    let ruleCreated: boolean;
    if (existingRules.length > 0) {
      const existing = existingRules[0];
      if (existing.category_id === params.newCategoryId) {
        // Same category - strengthen the rule
        const nextConfidence = Math.min(1.0, existing.confidence + 0.1);
        await tx.execute(
          `UPDATE categorization_rules
              SET confidence = ?,
                  match_count = match_count + 1,
                  last_matched_at = datetime('now'),
                  updated_at = datetime('now')
            WHERE id = ? AND koinkat_account_id = ?`,
          [nextConfidence, existing.id, koinkatAccountId],
        );
      } else {
        // User changed their mind - reset confidence to 0.8 and point
        // at the new category.
        await tx.execute(
          `UPDATE categorization_rules
              SET category_id = ?,
                  confidence = 0.8,
                  last_matched_at = datetime('now'),
                  updated_at = datetime('now')
            WHERE id = ? AND koinkat_account_id = ?`,
          [params.newCategoryId, existing.id, koinkatAccountId],
        );
      }
      ruleId = existing.id;
      ruleCreated = false;
    } else {
      // No rule yet - create one.
      ruleId = crypto.randomUUID();
      await tx.execute(
        `INSERT INTO categorization_rules
           (id, koinkat_account_id, name, match_field, match_type,
            match_pattern, category_id, priority, is_active,
            source, confidence, match_count, last_matched_at)
         VALUES (?, ?, ?, 'merchant_normalized', 'exact',
                 ?, ?, 50, 1,
                 'learned', 0.9, 1, datetime('now'))`,
        [
          ruleId,
          koinkatAccountId,
          `Auto: ${merchantNormalized}`,
          merchantNormalized.toUpperCase(),
          params.newCategoryId,
        ],
      );
      ruleCreated = true;
    }

    // Update THIS transaction
    await tx.execute(
      `UPDATE transactions
          SET category_id = ?,
              categorization_source = ?,
              applied_rule_id = ?,
              needs_review = 0,
              confirmed_at = datetime('now'),
              updated_at = datetime('now')
        WHERE id = ? AND koinkat_account_id = ?`,
      [params.newCategoryId, confirmedSource, ruleId, params.transactionId, koinkatAccountId],
    );

    // Mark the original rule_application (if any) as correct/incorrect.
    // rule_applications has no koinkat_account_id column - scope through
    // the transactions table instead.
    await tx.execute(
      `UPDATE rule_applications
          SET was_correct = ?
        WHERE transaction_id = ?
          AND transaction_id IN (SELECT id FROM transactions WHERE koinkat_account_id = ?)`,
      [params.action === 'confirmed' ? 1 : 0, params.transactionId, koinkatAccountId],
    );

    // ── Retroactive re-categorization - the killer feature ──────
    //
    // Only runs when the caller passes `propagate: true` (the "Confirm
    // for all" button on the Review page). "Confirm" alone persists
    // the single transaction and the rule, but leaves other matching
    // rows untouched.
    //
    // Uses STRICT equality on `merchant_normalized`. The normalizer
    // (`src/domain/merchant.ts`) strips payment-wrapper prefixes like
    // "APPLE PAY" and returns null for wrapper-only strings, so two
    // rows share a normalized merchant iff they're from the same
    // real merchant. No fuzzy LIKE fallback - that caused
    // pathological false positives when `merchant_normalized` was
    // "APPLE PAY" for dozens of unrelated transactions.
    if (!params.propagate) {
      return { kind: 'learned', retroactiveUpdates: 0, ruleCreated };
    }

    // Select the affected ids first so the audit trail below covers exactly
    // the rows we touch. Two guards beyond the merchant match:
    //   - never overwrite a deliberate user choice (user_confirmed /
    //     user_corrected / user_manual rows are skipped - "Confirm for all"
    //     must not undo an earlier explicit correction);
    //   - never touch split repayment children (repayments stay out of
    //     categorization flows, same as every aggregation).
    const retroRows = await tx.select<{ id: string }[]>(
      `SELECT id FROM transactions
        WHERE koinkat_account_id = ?
          AND id != ?
          AND type IN ('income', 'expense')
          AND transfer_pair_id IS NULL
          AND (relation_kind IS NULL OR relation_kind != 'repayment')
          AND (categorization_source IS NULL
               OR categorization_source NOT IN
                  ('user_confirmed', 'user_corrected', 'user_manual'))
          AND merchant_normalized = ?`,
      [koinkatAccountId, params.transactionId, merchantNormalized],
    );

    if (retroRows.length === 0) {
      return { kind: 'learned', retroactiveUpdates: 0, ruleCreated };
    }

    await tx.execute(
      `UPDATE transactions
          SET category_id = ?,
              categorization_source = 'rule_auto',
              applied_rule_id = ?,
              needs_review = 0,
              updated_at = datetime('now')
        WHERE koinkat_account_id = ?
          AND id != ?
          AND type IN ('income', 'expense')
          AND transfer_pair_id IS NULL
          AND (relation_kind IS NULL OR relation_kind != 'repayment')
          AND (categorization_source IS NULL
               OR categorization_source NOT IN
                  ('user_confirmed', 'user_corrected', 'user_manual'))
          AND merchant_normalized = ?`,
      [
        params.newCategoryId,
        ruleId,
        koinkatAccountId,
        params.transactionId,
        merchantNormalized,
      ],
    );

    // Audit trail: rule_applications is what lets a later correction reverse
    // the retroactive propagation. UNIQUE(rule_id, transaction_id) makes the
    // insert idempotent.
    for (const row of retroRows) {
      await tx.execute(
        `INSERT OR IGNORE INTO rule_applications
           (id, rule_id, transaction_id, applied_at)
         VALUES (?, ?, ?, datetime('now'))`,
        [crypto.randomUUID(), ruleId, row.id],
      );
    }

    return { kind: 'learned', retroactiveUpdates: retroRows.length, ruleCreated };
    });
  }
}

async function fallbackByType(txn: TransactionRow): Promise<CategoryResult> {
  // Stage 4: always suggest a reasonable macro by transaction type so
  // the review queue never shows a blank suggestion. Confidence is low
  // (0.3) and `needsReview` is always true - the user is expected to
  // confirm or correct these.
  if (txn.type === 'income') {
    const otherIncome = await getSystemMacroByName('Other Income', 'income');
    return {
      categoryId: otherIncome?.id ?? null,
      confidence: 0.3,
      source: 'uncategorized',
      ruleId: null,
      needsReview: true,
    };
  }
  if (txn.type === 'expense') {
    const misc = await getSystemMacroByName('Miscellaneous', 'expense');
    return {
      categoryId: misc?.id ?? null,
      confidence: 0.3,
      source: 'uncategorized',
      ruleId: null,
      needsReview: true,
    };
  }
  // Transfers or unknown types - no suggestion.
  return {
    categoryId: null,
    confidence: 0,
    source: 'uncategorized',
    ruleId: null,
    needsReview: true,
  };
}

/* ── Singleton export ─────────────────────────────────────────────── */

/**
 * Default categorizer for the app. Swap this for an Ollama-backed
 * implementation later by replacing the right-hand side with an
 * `OllamaCategorizer` instance (must implement `TransactionCategorizer`).
 */
export const categorizer: TransactionCategorizer = new RuleBasedCategorizer();

/* ── Convenience: pending review count ───────────────────────────── */

export async function getPendingReviewCount(): Promise<number> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<{ cnt: number }[]>(
    `SELECT COUNT(*) AS cnt
       FROM transactions
      WHERE koinkat_account_id = ? AND needs_review = 1`,
    [koinkatAccountId],
  );
  return rows[0]?.cnt ?? 0;
}

/**
 * Reset every bank-imported (non-manual) income/expense transaction to
 * an uncategorized state. This clears category_id, categorization_source,
 * applied_rule_id, and confirmed_at, and puts them all back in the
 * review queue (needs_review = 1).
 *
 * Used as a one-shot "start from scratch" button: click this, then
 * click Re-categorize all to re-run the rule cascade against a clean
 * slate.
 *
 * Manual transactions (`categorization_source = 'user_manual'`) are
 * preserved - they have no merchant_normalized to match against, so
 * uncategorizing them would just orphan them permanently.
 *
 * Returns the count of transactions that were reset.
 */
export async function uncategorizeAll(fromDate?: string): Promise<number> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  // Optional lower date bound: only reset rows dated on/after `fromDate`,
  // so the user can re-review a recent slice without disturbing history.
  const dateClause = fromDate ? ' AND date >= ?' : '';
  return withTransaction(async (tx) => {
    const result = await tx.execute(
      `UPDATE transactions
          SET category_id = NULL,
              categorization_source = NULL,
              applied_rule_id = NULL,
              needs_review = 1,
              confirmed_at = NULL,
              updated_at = datetime('now')
        WHERE koinkat_account_id = ?
          AND type IN ('income', 'expense')
          AND transfer_pair_id IS NULL
          AND (
            categorization_source IS NULL
            OR categorization_source <> 'user_manual'
          )${dateClause}`,
      fromDate ? [koinkatAccountId, fromDate] : [koinkatAccountId],
    );

    // Also drop any rule_applications entries for those rows - they're
    // stale now that the rows are uncategorized. (CASCADE wouldn't catch
    // this because the transaction rows themselves still exist.)
    // The needs_review=1 subquery intentionally also catches rows that
    // were already in the review queue from prior imports - their stale
    // applications would otherwise survive the bulk uncategorize.
    await tx.execute(
      `DELETE FROM rule_applications
        WHERE transaction_id IN (
          SELECT id FROM transactions
           WHERE koinkat_account_id = ?
             AND needs_review = 1${dateClause}
        )`,
      fromDate ? [koinkatAccountId, fromDate] : [koinkatAccountId],
    );

    return result.rowsAffected ?? 0;
  });
}

/**
 * Re-derive `merchant_raw` + `merchant_normalized` for every
 * bank-imported income/expense transaction in the active workspace
 * using the current normalization logic. Runs at the start of
 * `recategorizeAll`, so clicking "Re-categorize all" automatically
 * picks up normalization improvements.
 *
 * What's different from just "fill in nulls":
 *   - Legacy rows where `merchant_normalized IS NULL` get populated
 *     from the stored `note` (which typically holds the bank's
 *     remittance info).
 *   - Rows where the old normalizer produced a wrapper-only result
 *     (e.g. "APPLE PAY") get re-normalized with the new logic,
 *     which strips wrappers and may fall back to `note` to recover
 *     the real merchant.
 *
 * Extraction strategy per row:
 *   1. Try `normalizeMerchantName(merchant_raw)` - the creditor/debtor
 *      name from the bank. If it yields a non-null string, use it.
 *   2. Otherwise try `normalizeMerchantName(note)` - the remittance
 *      info (or the raw creditor for legacy rows where note was
 *      built from creditor). If it yields a non-null string, use it
 *      AND update `merchant_raw` to the note so the UI displays
 *      something sensible.
 *   3. If both yield null (wrapper-only on both sides), leave
 *      `merchant_normalized` as null - the retro match won't group
 *      these rows, which is correct (we can't tell them apart).
 *
 * Skips `user_manual` transactions: those are created by the user
 * with a hand-typed note that isn't a merchant string.
 *
 * Returns the number of rows that were actually updated (rows where
 * the new normalized value differs from what's currently stored).
 */
export async function backfillMerchantNames(): Promise<number> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  const rows = await db.select<
    {
      id: string;
      merchant_raw: string | null;
      note: string | null;
      merchant_normalized: string | null;
    }[]
  >(
    `SELECT id, merchant_raw, note, merchant_normalized
       FROM transactions
      WHERE koinkat_account_id = ?
        AND type IN ('income', 'expense')
        -- mirrors TX_EXCLUDE_REPAYMENT (tx-sql.ts); inlined un-aliased because
        -- this query has no t-table alias. Keep the two in sync.
        AND (relation_kind IS NULL OR relation_kind != 'repayment')
        AND (merchant_raw IS NOT NULL OR note IS NOT NULL)
        AND (
          categorization_source IS NULL
          OR categorization_source <> 'user_manual'
        )`,
    [koinkatAccountId],
  );

  let updated = 0;
  for (const row of rows) {
    // 1. Try the stored merchant_raw first.
    let newNormalized = normalizeMerchantName(row.merchant_raw);
    let newRaw = row.merchant_raw;

    // 2. If that's null (or merchant_raw was null), try the note.
    if (newNormalized === null && row.note) {
      const fromNote = normalizeMerchantName(row.note);
      if (fromNote !== null) {
        newNormalized = fromNote;
        // Only overwrite merchant_raw if it's currently null - we
        // prefer keeping the bank's raw creditor string for display
        // when it exists.
        if (newRaw === null) newRaw = row.note;
      }
    }

    // 3. Skip writes where nothing changed (tiny optimization -
    //    keeps the backfill cheap when it runs repeatedly).
    if (
      newNormalized === row.merchant_normalized &&
      newRaw === row.merchant_raw
    ) {
      continue;
    }

    await db.execute(
      `UPDATE transactions
          SET merchant_raw = ?,
              merchant_normalized = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
      [newRaw, newNormalized, row.id],
    );
    updated++;
  }
  return updated;
}

/**
 * Manual backfill: re-run the categorization engine on every
 * bank-imported transaction the user hasn't explicitly touched.
 *
 * Skips (categorization is user-driven):
 *   - `user_manual`    - user created the transaction manually
 *   - `user_confirmed` - user accepted a suggestion in the review queue
 *   - `user_corrected` - user replaced a suggestion with a different category
 *
 * Processes (engine-driven or never-touched):
 *   - `categorization_source IS NULL`  - never ran through the engine
 *   - `rule_auto`                      - engine applied a rule (may now match a newer one)
 *   - `mcc_auto`                       - engine applied an MCC match
 *
 * Also skips:
 *   - transfers (no category)
 *   - confirmed transfer pairs (transfer_pair_id set)
 *
 * This is what you want to click ONCE after enabling the categorization
 * system on a pre-existing workspace. Going forward, bank-sync fires
 * `categorizeBatch` automatically on newly imported rows, so no manual
 * re-runs are needed.
 */
export async function recategorizeAll(): Promise<{
  processed: number;
  categorized: number;
  needsReview: number;
  backfilled: number;
}> {
  // Pre-v4 transactions were imported before `merchant_normalized`
  // existed, so the rule cascade has no input to match on them. Backfill
  // from `note` first so the rules can actually fire.
  const backfilled = await backfillMerchantNames();

  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<{ id: string }[]>(
    `SELECT id FROM transactions
      WHERE koinkat_account_id = ?
        AND type IN ('income', 'expense')
        AND transfer_pair_id IS NULL
        -- mirrors TX_EXCLUDE_REPAYMENT (tx-sql.ts); inlined un-aliased because
        -- this query has no t-table alias. Keep the two in sync.
        AND (relation_kind IS NULL OR relation_kind != 'repayment')
        AND (
          categorization_source IS NULL
          OR categorization_source IN ('rule_auto', 'mcc_auto')
        )`,
    [koinkatAccountId],
  );
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) {
    return { processed: 0, categorized: 0, needsReview: 0, backfilled };
  }

  const result = await categorizer.categorizeBatch(ids);
  return {
    processed: ids.length,
    categorized: result.categorized,
    needsReview: result.needsReview,
    backfilled,
  };
}
