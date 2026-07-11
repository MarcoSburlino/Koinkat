import { describe, it, expect, vi } from 'vitest';
import {
  STAGES,
  exactMerchantRuleStage,
  fuzzyMerchantRuleStage,
  mccLookupStage,
  typeFallbackStage,
  type CategorizerContext,
} from './categorization-service';
import type { TransactionRow } from '../types/models';

// ── Test scaffolding ────────────────────────────────────────────────

function makeTxn(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 'txn-1',
    account_id: 'acct-1',
    destination_account_id: null,
    related_transaction_id: null,
    type: 'expense',
    amount: '10.00',
    currency: 'EUR',
    exchange_rate: '1.0000',
    amount_in_account_ccy: '10.00',
    amount_in_dest_ccy: null,
    category_id: null,
    note: null,
    date: '2026-03-01',
    is_budgeted: 1,
    budget_event_id: null,
    recorded_at: '',
    created_at: '',
    updated_at: '',
    transfer_pair_id: null,
    transfer_reviewed_at: null,
    categorization_source: null,
    applied_rule_id: null,
    needs_review: 1,
    confirmed_at: null,
    merchant_raw: null,
    merchant_normalized: null,
    merchant_category_code: null,
    split_status: null,
    relation_kind: null,
    net_spent_in_account_ccy: null,
    source_description: null,
    booking_date: null,
    event_link_pinned: 0,
    status: 'booked',
    bank_transaction_id: null,
    pending_last_seen_at: null,
    pending_fingerprint: null,
    recurring_series_id: null,
    recurring_locked: 0,
    ...overrides,
  };
}

/**
 * Build a tiny fake DB that returns the rows it's seeded with for the
 * next .select() call. We can't import Tauri's sql plugin in a unit
 * test, so the type is intentionally cast - we only exercise the
 * shape categorize() relies on (`.select<T>(sql, params) → Promise<T>`).
 */
function fakeDb(selectImpl: (sql: string) => unknown[]) {
  return {
    select: vi.fn(async (sql: string, _params?: unknown[]) => selectImpl(sql)),
    execute: vi.fn(async () => ({ rowsAffected: 0, lastInsertId: 0 })),
  } as unknown as CategorizerContext['db'];
}

function ctxFor(
  txn: TransactionRow,
  db: CategorizerContext['db'],
): CategorizerContext {
  return {
    txn,
    merchantNormalized: txn.merchant_normalized,
    mcc: txn.merchant_category_code,
    txnTypeForRules:
      txn.type === 'income' || txn.type === 'expense' ? txn.type : null,
    koinkatAccountId: 'ws-1',
    db,
  };
}

// ── STAGES shape / ordering ─────────────────────────────────────────

describe('STAGES cascade', () => {
  it('preserves the documented stage order', () => {
    expect(STAGES.map((s) => s.name)).toEqual([
      'exactMerchantRule',
      'fuzzyMerchantRule',
      'mccLookup',
      'typeFallback',
    ]);
  });

  it('terminal stage always returns a non-null CategoryResult', async () => {
    // typeFallback short-circuits on transfers too - make sure it
    // returns something so the for-loop can always terminate.
    const result = await typeFallbackStage.run(
      ctxFor(makeTxn({ type: 'transfer' }), fakeDb(() => [])),
    );
    expect(result).not.toBeNull();
  });
});

// ── exactMerchantRule ───────────────────────────────────────────────

describe('exactMerchantRuleStage', () => {
  it('returns null when there is no normalized merchant', async () => {
    const txn = makeTxn({ merchant_normalized: null });
    const result = await exactMerchantRuleStage.run(
      ctxFor(txn, fakeDb(() => [])),
    );
    expect(result).toBeNull();
  });

  it('returns null when the transaction is a transfer', async () => {
    const txn = makeTxn({
      type: 'transfer',
      merchant_normalized: 'STARBUCKS',
    });
    const result = await exactMerchantRuleStage.run(
      ctxFor(txn, fakeDb(() => [])),
    );
    expect(result).toBeNull();
  });

  it('returns user_exact source when the rule was authored by a user', async () => {
    const txn = makeTxn({ merchant_normalized: 'STARBUCKS' });
    const db = fakeDb(() => [
      {
        id: 'r-1',
        category_id: 'cat-food',
        confidence: 1.0,
        source: 'user',
      },
    ]);
    const result = await exactMerchantRuleStage.run(ctxFor(txn, db));
    expect(result).toEqual({
      categoryId: 'cat-food',
      confidence: 1.0,
      source: 'user_exact',
      ruleId: 'r-1',
      needsReview: false,
    });
  });

  it('returns learned source for non-user rules and flags review when confidence < 0.9', async () => {
    const txn = makeTxn({ merchant_normalized: 'STARBUCKS' });
    const db = fakeDb(() => [
      {
        id: 'r-2',
        category_id: 'cat-food',
        confidence: 0.85,
        source: 'learned',
      },
    ]);
    const result = await exactMerchantRuleStage.run(ctxFor(txn, db));
    expect(result?.source).toBe('learned');
    expect(result?.needsReview).toBe(true);
  });
});

// ── fuzzyMerchantRule ───────────────────────────────────────────────

describe('fuzzyMerchantRuleStage', () => {
  it('matches contains rules anywhere in the merchant', async () => {
    const txn = makeTxn({ merchant_normalized: 'RYANAIR DUBLIN' });
    const db = fakeDb(() => [
      {
        id: 'r-travel',
        match_type: 'contains',
        match_pattern: 'RYANAIR',
        category_id: 'cat-travel',
        confidence: 0.7,
      },
    ]);
    const result = await fuzzyMerchantRuleStage.run(ctxFor(txn, db));
    expect(result?.categoryId).toBe('cat-travel');
    expect(result?.source).toBe('user_rule');
    expect(result?.needsReview).toBe(true); // 0.7 < 0.8
  });

  it('matches prefix rules only at the start of the merchant', async () => {
    const txnHit = makeTxn({ merchant_normalized: 'AIRPORT EXPRESS' });
    const txnMiss = makeTxn({ merchant_normalized: 'LONDON AIRPORT' });
    const db = fakeDb(() => [
      {
        id: 'r-pref',
        match_type: 'prefix',
        match_pattern: 'AIRPORT',
        category_id: 'cat-travel',
        confidence: 0.7,
      },
    ]);
    const hit = await fuzzyMerchantRuleStage.run(ctxFor(txnHit, db));
    expect(hit?.categoryId).toBe('cat-travel');

    const miss = await fuzzyMerchantRuleStage.run(ctxFor(txnMiss, db));
    expect(miss).toBeNull();
  });

  it('returns null when no rule matches', async () => {
    const txn = makeTxn({ merchant_normalized: 'UNKNOWN MERCHANT' });
    const db = fakeDb(() => [
      {
        id: 'r-x',
        match_type: 'contains',
        match_pattern: 'SOMETHING ELSE',
        category_id: 'cat-x',
        confidence: 0.7,
      },
    ]);
    const result = await fuzzyMerchantRuleStage.run(ctxFor(txn, db));
    expect(result).toBeNull();
  });

  it('skips when the transaction is a transfer', async () => {
    const txn = makeTxn({
      type: 'transfer',
      merchant_normalized: 'RYANAIR DUBLIN',
    });
    const db = fakeDb(() => [
      {
        id: 'r-travel',
        match_type: 'contains',
        match_pattern: 'RYANAIR',
        category_id: 'cat-travel',
        confidence: 0.7,
      },
    ]);
    const result = await fuzzyMerchantRuleStage.run(ctxFor(txn, db));
    expect(result).toBeNull();
  });
});

// ── mccLookup ───────────────────────────────────────────────────────

describe('mccLookupStage', () => {
  it('returns the mapped category with confidence 0.6 and needsReview=true', async () => {
    const txn = makeTxn({ merchant_category_code: '5411' });
    const db = fakeDb(() => [{ category_id: 'cat-groceries' }]);
    const result = await mccLookupStage.run(ctxFor(txn, db));
    expect(result).toEqual({
      categoryId: 'cat-groceries',
      confidence: 0.6,
      source: 'mcc',
      ruleId: null,
      needsReview: true,
    });
  });

  it('returns null when MCC is missing', async () => {
    const txn = makeTxn({ merchant_category_code: null });
    const result = await mccLookupStage.run(ctxFor(txn, fakeDb(() => [])));
    expect(result).toBeNull();
  });
});
