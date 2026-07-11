import { describe, it, expect } from 'vitest';
import { cleanImportDescription } from './import-description';

describe('cleanImportDescription', () => {
  it('returns null for null / undefined / empty input', () => {
    expect(cleanImportDescription(null)).toBeNull();
    expect(cleanImportDescription(undefined)).toBeNull();
    expect(cleanImportDescription('')).toBeNull();
    expect(cleanImportDescription('   ')).toBeNull();
  });

  it('returns null when nothing is left after stripping (wallet-only input)', () => {
    expect(cleanImportDescription('APPLE PAY')).toBeNull();
    expect(cleanImportDescription('PAYPAL')).toBeNull();
    expect(cleanImportDescription('CONTACTLESS')).toBeNull();
  });

  it("strips the user's real-world reference example to just the merchant + location", () => {
    const raw =
      'PAGAMENTO APPLE PAY MASTERCARD NFC del 27/05/2026 CARTA *9110 DI EUR 8,99 WH SMITH AEROPUERTO AL ALTET, EL';
    const result = cleanImportDescription(raw);
    expect(result).not.toBeNull();
    const lower = (result ?? '').toLowerCase();
    // Merchant + location tail preserved.
    expect(lower).toContain('wh smith');
    expect(lower).toContain('aeropuerto');
    // All noise tokens gone.
    expect(lower).not.toContain('pagamento');
    expect(lower).not.toContain('apple pay');
    expect(lower).not.toContain('mastercard');
    expect(lower).not.toContain('nfc');
    expect(lower).not.toContain('del');
    expect(lower).not.toContain('27/05/2026');
    expect(lower).not.toContain('carta');
    expect(lower).not.toContain('*9110');
    expect(lower).not.toContain('9110');
    expect(lower).not.toContain('eur');
    expect(lower).not.toContain('8,99');
  });

  it('strips a RIF. reference and a pipe separator', () => {
    const raw = 'RIF. CONTRATTO 2024/118 | AFFITTO 01/2026';
    const result = cleanImportDescription(raw);
    expect(result).not.toBeNull();
    const lower = (result ?? '').toLowerCase();
    expect(lower).toContain('affitto');
    expect(lower).not.toContain('rif');
    expect(lower).not.toContain('contratto');
    expect(lower).not.toContain('2024/118');
    expect(lower).not.toContain('|');
  });

  it('keeps the merchant when a wallet is embedded ("APPLE PAY PIZZERIA DA GIGI")', () => {
    const result = cleanImportDescription('APPLE PAY PIZZERIA DA GIGI');
    expect(result).not.toBeNull();
    expect((result ?? '').toLowerCase()).toContain('pizzeria da gigi');
    expect((result ?? '').toLowerCase()).not.toContain('apple pay');
  });

  it('collapses multiple pipe separators into single spaces', () => {
    const result = cleanImportDescription(
      'STARBUCKS COFFEE | MILANO | RIF. 123',
    );
    expect(result).not.toBeNull();
    expect((result ?? '').toLowerCase()).toContain('starbucks coffee');
    expect((result ?? '').toLowerCase()).toContain('milano');
    expect((result ?? '').toLowerCase()).not.toContain('rif');
    expect(result).not.toMatch(/\|/);
  });

  it('strips PAN-length digit runs', () => {
    const result = cleanImportDescription('SOME MERCHANT 1234567890123456');
    expect(result).not.toBeNull();
    expect((result ?? '').toLowerCase()).toContain('some merchant');
    expect(result).not.toMatch(/1234567890123456/);
  });

  it('strips POS terminal noise without losing the merchant', () => {
    const result = cleanImportDescription(
      'CONTACTLESS PAYMENT STARBUCKS MILANO IT',
    );
    expect(result).not.toBeNull();
    expect((result ?? '').toLowerCase()).toContain('starbucks');
    expect((result ?? '').toLowerCase()).toContain('milano');
    expect((result ?? '').toLowerCase()).not.toContain('contactless');
  });

  it('strips amount patterns in EUR / USD / GBP', () => {
    expect(
      (cleanImportDescription('NETFLIX EUR 15,99') ?? '').toLowerCase(),
    ).not.toContain('eur');
    expect(
      (cleanImportDescription('SPOTIFY 9.99 USD') ?? '').toLowerCase(),
    ).not.toContain('usd');
    expect(
      (cleanImportDescription('RYANAIR DI GBP 49.99') ?? '').toLowerCase(),
    ).not.toContain('gbp');
  });

  it('strips bare dates (DD/MM/YYYY, DD-MM-YY, DD.MM.YYYY)', () => {
    for (const raw of [
      'COOP ITALIA 27/05/2026',
      'COOP ITALIA 27-05-26',
      'COOP ITALIA 27.5.2026',
    ]) {
      const result = cleanImportDescription(raw);
      expect((result ?? '').toLowerCase()).toContain('coop italia');
      expect(result).not.toMatch(/\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}/);
    }
  });
});
