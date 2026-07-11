import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ExternalLink, Plus, CheckCircle, Loader2, ArrowLeft } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { open } from '@tauri-apps/plugin-shell';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { InfoBanner } from '../components/ui/InfoBanner';
import { BankSetupGuide } from '../components/BankSetupGuide';
import { PageHeader } from '../components/layout/PageHeader';
import { useBankStore } from '../stores/bank-store';
import { loadApiConfig } from '../services/api-config-service';
import * as ebService from '../services/enable-banking-service';
import {
  handleAuthCallback,
  createPendingBankConnection,
  deletePendingBankConnection,
} from '../services/bank-sync-service';
import type { AspspEntry } from '../services/enable-banking-service';

const EU_COUNTRIES = [
  { value: 'IT', label: 'Italy' },
  { value: 'DK', label: 'Denmark' },
  { value: 'LT', label: 'Lithuania' },
  { value: 'DE', label: 'Germany' },
  { value: 'FR', label: 'France' },
  { value: 'ES', label: 'Spain' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'BE', label: 'Belgium' },
  { value: 'AT', label: 'Austria' },
  { value: 'PT', label: 'Portugal' },
  { value: 'FI', label: 'Finland' },
  { value: 'SE', label: 'Sweden' },
  { value: 'NO', label: 'Norway' },
  { value: 'IE', label: 'Ireland' },
  { value: 'PL', label: 'Poland' },
  { value: 'CZ', label: 'Czech Republic' },
  { value: 'RO', label: 'Romania' },
  { value: 'HU', label: 'Hungary' },
  { value: 'GR', label: 'Greece' },
  { value: 'BG', label: 'Bulgaria' },
  { value: 'HR', label: 'Croatia' },
  { value: 'SK', label: 'Slovakia' },
  { value: 'SI', label: 'Slovenia' },
  { value: 'LV', label: 'Latvia' },
  { value: 'EE', label: 'Estonia' },
  { value: 'LU', label: 'Luxembourg' },
  { value: 'MT', label: 'Malta' },
  { value: 'CY', label: 'Cyprus' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'CH', label: 'Switzerland' },
];

type Phase = 'select' | 'waiting' | 'code' | 'syncing' | 'done' | 'error';

// Mock-mode flag. When true, the Connect button skips the real OAuth
// handshake and feeds a canned code straight into handleAuthCallback so
// the fixture-backed mock service can serve up 3 months of transactions
// for end-to-end UI testing without talking to a real bank.
// On in demo builds, off in development by default, impossible in production.
const IS_MOCK_MODE = __KOINKAT_ALLOW_MOCKS__ && __KOINKAT_EB_MOCK_DEFAULT__;

// Maps the bank shown in the select list to the fixture code the mock
// createSession() recognises. Keyed as "name|country" so banks with the
// same name in different countries (rare, but possible) stay distinct.
const MOCK_CODE_MAP: Record<string, string> = {
  'FinecoBank|IT': 'mock-code-eur',
  'Nordea|DK': 'mock-code-dkk',
  'Barclays|GB': 'mock-code-gbp',
};

/**
 * User's chosen history window for the initial transaction sync.
 *   'max'    - 180 days, default, preserves the pre-feature behavior.
 *   'd30'    - last 30 days.
 *   'd90'    - last 90 days.
 *   'custom' - a user-picked ISO date in `customStartDate`.
 */
type SyncRange = 'max' | 'd30' | 'd90' | 'custom';

function todayIso(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function computeSyncStartDate(range: SyncRange, customStartDate: string): string | null {
  const today = new Date();
  switch (range) {
    case 'd30':
      return format(subDays(today, 30), 'yyyy-MM-dd');
    case 'd90':
      return format(subDays(today, 90), 'yyyy-MM-dd');
    case 'custom':
      return customStartDate || null;
    case 'max':
    default:
      return null;
  }
}

export function BankLink() {
  const navigate = useNavigate();
  const { isConfigured, loadConnections, connections } = useBankStore();
  const hasExistingConnections = connections.length > 0;

  const [country, setCountry] = useState('IT');
  const [banks, setBanks] = useState<AspspEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [guideOpen, setGuideOpen] = useState(false);

  // Sync-range selection state. Persists across phase transitions while
  // the component is mounted - user doesn't lose their choice if they
  // back out of the auth flow.
  const [syncRange, setSyncRange] = useState<SyncRange>('max');
  const [customStartDate, setCustomStartDate] = useState<string>(todayIso());

  // Auth flow state
  const [phase, setPhase] = useState<Phase>('select');
  const [authorizationId, setAuthorizationId] = useState<string | null>(null);
  const [authCode, setAuthCode] = useState('');
  const [syncResult, setSyncResult] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured) navigate('/settings');
  }, [isConfigured, navigate]);

  // Load banks when country changes
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await ebService.listBanks(country);
        if (!cancelled) setBanks(result);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load banks');
          setBanks([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (phase === 'select') load();
    return () => { cancelled = true; };
  }, [country, phase]);

  const filteredBanks = search
    ? banks.filter((b) => b.name.toLowerCase().includes(search.toLowerCase()))
    : banks;

  async function handleConnect(bank: AspspEntry) {
    setConnecting(bank.name);
    setError(null);

    // ── Mock mode ─────────────────────────────────────────────────────
    // Bypass the browser-open + code-paste handshake entirely. Resolve
    // a canned fixture code directly and drive handleAuthCallback with
    // it + whatever import floor the user picked above.
    if (IS_MOCK_MODE) {
      const mockCode = MOCK_CODE_MAP[`${bank.name}|${bank.country}`];
      if (!mockCode) {
        setError('No mock data available for this bank.');
        setConnecting(null);
        return;
      }
      try {
        // Synthesize an authId locally. We don't call the real
        // startAuthorization - there's no browser flow to drive, and
        // the mock service's signature doesn't mirror the real one
        // closely enough to round-trip this cleanly.
        const authId = `mock-auth-${bank.name.toLowerCase()}-${Date.now()}`;
        await createPendingBankConnection({
          bankName: bank.name,
          bankCountry: bank.country,
          authorizationId: authId,
        });
        setAuthorizationId(authId);
        setPhase('syncing');

        const syncStartDate = computeSyncStartDate(syncRange, customStartDate);
        const result = await handleAuthCallback(authId, mockCode, syncStartDate);
        await loadConnections();

        const imported = result.transactionsImported;
        const accts = result.accountsCreated;
        setSyncResult(
          imported === 0
            ? `Bank connected! ${accts} account${accts !== 1 ? 's' : ''} linked. Transactions will appear on the next sync.`
            : `Bank connected! ${accts} account${accts !== 1 ? 's' : ''} linked, ${imported} transaction${imported !== 1 ? 's' : ''} imported.`,
        );
        setPhase('done');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to run mock sync');
        setPhase('error');
      } finally {
        setConnecting(null);
      }
      return;
    }

    // ── Real OAuth path ──────────────────────────────────────────────
    try {
      const config = await loadApiConfig();
      if (!config.redirectUrl) {
        throw new Error('Redirect URL not configured. Set it in Settings → Bank credentials.');
      }
      // Enable Banking only accepts the redirect URI you registered on the
      // application page, which has to be https://. If the stored value is a
      // koinkat:// deep-link (the old form default), EB will reject the
      // /auth request with REDIRECT_URI_NOT_ALLOWED - pre-flight here so the
      // user gets an actionable error instead of a generic 400.
      if (!config.redirectUrl.startsWith('https://')) {
        throw new Error(
          `Enable Banking requires an https:// redirect URL, but the saved value is "${config.redirectUrl}". ` +
            `Open Settings > Bank credentials and set it to the URL you registered on Enable Banking.`,
        );
      }

      const { url, authorizationId: authId, state: oauthState } = await ebService.startAuthorization({
        bankName: bank.name,
        bankCountry: bank.country,
        redirectUrl: config.redirectUrl,
      });

      // Save pending connection (scoped to active koinkat account)
      await createPendingBankConnection({
        bankName: bank.name,
        bankCountry: bank.country,
        authorizationId: authId,
      });

      // Persist state for CSRF validation when the deep-link callback arrives.
      sessionStorage.setItem(
        'koinkat_oauth_state',
        JSON.stringify({ authId, state: oauthState }),
      );

      setAuthorizationId(authId);

      // Open bank auth in system browser
      await open(url);
      setPhase('waiting');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start authorization');
    } finally {
      setConnecting(null);
    }
  }

  // Ref so the deep-link auto-submit effect can fire exactly once after a
  // deep-link sets authCode (without re-triggering on subsequent edits).
  const pendingDeepLinkRef = useRef(false);

  const handleSubmitCode = useCallback(async () => {
    if (!authCode.trim() || !authorizationId) return;
    setPhase('syncing');
    setError(null);
    try {
      const syncStartDate = computeSyncStartDate(syncRange, customStartDate);
      const result = await handleAuthCallback(
        authorizationId,
        authCode.trim(),
        syncStartDate,
      );
      await loadConnections();
      const imported = result.transactionsImported;
      const accts = result.accountsCreated;
      if (imported === 0) {
        setSyncResult(
          `Bank connected! ${accts} account${accts !== 1 ? 's' : ''} linked. Transactions will appear on the next sync.`,
        );
      } else {
        setSyncResult(
          `Bank connected! ${accts} account${accts !== 1 ? 's' : ''} linked, ${imported} transaction${imported !== 1 ? 's' : ''} imported.`,
        );
      }
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete bank connection');
      setPhase('error');
    }
  }, [authCode, authorizationId, syncRange, customStartDate, loadConnections]);

  // Subscribe to the koinkat:// deep-link once. When the bank redirects back,
  // parse code + state, validate CSRF state, then trigger auto-submit.
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    async function subscribe() {
      const { onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
      unlisten = await onOpenUrl((urls) => {
        const urlStr = urls[0];
        if (!urlStr?.startsWith('koinkat://auth-callback')) return;

        let parsed: URL;
        try {
          parsed = new URL(urlStr);
        } catch {
          return;
        }

        const code = parsed.searchParams.get('code');
        const incomingState = parsed.searchParams.get('state');
        if (!code) return;

        const savedRaw = sessionStorage.getItem('koinkat_oauth_state');
        if (!savedRaw) {
          setError('No pending OAuth flow found. Please start the connection again.');
          setPhase('error');
          return;
        }

        let saved: { authId: string; state: string };
        try {
          saved = JSON.parse(savedRaw);
        } catch {
          setError('OAuth session data corrupted. Please try again.');
          setPhase('error');
          return;
        }

        // Validate the CSRF state unconditionally. A deep link that simply
        // OMITS the state parameter must be rejected too - otherwise a
        // crafted koinkat:// link without state would skip the check
        // entirely and proceed to the code exchange.
        if (!incomingState || incomingState !== saved.state) {
          sessionStorage.removeItem('koinkat_oauth_state');
          setError(
            incomingState
              ? 'OAuth state mismatch - possible CSRF attempt. Please try connecting again.'
              : 'OAuth callback was missing its security token - please try connecting again.',
          );
          setPhase('error');
          return;
        }

        sessionStorage.removeItem('koinkat_oauth_state');
        pendingDeepLinkRef.current = true;
        setAuthorizationId(saved.authId);
        setAuthCode(code);
        setPhase('code');
      });
    }

    // Dynamic import so the build doesn't fail in browser-only dev environments
    // where the Tauri plugin is unavailable.
    subscribe().catch(() => { /* deep-link unavailable outside Tauri shell */ });
    return () => { unlisten?.(); };
  }, []);

  // Auto-submit after a deep-link fills in authCode + authorizationId.
  // The pendingDeepLinkRef gate prevents this from firing on every
  // subsequent authCode edit; handleSubmitCode is stable via useCallback
  // and re-binds when its captured state (syncRange, customStartDate)
  // changes.
  useEffect(() => {
    if (!pendingDeepLinkRef.current) return;
    pendingDeepLinkRef.current = false;
    void handleSubmitCode();
  }, [authCode, handleSubmitCode]);

  function handleReset() {
    // Clean up the in-flight attempt's pending connection row - abandoned
    // attempts otherwise accumulate as dead "Status: pending" rows in
    // Settings forever (and falsely trigger the re-link banner).
    if (authorizationId) {
      void deletePendingBankConnection(authorizationId).catch(console.warn);
    }
    setPhase('select');
    setAuthorizationId(null);
    setAuthCode('');
    setSyncResult(null);
    setError(null);
  }

  // Small helper rendered at the top of every phase so the user always has
  // an escape hatch back to the dashboard.
  const BackToDashboard = () => (
    <button
      onClick={() => navigate('/')}
      className="flex items-center gap-1.5 text-sm mb-4 cursor-pointer transition-colors hover:opacity-80"
      style={{ color: 'var(--text-muted)' }}
    >
      <ArrowLeft size={16} />
      Back to dashboard
    </button>
  );

  // ── Phase: waiting for user to authorize in browser ───────────────────
  if (phase === 'waiting' || phase === 'code') {
    return (
      <div>
        <BackToDashboard />
        <div className="mb-6">
          <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
            Bank Connection
          </p>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text)', fontFamily: 'var(--font-head)' }}>
            Complete authorization
          </h1>
        </div>

        <Card className="max-w-2xl">
          <div className="flex flex-col gap-5 py-4">
            <div className="flex items-start gap-3">
              <div
                className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center mt-0.5"
                style={{ backgroundColor: 'var(--primary)', opacity: 0.15 }}
              >
                <ExternalLink size={16} style={{ color: 'var(--primary)' }} />
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                  Step 1: Authorize in your browser
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  A bank authorization page opened in your browser. Complete the login and 2FA there.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div
                className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center mt-0.5"
                style={{ backgroundColor: 'var(--primary)', opacity: 0.15 }}
              >
                <span className="text-xs font-bold" style={{ color: 'var(--primary)' }}>2</span>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium mb-2" style={{ color: 'var(--text)' }}>
                  Step 2: Paste the authorization code
                </p>
                <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                  After authorizing, you'll see a code on the callback page. Copy it and paste it here.
                </p>
                <Input
                  placeholder="Paste authorization code here..."
                  value={authCode}
                  onChange={(e) => {
                    setAuthCode(e.target.value);
                    if (phase === 'waiting') setPhase('code');
                  }}
                />
              </div>
            </div>

            {error && (
              <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>
            )}

            <div className="flex gap-3">
              <Button
                variant="primary"
                onClick={() => handleSubmitCode()}
                disabled={!authCode.trim()}
              >
                Connect & Sync
              </Button>
              <Button variant="ghost" onClick={handleReset}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // ── Phase: syncing ────────────────────────────────────────────────────
  if (phase === 'syncing') {
    return (
      <div>
        <div className="mb-6">
          <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
            Bank Connection
          </p>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text)', fontFamily: 'var(--font-head)' }}>
            Syncing...
          </h1>
        </div>
        <Card className="max-w-2xl">
          <div className="text-center py-8">
            <Loader2 size={40} className="mx-auto mb-4 animate-spin" style={{ color: 'var(--primary)' }} />
            <p className="text-sm" style={{ color: 'var(--text)' }}>
              Creating accounts and importing transactions...
            </p>
          </div>
        </Card>
      </div>
    );
  }

  // ── Phase: done ───────────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <div>
        <BackToDashboard />
        <div className="mb-6">
          <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
            Bank Connection
          </p>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text)', fontFamily: 'var(--font-head)' }}>
            Connected!
          </h1>
        </div>
        <Card className="max-w-2xl">
          <div className="text-center py-8">
            <CheckCircle size={40} className="mx-auto mb-4" style={{ color: 'var(--success)' }} />
            <p className="text-sm mb-6" style={{ color: 'var(--text)' }}>{syncResult}</p>
            <div className="flex justify-center gap-3">
              <Button variant="primary" onClick={() => navigate('/')}>Go to Dashboard</Button>
              <Button variant="secondary" onClick={handleReset}>Link another bank</Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // ── Phase: error ──────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div>
        <BackToDashboard />
        <div className="mb-6">
          <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
            Bank Connection
          </p>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text)', fontFamily: 'var(--font-head)' }}>
            Connection failed
          </h1>
        </div>
        <Card className="max-w-2xl">
          <div className="text-center py-8">
            {error && <p className="text-sm mb-6" style={{ color: 'var(--danger)' }}>{error}</p>}
            <div className="flex justify-center gap-3">
              {/* A mis-pasted code is the common failure here - the bank
                  authorization itself is usually still valid, so offer a
                  re-entry path that doesn't force a whole new OAuth + 2FA
                  round trip. */}
              {authorizationId && (
                <Button variant="primary" onClick={() => { setError(null); setPhase('code'); }}>
                  Re-enter code
                </Button>
              )}
              <Button
                variant={authorizationId ? 'secondary' : 'primary'}
                onClick={handleReset}
              >
                Start over
              </Button>
              <Button variant="ghost" onClick={() => navigate('/')}>Back to Dashboard</Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // ── Phase: select (default) ───────────────────────────────────────────
  return (
    <div>
      <BackToDashboard />
      <PageHeader
        label="Bank connection"
        title="Link a bank account"
        subtitle="Select your country and bank to connect via open banking."
      />

      <div className="max-w-2xl">
        {IS_MOCK_MODE && (
          <InfoBanner
            storageKey="koinkat.bankLinkMockModeDismissed"
            variant="warning"
            title="Mock mode active"
            className="mb-4"
          >
            No real bank connection will be made. Clicking Connect will load
            canned fixture data for FinecoBank (IT), Nordea (DK), or Barclays (GB)
            instead of contacting Enable Banking.
          </InfoBanner>
        )}
        <InfoBanner storageKey="koinkat.bankLinkInfoDismissed" className="mb-4">
          Before connecting a bank, you must first link it in the{' '}
          <button
            onClick={() => open('https://enablebanking.com/cp/applications')}
            className="underline cursor-pointer"
            style={{ color: 'var(--primary)' }}
          >
            Enable Banking Control Panel
          </button>
          . Go to your Control Panel &rarr; select your app &rarr; click "Activate by linking accounts" &rarr; authenticate with each bank you want to use. Only banks you've linked there will work here.{' '}
          New to Enable Banking?{' '}
          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            className="underline cursor-pointer"
            style={{ color: 'var(--primary)' }}
          >
            See the setup guide
          </button>
          .
        </InfoBanner>

        <SyncRangePicker
          range={syncRange}
          onRangeChange={setSyncRange}
          customStartDate={customStartDate}
          onCustomStartDateChange={setCustomStartDate}
          hasExistingConnections={hasExistingConnections}
        />

        <div className="flex gap-4 mb-4">
          <div className="w-48">
            <Select
              label="Country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              options={EU_COUNTRIES}
            />
          </div>
          <div className="flex-1">
            <Input
              label="Search banks"
              placeholder="Type to filter..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {error && (
          <Card className="mb-4">
            <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
          </Card>
        )}

        {loading ? (
          <Card>
            <p className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
              Loading available banks...
            </p>
          </Card>
        ) : filteredBanks.length === 0 ? (
          <Card>
            <p className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
              {banks.length === 0 ? 'No banks available for this country.' : 'No banks match your search.'}
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredBanks.map((bank) => (
              <Card key={`${bank.name}-${bank.country}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: 'var(--input-bg)' }}
                    >
                      <Building2 size={20} style={{ color: 'var(--text-muted)' }} />
                    </div>
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{bank.name}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{bank.country}</p>
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    onClick={() => handleConnect(bank)}
                    disabled={connecting !== null}
                  >
                    {connecting === bank.name ? 'Connecting...' : 'Connect'}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}

        <div className="mt-6 text-center">
          <button
            onClick={() => navigate('/accounts/create')}
            className="text-sm cursor-pointer"
            style={{ color: 'var(--text-muted)' }}
          >
            <Plus size={14} className="inline mr-1" />
            Or add an account manually
          </button>
        </div>
      </div>

      <BankSetupGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}

// ── Sync range picker ───────────────────────────────────────────────────

interface SyncRangePickerProps {
  range: SyncRange;
  onRangeChange: (r: SyncRange) => void;
  customStartDate: string;
  onCustomStartDateChange: (d: string) => void;
  hasExistingConnections: boolean;
}

function SyncRangePicker({
  range,
  onRangeChange,
  customStartDate,
  onCustomStartDateChange,
  hasExistingConnections,
}: SyncRangePickerProps) {
  const formattedStart = (() => {
    const startDate = computeSyncStartDate(range, customStartDate);
    if (!startDate) return null;
    try {
      return new Date(startDate).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return startDate;
    }
  })();

  return (
    <div className="mb-4">
      <p
        className="text-xs uppercase tracking-wider mb-2"
        style={{ color: 'var(--text-muted)' }}
      >
        How far back should we import?
      </p>
      <div
        className="rounded-lg p-3 flex flex-col gap-2"
        style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <RangeRadio
          checked={range === 'd30'}
          onChange={() => onRangeChange('d30')}
          label="Last 30 days"
        />
        <RangeRadio
          checked={range === 'd90'}
          onChange={() => onRangeChange('d90')}
          label="Last 90 days"
        />
        <RangeRadio
          checked={range === 'max'}
          onChange={() => onRangeChange('max')}
          label="Maximum history (180 days) - recommended default"
        />
        <div className="flex items-center gap-3">
          <RangeRadio
            checked={range === 'custom'}
            onChange={() => onRangeChange('custom')}
            label="From a specific date"
          />
          {range === 'custom' && (
            <input
              type="date"
              value={customStartDate}
              max={todayIso()}
              onChange={(e) => onCustomStartDateChange(e.target.value)}
              className="text-sm px-2 py-1 rounded"
              style={{
                backgroundColor: 'var(--input-bg)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
              }}
            />
          )}
        </div>
      </div>

      {hasExistingConnections && (
        <p
          className="mt-2 text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          <strong style={{ color: 'var(--text)' }}>Re-linking a bank you've used before?</strong>{' '}
          Your existing transactions and sync history are preserved automatically;
          the next sync will just pick up where it left off. The range above only
          applies to bank accounts you haven't connected before.
        </p>
      )}

      {range === 'max' ? (
        // Neutral expectation-setting, NOT a warning: this is the
        // pre-selected recommended option, and a banner arguing against the
        // recommended default left users unsure what to pick.
        <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          Heads-up: every imported transaction lands in your Review inbox
          until you categorize it, so expect a one-time sorting session.
          The classifier learns your merchants quickly - and you can always
          import less now and pull older history later from Settings.
        </p>
      ) : formattedStart ? (
        <p
          className="mt-2 text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          Transactions from <strong style={{ color: 'var(--text)' }}>{formattedStart}</strong>{' '}
          onward will be imported. Older bank history won't appear in Koinkat.
        </p>
      ) : null}
    </div>
  );
}

interface RangeRadioProps {
  checked: boolean;
  onChange: () => void;
  label: string;
}

function RangeRadio({ checked, onChange, label }: RangeRadioProps) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: 'var(--text)' }}>
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="cursor-pointer"
        style={{ accentColor: 'var(--primary)' }}
      />
      <span>{label}</span>
    </label>
  );
}
