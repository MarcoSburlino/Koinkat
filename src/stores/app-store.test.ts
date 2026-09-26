import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pages reload when `dataVersion` moves, and the Review badge reads the two
// counts. Both services are replaced by stubs: the test is about the store.
const { counts } = vi.hoisted(() => ({ counts: { review: 3, transfers: 2 } }));

vi.mock('../services/categorization-service', () => ({
  getPendingReviewCount: vi.fn(async () => counts.review),
}));
vi.mock('../services/transfer-detection-service', () => ({
  getTransferSuggestionCount: vi.fn(async () => counts.transfers),
}));

import { useAppStore } from './app-store';
import { getTransferSuggestionCount } from '../services/transfer-detection-service';

beforeEach(() => {
  counts.review = 3;
  counts.transfers = 2;
  useAppStore.setState({ dataVersion: 0, pendingReviewCount: 0, transferSuggestionCount: 0 });
  vi.clearAllMocks();
});

describe('notifyDataChanged', () => {
  it('bumps the data version once per call', () => {
    useAppStore.getState().notifyDataChanged();
    useAppStore.getState().notifyDataChanged();
    expect(useAppStore.getState().dataVersion).toBe(2);
  });

  it('refreshes the review count and the transfer suggestion count', async () => {
    useAppStore.getState().notifyDataChanged();
    await vi.waitFor(() => {
      expect(useAppStore.getState().pendingReviewCount).toBe(3);
      expect(useAppStore.getState().transferSuggestionCount).toBe(2);
    });
    expect(getTransferSuggestionCount).toHaveBeenCalledWith(
      useAppStore.getState().settings.preferredCurrency,
    );
  });

  it('keeps the review count when only the suggestion count fails', async () => {
    vi.mocked(getTransferSuggestionCount).mockRejectedValueOnce(new Error('no workspace'));
    await useAppStore.getState().refreshPendingReviewCount();
    expect(useAppStore.getState().pendingReviewCount).toBe(3);
    expect(useAppStore.getState().transferSuggestionCount).toBe(0);
  });
});
