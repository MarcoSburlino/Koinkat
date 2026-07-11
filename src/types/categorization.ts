/**
 * Types and interfaces for the transaction categorization engine.
 *
 * The `TransactionCategorizer` interface is the LLM swap point: Phase 5
 * ships a `RuleBasedCategorizer` that implements it with deterministic
 * rules, and later an `OllamaCategorizer` (local LLM) can implement the
 * same interface. A pipeline can chain them - rules first, LLM for the
 * leftovers.
 */

import type { TransactionRow } from './models';

export type CategoryResultSource =
  | 'user_exact'     // Stage 1: priority 10 rule (user-created)
  | 'user_rule'      // Stage 2: priority 30 rule (user prefix/contains)
  | 'learned'        // Stage 1 or 2: learned from user correction
  | 'mcc'            // Stage 3: MCC code lookup
  | 'uncategorized'; // Stage 4 (income default) or Stage 5 (nothing matched)

export interface CategoryResult {
  /** Resolved category id (may point at macro OR subcategory). */
  categoryId: string | null;
  /** 0.0-1.0 - how confident the engine is in this assignment. */
  confidence: number;
  /** Which stage of the cascade produced this result. */
  source: CategoryResultSource;
  /** The rule that matched, if any (populated for Stage 1/2). */
  ruleId: string | null;
  /**
   * True when the result should go to the review queue. Stage 1 matches
   * with high confidence can skip review; MCC and low-confidence rules
   * always route to review.
   */
  needsReview: boolean;
}

/**
 * Discriminated outcome of `learnFromCorrection`. Lets the UI render a
 * toast that ACCURATELY describes what happened - the older
 * `{ retroactiveUpdates: number }` shape collapsed three distinct paths
 * (transaction missing, no merchant to learn from, legitimately no
 * matches) into the same "0" value, so the user couldn't tell whether a
 * rule had been saved or not.
 */
export type LearnResult =
  | {
      kind: 'learned';
      /** Number of OTHER transactions retroactively updated. */
      retroactiveUpdates: number;
      /** True when a brand-new rule was inserted; false when an existing rule was strengthened/repointed. */
      ruleCreated: boolean;
    }
  | {
      /** Transaction has no normalized merchant - the row was updated but no rule was saved and the retroactive pass was skipped. */
      kind: 'no_merchant';
    }
  | {
      /** Transaction id wasn't found in the active workspace - nothing was updated. */
      kind: 'transaction_missing';
    };

/**
 * A single step in the categorization pipeline. Each stage looks at the
 * transaction (plus a small shared context) and either returns a
 * `CategoryResult` to short-circuit the cascade, or `null` to defer to
 * the next stage. The terminal stage must always return non-null.
 *
 * This is the seam where a future LLM categorizer plugs in: insert a
 * new stage between the deterministic rule stages and the type-fallback
 * stage, no rewrite required.
 */
export interface CategorizerStage<Ctx = unknown> {
  readonly name: string;
  run(ctx: Ctx): Promise<CategoryResult | null>;
}

/**
 * The categorization interface. Implementations must be pure wrt. their
 * `categorize` method (no persistence - that's `categorizeBatch`'s job)
 * so they can be composed in a pipeline without side effects.
 */
export interface TransactionCategorizer {
  /**
   * Compute a categorization result for a single transaction row WITHOUT
   * persisting anything. Used by Phase 5's `categorizeBatch` internally
   * and by test/debug code that wants a dry run.
   */
  categorize(txn: TransactionRow): Promise<CategoryResult>;

  /**
   * Iterate over a batch of transaction ids, run `categorize` on each,
   * and persist the results (category_id, categorization_source,
   * applied_rule_id, needs_review, rule_applications audit row).
   *
   * Returns the number of transactions that were successfully
   * categorized (non-null `categoryId`), so callers can display a
   * "Imported N transactions, auto-categorized M" notification.
   */
  categorizeBatch(txnIds: string[]): Promise<{ categorized: number; needsReview: number }>;

  /**
   * React to a user's confirm/correct action on a specific transaction:
   *   1. Update the transaction row with the user's chosen category.
   *   2. Insert or refresh a learned rule for the transaction's merchant
   *      (the rule applies to future bank imports regardless of the
   *      `propagate` flag).
   *   3. If `propagate` is true, RETROACTIVELY re-categorize every
   *      other transaction whose merchant matches - the "Pizzeria da
   *      Gigi effect". If false, only the single transaction is
   *      updated; existing matching rows stay in the review queue.
   */
  learnFromCorrection(params: {
    transactionId: string;
    newCategoryId: string;
    action: 'confirmed' | 'corrected';
    propagate: boolean;
  }): Promise<LearnResult>;
}
