import { useState, useEffect } from 'react';
import { Copy, Check } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { useClipboard } from '../hooks/useClipboard';

export interface BankSetupGuideProps {
  open: boolean;
  onClose: () => void;
}

// ── Internal: shell command display with copy button ──────────────────────

function CodeBlock({ code }: { code: string }) {
  const { copied, copy } = useClipboard();
  return (
    <div
      className="relative mt-3"
      style={{
        backgroundColor: 'var(--surface-alt)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-2)',
        padding: '10px 40px 10px 12px',
      }}
    >
      <pre
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-caption)',
          color: 'var(--text)',
          lineHeight: '1.6',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          margin: 0,
        }}
      >
        {code}
      </pre>
      <button
        type="button"
        onClick={() => copy(code)}
        className="absolute top-2 right-2 p-1 rounded cursor-pointer transition-opacity hover:opacity-70"
        style={{ color: copied ? 'var(--success)' : 'var(--text-muted)' }}
        aria-label={copied ? 'Copied' : 'Copy to clipboard'}
        title={copied ? 'Copied!' : 'Copy to clipboard'}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

// ── Step definitions ──────────────────────────────────────────────────────

interface Step {
  title: string;
  content: React.ReactNode;
}

const STEPS: Step[] = [
  // ── Step 1 ────────────────────────────────────────────────────────────
  {
    title: 'Create an Enable Banking account',
    content: (
      <>
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
          Enable Banking is the PSD2 service Koinkat uses to connect to European banks. You
          need a free account before you can register an application.
        </p>
        <ol className="list-decimal list-inside flex flex-col gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <li>
            Go to{' '}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-caption)', color: 'var(--text)' }}>
              enablebanking.com/sign-in/
            </span>{' '}
            and enter your email address.
          </li>
          <li>
            Open the one-time authentication link Enable Banking emails you - there is no
            password. Your account is created automatically on first sign-in.
          </li>
        </ol>
      </>
    ),
  },

  // ── Step 2 ────────────────────────────────────────────────────────────
  {
    title: 'Register an application in the Control Panel',
    content: (
      <>
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
          An "application" in Enable Banking is the container for your credentials: its ID and
          your key identify Koinkat to the API. Registration is a single form that also asks
          for the key and the redirect URL - the next steps cover what to put in each field.
        </p>
        <ol className="list-decimal list-inside flex flex-col gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <li>
            Open the <strong style={{ color: 'var(--text)' }}>Control Panel</strong> at{' '}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-caption)', color: 'var(--text)' }}>
              enablebanking.com/cp/
            </span>{' '}
            and go to the <strong style={{ color: 'var(--text)' }}>API applications</strong> page.
          </li>
          <li>Register a new application and give it a name - e.g. "Koinkat personal".</li>
          <li>
            Choose the <strong style={{ color: 'var(--text)' }}>Production</strong> environment
            for real banks. (Sandbox is Enable Banking's test environment with mock banks - pick
            it only to try Koinkat without real accounts.)
          </li>
        </ol>
      </>
    ),
  },

  // ── Step 3 - exact OpenSSL commands verified ──────────────────────────
  {
    title: 'Generate the RS256 key pair',
    content: (
      <>
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
          Enable Banking uses RS256 to authenticate your API requests. Run these two commands in a
          terminal to generate a 2048-bit private key and the matching public key.
        </p>
        <CodeBlock code="openssl genpkey -algorithm RSA -out private.pem -pkeyopt rsa_keygen_bits:2048" />
        <CodeBlock code="openssl rsa -in private.pem -pubout -out public.pem" />
        <p className="text-sm mt-4" style={{ color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--text)' }}>private.pem</strong> stays on your machine
          - never share or upload it.{' '}
          <strong style={{ color: 'var(--text)' }}>public.pem</strong> is what you upload to
          Enable Banking in the next step.
        </p>
      </>
    ),
  },

  // ── Step 4 ────────────────────────────────────────────────────────────
  {
    title: 'Upload the public key to Enable Banking',
    content: (
      <>
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
          The registration form asks how to handle the application's key. Both options work
          with Koinkat:
        </p>
        <ol className="list-decimal list-inside flex flex-col gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <li>
            <strong style={{ color: 'var(--text)' }}>Provide your own key</strong>: pick the
            option to supply a public key and paste the full contents of the{' '}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-caption)', color: 'var(--text)' }}>
              public.pem
            </span>{' '}
            you generated in the previous step.
          </li>
          <li>
            <strong style={{ color: 'var(--text)' }}>Or let the browser generate one</strong>:
            the private key is created locally (it is not transmitted) and downloads as{' '}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-caption)', color: 'var(--text)' }}>
              {'<application-id>'}.pem
            </span>{' '}
            - keep that file; you will hand it to Koinkat instead of private.pem.
          </li>
        </ol>
      </>
    ),
  },

  // ── Step 5 ────────────────────────────────────────────────────────────
  {
    title: 'Locate your application ID',
    content: (
      <>
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
          Koinkat needs your application ID - a UUID assigned at registration - to identify
          your app when making API requests.
        </p>
        <ol className="list-decimal list-inside flex flex-col gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <li>
            In the Control Panel, go to <strong style={{ color: 'var(--text)' }}>Applications</strong> and
            open your app.
          </li>
          <li>
            Look for a field labelled <strong style={{ color: 'var(--text)' }}>Application ID</strong> or{' '}
            <strong style={{ color: 'var(--text)' }}>App ID</strong>. It's a UUID in the format:{' '}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-caption)', color: 'var(--text)' }}>
              xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
            </span>
          </li>
          <li>Copy this value - you'll paste it into Koinkat in step 7.</li>
        </ol>
      </>
    ),
  },

  // ── Step 6 ────────────────────────────────────────────────────────────
  {
    title: 'Activate your application',
    content: (
      <>
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
          There is no per-bank setup: once your application is active, the banks Enable Banking
          supports appear on Koinkat's Bank Link page. What needs activating is the application
          itself.
        </p>
        <ol className="list-decimal list-inside flex flex-col gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <li>
            <strong style={{ color: 'var(--text)' }}>Sandbox</strong> applications activate
            automatically - nothing to do.
          </li>
          <li>
            <strong style={{ color: 'var(--text)' }}>Production</strong> applications start
            inactive. For personal use, activate in{' '}
            <strong style={{ color: 'var(--text)' }}>restricted mode</strong> by linking one of
            your own bank accounts when the Control Panel offers it - free, and sufficient when
            you only connect accounts you own.
          </li>
          <li>
            Full activation (manual review by Enable Banking, contract and KYC) is only needed
            to offer an application to other people - not for personal use.
          </li>
        </ol>
      </>
    ),
  },

  // ── Step 7 ────────────────────────────────────────────────────────────
  {
    title: 'Register the redirect URL on your application',
    content: (
      <>
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
          After you approve access in your bank's website, Enable Banking sends the browser to a
          redirect URL registered on your application. That page's only job is to bounce the
          authorization code back into Koinkat via the{' '}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-caption)', color: 'var(--text)' }}>
            koinkat://auth-callback
          </span>{' '}
          deep link - it holds no secrets and nothing personal, so everyone can share one page.
        </p>
        <ol className="list-decimal list-inside flex flex-col gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <li>
            On your Enable Banking application page, register Koinkat's shared callback page as
            the redirect URL - the match is exact, trailing slash included:
          </li>
        </ol>
        <CodeBlock code="https://marcosburlino.github.io/koinkat-callback/" />
        <p className="text-sm mt-3" style={{ color: 'var(--text-muted)' }}>
          Koinkat pre-fills this same URL in the <strong style={{ color: 'var(--text)' }}>Redirect URL</strong>{' '}
          field, so there's nothing else to do. Prefer full independence? Host your own copy
          (the page source is at{' '}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-caption)', color: 'var(--text)' }}>
            github.com/MarcoSburlino/koinkat-callback
          </span>
          ), register that URL instead, and paste it into the field.
        </p>
      </>
    ),
  },
  // ── Step 8 - PEM content note verified ───────────────────────────────
  {
    title: 'Paste your credentials into Koinkat',
    content: (
      <>
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
          You now have everything you need. Head back to Koinkat's workspace creation screen (or
          Settings if you're updating an existing workspace).
        </p>
        <ol className="list-decimal list-inside flex flex-col gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <li>
            In the <strong style={{ color: 'var(--text)' }}>Application ID</strong> field, paste
            the UUID you copied in step 5.
          </li>
          <li>
            In the <strong style={{ color: 'var(--text)' }}>Redirect URL</strong> field, paste the
            https:// callback URL you registered in step 7.
          </li>
          <li>
            Click <strong style={{ color: 'var(--text)' }}>Choose .pem file...</strong> and select
            your{' '}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-caption)', color: 'var(--text)' }}>
              private.pem
            </span>. Koinkat reads the full file - make sure it includes both the{' '}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-caption)', color: 'var(--text)' }}>
              -----BEGIN PRIVATE KEY-----
            </span>{' '}
            and{' '}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-caption)', color: 'var(--text)' }}>
              -----END PRIVATE KEY-----
            </span>{' '}
            delimiter lines.
          </li>
          <li>
            Click <strong style={{ color: 'var(--text)' }}>Create & verify</strong>. Koinkat will
            test the credentials against Enable Banking and report any errors.
          </li>
        </ol>
      </>
    ),
  },
];

const TOTAL = STEPS.length;

// ── Main component ────────────────────────────────────────────────────────

export function BankSetupGuide({ open, onClose }: BankSetupGuideProps) {
  const [step, setStep] = useState(0);

  // Reset to first step whenever the modal opens.
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  const current = STEPS[step];
  const isFirst = step === 0;
  const isLast = step === TOTAL - 1;
  const progress = ((step + 1) / TOTAL) * 100;

  return (
    <Modal open={open} onClose={onClose} size="lg">
      {/* Progress bar */}
      <div
        className="mb-5 -mx-6 -mt-6 overflow-hidden"
        style={{
          borderRadius: 'var(--radius-3) var(--radius-3) 0 0',
          height: '3px',
          backgroundColor: 'var(--border)',
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: '100%',
            backgroundColor: 'var(--primary)',
            transition: 'width var(--dur-std) var(--ease-standard)',
          }}
        />
      </div>

      {/* Step indicator + title */}
      <div className="mb-5">
        <p
          className="text-xs uppercase tracking-[0.14em] mb-1"
          style={{ color: 'var(--text-muted)' }}
        >
          Step {step + 1} of {TOTAL}
        </p>
        <h2
          className="text-lg font-semibold"
          style={{ color: 'var(--text)', fontFamily: 'var(--font-sans)' }}
        >
          {current.title}
        </h2>
      </div>

      {/* Step body */}
      <div className="mb-8">{current.content}</div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
        <Button
          variant="ghost"
          disabled={isFirst}
          onClick={() => setStep((s) => s - 1)}
        >
          Back
        </Button>
        {isLast ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <Button variant="primary" onClick={() => setStep((s) => s + 1)}>
            Next
          </Button>
        )}
      </div>
    </Modal>
  );
}
