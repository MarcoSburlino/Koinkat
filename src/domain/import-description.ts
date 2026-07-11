/**
 * Clean a bank-provided remittance / description string into something a
 * human wants to read.
 *
 * Italian banks (and most European PSD2 banks) ship the `note` channel
 * stuffed with payment-method noise: payment verbs, card networks, dates,
 * card numbers, amounts, reference codes. A real example from one user:
 *
 *   "PAGAMENTO APPLE PAY MASTERCARD NFC del 27/05/2026
 *    CARTA *9110 DI EUR 8,99 WH SMITH AEROPUERTO AL ALTET, EL"
 *
 * The useful part is "WH SMITH AEROPUERTO AL ALTET, EL" - everything
 * else is platform noise.
 *
 * This is a PURE function - no DB, no side effects, unit-testable.
 *
 * Acceptance: all the token classes listed below are stripped and
 * whitespace is collapsed. A residual location tail (e.g. "AEROPUERTO
 * AL ALTET, EL") is fine to keep - the future LLM categorizer stage
 * is meant to close that gap.
 */

// ── Token classes to strip ───────────────────────────────────────────

/** Payment verbs and POS-terminal noise. Whole-word, case-insensitive. */
const POS_NOISE = [
  'PAGAMENTO',
  'ADDEBITO',
  'ACQUISTO',
  'OPERAZIONE',
  'BONIFICO',
  'PAGOBANCOMAT',
  'BANCOMAT',
  'CONTACTLESS',
  'CARD PAYMENT',
  'DEBIT CARD',
  'CREDIT CARD',
  'POS',
  'CHIP & PIN',
  'CHIP AND PIN',
  'SWIPED',
];

/** Card networks. Whole-word, case-insensitive. */
const CARD_NETWORKS = [
  'MASTERCARD',
  'MAESTRO',
  'VISA',
  'AMERICAN EXPRESS',
  'AMEX',
  'NFC',
];

/**
 * Wallets / processors. Stripped when embedded in a larger string
 * ("APPLE PAY PIZZERIA DA GIGI" → "PIZZERIA DA GIGI"). When the wallet
 * is the WHOLE string (no merchant context), the final empty-check below
 * returns null so the caller can fall back to the creditor/debtor name.
 */
const WALLETS = [
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
  'SATISPAY',
  'NEXI',
  'BANCOMAT PAY',
  'ADYEN',
];

/** Build a single \b…\b alternation regex from a token list. */
function tokenRegex(tokens: string[]): RegExp {
  return new RegExp(
    `\\b(${tokens.map((t) => t.replace(/ /g, '\\s+')).join('|')})\\b`,
    'gi',
  );
}

const POS_NOISE_REGEX = tokenRegex(POS_NOISE);
const CARD_NETWORK_REGEX = tokenRegex(CARD_NETWORKS);
const WALLET_REGEX = tokenRegex(WALLETS);

/** Italian-style date prefix: "del 27/05/2026". */
const DATE_PREFIX_REGEX = /\bdel\s+\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}\b/gi;

/** Bare dates: 27/05/2026, 27-05-26, 27.5.2026. */
const BARE_DATE_REGEX = /\b\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}\b/g;

/**
 * Card reference patterns:
 *   "CARTA *9110", "CARTA 9110"
 *   "**** 9110" (masked PAN groups)
 *   A bare run of 13+ digits anywhere (PAN-length).
 */
const CARTA_REF_REGEX = /\bCARTA\s*\*?\d{2,}\b/gi;
const MASKED_PAN_REGEX = /\*{2,}\s*\d{2,}/g;
const PAN_DIGITS_REGEX = /\b\d{13,}\b/g;

/** Card terminal IDs like "CB*1234" / "Cb*7891". */
const CARD_TERMINAL_REGEX = /\bC[Bb]\*\d+\b/g;

/** Amount tokens: "DI EUR 8,99", "EUR 12.50", "12,50 EUR". */
const AMOUNT_REGEXES = [
  /\bDI\s+EUR\s+[\d.,]+/gi,
  /\bEUR\s+[\d.,]+/gi,
  /\b[\d.,]+\s+EUR\b/gi,
  /\bDI\s+USD\s+[\d.,]+/gi,
  /\bUSD\s+[\d.,]+/gi,
  /\b[\d.,]+\s+USD\b/gi,
  /\bDI\s+GBP\s+[\d.,]+/gi,
  /\bGBP\s+[\d.,]+/gi,
  /\b[\d.,]+\s+GBP\b/gi,
];

/**
 * Reference / auth code prefixes. The RIF / REF patterns extend across
 * whitespace-separated code-like tokens (uppercase letters, digits,
 * slashes) so something like "RIF. CONTRATTO 2024/118" matches as a
 * whole. The extension stops at the first non-code character - pipes
 * (the remittance separator) and punctuation act as natural barriers,
 * keeping legitimate words like "AFFITTO" past a `|` separator intact.
 */
const REFERENCE_REGEXES = [
  /\bRIF\.?\s*[A-Z0-9/]+(?:\s+[A-Z0-9/]+)*/gi,
  /\bREF\.?\s*[A-Z0-9/]+(?:\s+[A-Z0-9/]+)*/gi,
  /\bAUTH\.?\s*\d+/gi,
  /\bTRN\.?\s*\d+/gi,
  /\bAID\s*[A-F0-9]+/gi,
];

/** Title-Case a string, preserving short connector words. */
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) => {
      if (word.length === 0) return word;
      // Keep all-uppercase short tokens (likely codes / country codes) intact.
      if (i > 0 && word.length <= 2) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * Returns a cleaned, human-readable description, or `null` if cleaning
 * leaves nothing meaningful. Callers should fall back to creditor /
 * debtor name when this returns null.
 */
export function cleanImportDescription(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;

  let s = raw;

  // 1. Italian date prefix BEFORE bare dates so "del 27/05/2026" matches
  //    as a single unit (and the leftover doesn't read as just "del").
  s = s.replace(DATE_PREFIX_REGEX, ' ');

  // 2. Reference / auth codes (RIF., REF., AUTH., TRN., AID).
  for (const re of REFERENCE_REGEXES) s = s.replace(re, ' ');

  // 3. Card refs and masked PANs.
  s = s.replace(CARTA_REF_REGEX, ' ');
  s = s.replace(MASKED_PAN_REGEX, ' ');
  s = s.replace(CARD_TERMINAL_REGEX, ' ');
  s = s.replace(PAN_DIGITS_REGEX, ' ');

  // 4. Amount tokens.
  for (const re of AMOUNT_REGEXES) s = s.replace(re, ' ');

  // 5. Bare dates.
  s = s.replace(BARE_DATE_REGEX, ' ');

  // 6. POS verbs / contactless / card-payment noise.
  s = s.replace(POS_NOISE_REGEX, ' ');

  // 7. Card networks.
  s = s.replace(CARD_NETWORK_REGEX, ' ');

  // 8. Wallets / processors (Apple Pay, PayPal, etc.).
  s = s.replace(WALLET_REGEX, ' ');

  // 9. Pipe separators left over from `remittance_information.join(' | ')`.
  s = s.replace(/\s*\|\s*/g, ' ');

  // 10. Collapse whitespace.
  s = s.replace(/\s+/g, ' ').trim();

  if (!s) return null;

  // 11. Title-Case for readability ("WH SMITH AEROPUERTO" → "Wh Smith Aeropuerto").
  return titleCase(s);
}
