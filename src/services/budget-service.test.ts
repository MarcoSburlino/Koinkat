import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ────────────────────────────────────────────────────
//
// budget-service depends on Tauri's `@tauri-apps/plugin-sql` and on
// `requireActiveKoinkatAccountId` (reads from localStorage). Both are
// stubbed here so the tests run in a vanilla Node + vitest env without
// a real DB or browser globals.

vi.mock('../lib/active-koinkat-account', () => ({
  requireActiveKoinkatAccountId: vi.fn(() => 'ws-1'),
  getActiveKoinkatAccountId: vi.fn(() => 'ws-1'),
  setActiveKoinkatAccountId: vi.fn(),
  clearActiveKoinkatAccountId: vi.fn(),
}));

interface FakeDb {
  selects: Array<{ sql: string; params: unknown[]; rows: unknown[] }>;
  executes: Array<{ sql: string; params: unknown[]; rowsAffected: number }>;
  select: (sql: string, params?: unknown[]) => Promise<unknown>;
  execute: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rowsAffected: number; lastInsertId: number }>;
}

let fakeDb: FakeDb;

function resetFakeDb() {
  fakeDb = {
    selects: [],
    executes: [],
    async select(sql: string) {
      const next = fakeDb.selects.shift();
      if (!next) {
        throw new Error(`Unexpected select: ${sql.slice(0, 80)}`);
      }
      return next.rows;
    },
    async execute() {
      const next = fakeDb.executes.shift();
      const rowsAffected = next?.rowsAffected ?? 0;
      return { rowsAffected, lastInsertId: 0 };
    },
  };
}

vi.mock('../db/database', () => ({
  getDb: vi.fn(async () => fakeDb),
  withTransaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) =>
    fn(fakeDb),
  ),
}));

// Imports must come AFTER vi.mock calls.
import {
  applyAutoCaptureForEvent,
  applyAutoCaptureForTransaction,
} from './budget-service';

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    koinkat_account_id: 'ws-1',
    name: 'Trip',
    description: null,
    limit_amount: '1000.00',
    currency: 'EUR',
    is_expired: 0,
    start_date: '2026-03-10',
    end_date: '2026-03-15',
    sum_to_budget: 0,
    sum_to_month: null,
    manual_only: 0,
    auto_capture: 1,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function txnRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    type: 'expense',
    date: '2026-03-12',
    transfer_pair_id: null,
    relation_kind: null,
    event_link_pinned: 0,
    budget_event_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  resetFakeDb();
});

// ── applyAutoCaptureForEvent ──────────────────────────────────────

describe('applyAutoCaptureForEvent', () => {
  it('bails when the event does not exist', async () => {
    fakeDb.selects.push({ sql: 'SELECT * FROM budget_events', params: [], rows: [] });
    const result = await applyAutoCaptureForEvent('evt-x');
    expect(result).toEqual({ linked: 0, unlinked: 0 });
    expect(fakeDb.executes.length).toBe(0);
  });

  it('bails when auto_capture is 0', async () => {
    fakeDb.selects.push({
      sql: 'SELECT * FROM budget_events',
      params: [],
      rows: [eventRow({ auto_capture: 0 })],
    });
    const result = await applyAutoCaptureForEvent('evt-1');
    expect(result).toEqual({ linked: 0, unlinked: 0 });
    expect(fakeDb.executes.length).toBe(0);
  });

  it('bails when the event is expired', async () => {
    fakeDb.selects.push({
      sql: 'SELECT * FROM budget_events',
      params: [],
      rows: [eventRow({ is_expired: 1 })],
    });
    const result = await applyAutoCaptureForEvent('evt-1');
    expect(result).toEqual({ linked: 0, unlinked: 0 });
  });

  it('bails when the event has no dates', async () => {
    fakeDb.selects.push({
      sql: 'SELECT * FROM budget_events',
      params: [],
      rows: [eventRow({ start_date: null, end_date: null })],
    });
    const result = await applyAutoCaptureForEvent('evt-1');
    expect(result).toEqual({ linked: 0, unlinked: 0 });
  });

  it('runs both link and unlink sweeps when conditions are met', async () => {
    fakeDb.selects.push({
      sql: 'SELECT * FROM budget_events',
      params: [],
      rows: [eventRow()],
    });
    fakeDb.executes.push({ sql: 'link', params: [], rowsAffected: 4 });
    fakeDb.executes.push({ sql: 'unlink', params: [], rowsAffected: 2 });

    const result = await applyAutoCaptureForEvent('evt-1');
    expect(result).toEqual({ linked: 4, unlinked: 2 });
    expect(fakeDb.executes.length).toBe(0);
  });
});

// ── applyAutoCaptureForTransaction ────────────────────────────────

describe('applyAutoCaptureForTransaction', () => {
  it('returns null when the transaction does not exist', async () => {
    fakeDb.selects.push({ sql: 'SELECT id...', params: [], rows: [] });
    const result = await applyAutoCaptureForTransaction('tx-x');
    expect(result).toBeNull();
  });

  it('returns null when the row is pinned', async () => {
    fakeDb.selects.push({
      sql: 'SELECT id...',
      params: [],
      rows: [txnRow({ event_link_pinned: 1 })],
    });
    const result = await applyAutoCaptureForTransaction('tx-1');
    expect(result).toBeNull();
  });

  it('returns null for transfers', async () => {
    fakeDb.selects.push({
      sql: 'SELECT id...',
      params: [],
      rows: [txnRow({ type: 'transfer' })],
    });
    expect(await applyAutoCaptureForTransaction('tx-1')).toBeNull();
  });

  it('returns null for split-pair rows', async () => {
    fakeDb.selects.push({
      sql: 'SELECT id...',
      params: [],
      rows: [txnRow({ transfer_pair_id: 'tp-1' })],
    });
    expect(await applyAutoCaptureForTransaction('tx-1')).toBeNull();
  });

  it('returns null for repayments', async () => {
    fakeDb.selects.push({
      sql: 'SELECT id...',
      params: [],
      rows: [txnRow({ relation_kind: 'repayment' })],
    });
    expect(await applyAutoCaptureForTransaction('tx-1')).toBeNull();
  });

  it('returns null when the row is already linked to an event', async () => {
    fakeDb.selects.push({
      sql: 'SELECT id...',
      params: [],
      rows: [txnRow({ budget_event_id: 'evt-other' })],
    });
    expect(await applyAutoCaptureForTransaction('tx-1')).toBeNull();
  });

  it('returns null when no matching event covers the date', async () => {
    fakeDb.selects.push({
      sql: 'SELECT id...',
      params: [],
      rows: [txnRow()],
    });
    fakeDb.selects.push({
      sql: 'SELECT id FROM budget_events...',
      params: [],
      rows: [],
    });
    expect(await applyAutoCaptureForTransaction('tx-1')).toBeNull();
  });

  it('links the row to the shortest matching event and returns its id', async () => {
    fakeDb.selects.push({
      sql: 'SELECT id...',
      params: [],
      rows: [txnRow()],
    });
    fakeDb.selects.push({
      sql: 'SELECT id FROM budget_events...',
      params: [],
      rows: [{ id: 'evt-trip' }],
    });
    fakeDb.executes.push({ sql: 'UPDATE transactions', params: [], rowsAffected: 1 });

    const result = await applyAutoCaptureForTransaction('tx-1');
    expect(result).toBe('evt-trip');
    expect(fakeDb.executes.length).toBe(0);
  });
});
