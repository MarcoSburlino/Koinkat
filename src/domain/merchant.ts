/**
 * Merchant name normalization for consistent rule matching.
 *
 * Bank-provided merchant names are noisy: they contain POS terminal
 * prefixes, store numbers, dates, card terminal IDs, and city/country
 * suffixes. We need a deterministic normalization so that the same
 * merchant on different transactions collapses to the same key, which
 * is what lets `learnFromCorrection()` apply a learned rule
 * retroactively and reliably.
 *
 * This is a PURE function - no DB, no side effects. Unit-testable.
 */

/** POS / aggregator / e-wallet prefixes to strip from the start. */
const POS_PREFIXES = [
  'SQ *',      // Square
  'SQ*',       // Square (no space)
  'TST*',      // Toast
  'PP*',       // PayPal
  'PAYPAL *',
  'PAYPAL*',
  'GOOGLE *',
  'GOOGLE*',
  'AMZN ',     // Amazon
  'AMZN*',
  'CKE *',     // Carl's Jr.
  'IZ *',      // iZettle
  'IZ*',
  'SUMUP *',
  'SUMUP*',
];

/**
 * Payment processors / wallets that appear INSTEAD of the real merchant
 * name on many banks' transaction feeds. "APPLE PAY PIZZERIA DA GIGI"
 * should become "PIZZERIA DA GIGI"; "APPLE PAY" on its own should
 * become `null` (no usable merchant - can't be grouped).
 *
 * Matched anywhere in the string with word boundaries, so stripping
 * doesn't depend on where the wrapper appears.
 */
const PAYMENT_WRAPPERS = [
  'APPLE PAY',
  'GOOGLE PAY',
  'GPAY',
  'SAMSUNG PAY',
  'PAYPAL',
  'STRIPE',
  'SQUARE',
  'SUMUP',
  'IZETTLE',
  'REVOLUT PAY',
  'REVOLUT',
  'SATISPAY',       // Italian
  'NEXI',           // Italian processor
  'BANCOMAT PAY',   // Italian
  'ADYEN',
  'CONTACTLESS',
  'CARD PAYMENT',
  'POS',
  'DEBIT CARD',
  'CREDIT CARD',
];

/** European city suffixes frequently appended to POS strings. */
const CITY_SUFFIXES = [
  'ROMA',
  'MILANO',
  'TORINO',
  'NAPOLI',
  'FIRENZE',
  'BOLOGNA',
  'PARIS',
  'BERLIN',
  'MUNICH',
  'MUENCHEN',
  'MADRID',
  'BARCELONA',
  'LISBON',
  'LISBOA',
  'LONDON',
  'AMSTERDAM',
  'COPENHAGEN',
  'KOBENHAVN',
  'KØBENHAVN',
  'STOCKHOLM',
  'OSLO',
  'HELSINKI',
  'DUBLIN',
  'BRUSSELS',
  'WARSAW',
  'PRAGUE',
  'VIENNA',
  'ZURICH',
];

/** 2-letter ISO country codes often trailing POS strings. */
const COUNTRY_CODES = [
  'NL',
  'DE',
  'FR',
  'IT',
  'ES',
  'GB',
  'DK',
  'SE',
  'NO',
  'FI',
  'PT',
  'IE',
  'BE',
  'CH',
  'AT',
  'PL',
  'CZ',
];

const CITY_SUFFIX_REGEX = new RegExp(
  `\\s+(${CITY_SUFFIXES.map((c) => c.replace(/Ø/g, '[OØ]')).join('|')})(?:\\s|$)`,
  'gi',
);

const COUNTRY_CODE_REGEX = new RegExp(
  `\\s+(${COUNTRY_CODES.join('|')})\\s*$`,
  'g',
);

// Word-boundary regex that strips any payment-wrapper phrase anywhere
// in the string. Multi-word wrappers ("APPLE PAY") use `\s+` so any
// whitespace count matches. Global + case-insensitive so it removes
// every occurrence regardless of casing.
const WRAPPER_REGEX = new RegExp(
  `\\b(${PAYMENT_WRAPPERS.map((w) => w.replace(/ /g, '\\s+')).join('|')})\\b`,
  'gi',
);

const DATE_REGEX = /\b\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}\b/g;

const CARD_TERMINAL_REGEX = /\bC[Bb]\*\d+\b/g;

// Trailing store numbers: #1234 or a dangling 4+ digit number.
const TRAILING_STORE_NUMBER_REGEX = /[\s#]\d{4,}\s*$/;

// Keep letters (inc. accented À-ÿ), digits, and spaces. Drop everything else.
const PUNCTUATION_REGEX = /[^\p{L}\p{N}\s]/gu;

/**
 * Normalize a raw merchant name into a stable UPPERCASE key. Returns
 * `null` for empty / null input so callers can treat "no merchant" as
 * a distinct signal rather than an empty string.
 */
export function normalizeMerchantName(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;

  let s = raw.toUpperCase().trim();
  if (!s) return null;

  // 1. Strip leading POS / aggregator prefixes. We loop because a single
  //    merchant string can have multiple prefixes stacked (rare but
  //    cheap to guard against).
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const prefix of POS_PREFIXES) {
      const up = prefix.toUpperCase();
      if (s.startsWith(up)) {
        s = s.slice(up.length).trimStart();
        stripped = true;
      }
    }
  }

  // 2. Strip date patterns anywhere in the string.
  s = s.replace(DATE_REGEX, ' ');

  // 3. Strip card terminal ids like "CB*1234" / "Cb*7891".
  s = s.replace(CARD_TERMINAL_REGEX, ' ');

  // 4. Strip trailing store numbers (#1234 or space + digits).
  s = s.replace(TRAILING_STORE_NUMBER_REGEX, '');

  // 5. Strip European city suffixes. Repeat until stable - some strings
  //    end with "ROMA IT" which needs two passes.
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = s.replace(CITY_SUFFIX_REGEX, ' ').replace(COUNTRY_CODE_REGEX, '');
  }

  // 6. Strip payment-wrapper phrases (Apple Pay, Google Pay, PayPal, …)
  //    from anywhere in the string. Without this, "APPLE PAY PIZZERIA"
  //    would bucket with "APPLE PAY NETTO" on strict equality. Runs
  //    BEFORE punctuation removal so word boundaries still work.
  s = s.replace(WRAPPER_REGEX, ' ');

  // 7. Drop punctuation (keeps letters/digits/spaces, including accents).
  s = s.replace(PUNCTUATION_REGEX, ' ');

  // 8. Collapse whitespace.
  s = s.replace(/\s+/g, ' ').trim();

  // If what's left is literally a single short word that's itself a
  // wrapper (edge case: "NEXI" alone, no surrounding context), the
  // wrapper regex above already stripped it, so `s` is empty here.
  return s || null;
}
