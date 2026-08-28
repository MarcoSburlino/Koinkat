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

// ── Internal: inline monospace fragment (field values, filenames, URLs) ───

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--fs-caption)',
        color: 'var(--text)',
      }}
    >
      {children}
    </span>
  );
}

// ── Internal: bold label matching the app's text colour ───────────────────

function Label({ children }: { children: React.ReactNode }) {
  return <strong style={{ color: 'var(--text)' }}>{children}</strong>;
}

// ── Step definitions ──────────────────────────────────────────────────────
//
// Step order mirrors the "Connecting a bank" chapter in README.md so the two
// can be followed side by side. Keep them in sync when either changes.

interface Step {
  title: string;
  content: React.ReactNode;
}

const BODY = 'text-sm mb-3';
const LIST = 'list-decimal list-inside flex flex-col gap-2 text-sm';

const STEPS: Step[] = [
  // ── Step 1 ────────────────────────────────────────────────────────────
  {
    title: 'Create an Enable Banking account',
    content: (
      <>
        <p className={BODY} style={{ color: 'var(--text-muted)' }}>
          Enable Banking is the PSD2 service Koinkat uses to connect to European banks. It
          holds the licence that lets an app read your accounts, and it normalises thousands
          of European banks behind one API. You need a free account before you can register
          an application.
        </p>
        <ol className={LIST} style={{ color: 'var(--text-muted)' }}>
          <li>
            Go to <Mono>enablebanking.com/sign-in/</Mono> and enter your email address.
          </li>
          <li>
            Open the one-time authentication link Enable Banking emails you - there is no
            password. Check your spam folder if nothing arrives within a few minutes.
          </li>
          <li>Your account is created automatically on first sign-in.</li>
        </ol>
      </>
    ),
  },

  // ── Step 2 ────────────────────────────────────────────────────────────
  {
    title: 'Register an application in the Control Panel',
    content: (
      <>
        <p className={BODY} style={{ color: 'var(--text-muted)' }}>
          An "application" in Enable Banking is the container for your credentials: its ID and
          your key identify Koinkat to the API. Registration is a single form that also asks
          for the redirect URL and the key, so read steps 3 and 4 before you submit it.
        </p>
        <ol className={LIST} style={{ color: 'var(--text-muted)' }}>
          <li>
            Open the <Label>Control Panel</Label> at <Mono>enablebanking.com/cp/</Mono> and go
            to the <Label>API applications</Label> page.
          </li>
          <li>Register a new application and give it a name - e.g. "Koinkat personal".</li>
          <li>
            Under <Label>Choose Environment</Label> pick <Label>Production</Label> for real
            banks. (Sandbox is Enable Banking's test environment with mock banks and invented
            data - pick it only to try Koinkat without real accounts. Sandbox applications
            also skip step 6.)
          </li>
          <li>
            <Label>Choose Infrastructure</Label> appears only if dedicated infrastructure is
            available on your account. If you see it, leave the default.
          </li>
          <li>
            A Production application also requires a description, a data protection email, and
            privacy policy and terms of service URLs. The <Label>description is shown to end
            users during consent</Label>, so it can appear on your own bank's approval screen -
            write something you would be happy to read there. The email and URLs are not
            reviewed for a restricted-mode application, but the form still requires values.
          </li>
          <li>
            Do not press <Label>Register</Label> yet - set the redirect URL and the key first.
          </li>
        </ol>
      </>
    ),
  },

  // ── Step 3 ────────────────────────────────────────────────────────────
  {
    title: 'Set the redirect URL',
    content: (
      <>
        <p className={BODY} style={{ color: 'var(--text-muted)' }}>
          After you approve access on your bank's website, Enable Banking sends the browser to
          a redirect URL registered on your application. That page's only job is to bounce the
          authorization code back into Koinkat via the{' '}
          <Mono>koinkat://auth-callback</Mono> deep link, which is what produces the "Open
          Koinkat?" prompt later. Two options, both fine - the difference is whose
          infrastructure the code passes through on its way back to you.
        </p>
        <p className="text-sm mb-2" style={{ color: 'var(--text)' }}>
          <Label>Koinkat's shared page: less setup</Label>
        </p>
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
          Register this URL - the match is exact, trailing slash included. Koinkat pre-fills it
          in the <Label>Redirect URL</Label> field, so there is nothing else to do.
        </p>
        <CodeBlock code="https://marcosburlino.github.io/koinkat-callback/" />
        <p className="text-sm mt-3 mb-3" style={{ color: 'var(--text-muted)' }}>
          Everyone can share one page because it holds no secrets: the code is single-use,
          expires quickly, and is worthless without your application ID and private key, which
          never leave your machine. It is served from GitHub Pages, so GitHub records the
          request URL the way it does for any page it hosts.
        </p>
        <p className="text-sm mb-2" style={{ color: 'var(--text)' }}>
          <Label>Your own copy: the code touches nobody else's host</Label>
        </p>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Host the page yourself (source at{' '}
          <Mono>github.com/MarcoSburlino/koinkat-callback</Mono>), register that URL on your
          application instead, and paste it into the <Label>Redirect URL</Label> field. It is a
          single static file, so any static host works.
        </p>
      </>
    ),
  },

  // ── Step 4 - browser-generated key is the primary path ────────────────
  {
    title: 'Generate and download your private key',
    content: (
      <>
        <p className={BODY} style={{ color: 'var(--text-muted)' }}>
          Requests are signed with an RSA key pair (RS256). Enable Banking keeps the public
          half; you keep the private half and give it to Koinkat. Both routes below work.
        </p>
        <p className="text-sm mb-2" style={{ color: 'var(--text)' }}>
          <Label>Recommended: let the browser generate it</Label>
        </p>
        <ol className={LIST} style={{ color: 'var(--text-muted)' }}>
          <li>
            Choose the option to let the browser generate the private key. It is created
            locally and never transmitted; only the public half is registered.
          </li>
          <li>
            Submit the form with <Label>Register</Label>. The private key downloads to your
            Downloads folder, named after the application ID:{' '}
            <Mono>{'<application-id>'}.pem</Mono>. This happens once and cannot be repeated -
            Enable Banking never has your private key, so it cannot re-send it. Move the file
            somewhere you will remember, and never share or upload it.
          </li>
        </ol>
        <p className="text-sm mt-4 mb-2" style={{ color: 'var(--text)' }}>
          <Label>Advanced: supply your own public key</Label>
        </p>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          To keep a private key out of a browser download folder entirely, pick the option to
          provide a public key and paste the contents of <Mono>public.pem</Mono> from:
        </p>
        <CodeBlock code="openssl genpkey -algorithm RSA -out private.pem -pkeyopt rsa_keygen_bits:2048" />
        <CodeBlock code="openssl rsa -in private.pem -pubout -out public.pem" />
        <p className="text-sm mt-3" style={{ color: 'var(--text-muted)' }}>
          <Mono>private.pem</Mono> stays on your machine and is the file you hand to Koinkat in
          step 7. Everything after this is identical either way.
        </p>
      </>
    ),
  },

  // ── Step 5 ────────────────────────────────────────────────────────────
  {
    title: 'Locate your application ID',
    content: (
      <>
        <p className={BODY} style={{ color: 'var(--text-muted)' }}>
          Koinkat needs your application ID - a UUID assigned at registration - to identify
          your app when making API requests.
        </p>
        <ol className={LIST} style={{ color: 'var(--text-muted)' }}>
          <li>
            In the Control Panel, go to <Label>API applications</Label> and open your app.
          </li>
          <li>
            Look for a field labelled <Label>Application ID</Label> or <Label>App ID</Label>.
            It is a UUID in the format <Mono>xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</Mono>.
          </li>
          <li>
            Copy this value - you will paste it into Koinkat in step 7. It is also the first
            part of your downloaded key's filename.
          </li>
        </ol>
      </>
    ),
  },

  // ── Step 6 ────────────────────────────────────────────────────────────
  {
    title: 'Activate your application',
    content: (
      <>
        <p className={BODY} style={{ color: 'var(--text-muted)' }}>
          Activation turns a new application on and also fixes its scope: only the bank
          accounts you link in the Control Panel will ever be visible to Koinkat. Link every
          account, at every bank, you plan to use.
        </p>
        <ol className={LIST} style={{ color: 'var(--text-muted)' }}>
          <li>
            <Label>Sandbox</Label> applications activate automatically - nothing to do.
          </li>
          <li>
            <Label>Production</Label> applications start inactive. On the application's page,
            click <Label>Activate by linking accounts</Label> and link every account you plan
            to use - the list is a whitelist, and you will still authorize each bank again
            inside Koinkat. You can link more accounts later from the same page; Enable Banking
            may cap how many one application can link. The result is an application active in
            restricted mode, for exactly the accounts you linked.
          </li>
          <li>
            Full activation (manual review by Enable Banking, contract and KYC) is only needed
            to offer an application to other people. Restricted mode covers your own personal
            accounts only: not business accounts, not anyone else's, and no commercial use -
            each person runs their own Enable Banking application.
          </li>
        </ol>
      </>
    ),
  },

  // ── Step 7 - PEM content note verified ────────────────────────────────
  {
    title: 'Paste your credentials into Koinkat',
    content: (
      <>
        <p className={BODY} style={{ color: 'var(--text-muted)' }}>
          You now have everything you need. Head back to Koinkat's workspace creation screen
          (or Settings if you are updating an existing workspace).
        </p>
        <ol className={LIST} style={{ color: 'var(--text-muted)' }}>
          <li>
            In the <Label>Application ID</Label> field, paste the UUID you copied in step 5.
          </li>
          <li>
            Under <Label>Private Key</Label>, click <Label>Choose .pem file...</Label> and
            select your key. The filename appears next to the button once it is picked. Koinkat
            reads the full file, so it must still include both the{' '}
            <Mono>-----BEGIN PRIVATE KEY-----</Mono> and <Mono>-----END PRIVATE KEY-----</Mono>{' '}
            delimiter lines.
          </li>
          <li>
            The <Label>Redirect URL</Label> field is pre-filled with the callback URL from
            step 3 - leave it as it is unless you registered a page you host yourself.
          </li>
          <li>
            Click <Label>Create & verify</Label>. Koinkat signs a real request to Enable
            Banking with your key, so a wrong ID, the wrong .pem, or an application that is not
            activated yet is caught here rather than later.
          </li>
        </ol>
      </>
    ),
  },

  // ── Step 8 ────────────────────────────────────────────────────────────
  {
    title: 'Link your bank',
    content: (
      <>
        <p className={BODY} style={{ color: 'var(--text-muted)' }}>
          Credentials done. Koinkat takes you straight to the bank-linking screen, and this is
          what happens there.
        </p>
        <ol className={LIST} style={{ color: 'var(--text-muted)' }}>
          <li>
            Choose how much history to import. 180 days is the maximum PSD2 allows and the
            recommended default; anything older will not appear.
          </li>
          <li>
            Pick your <Label>Country</Label>, find your bank with <Label>Search banks</Label>,
            and click <Label>Connect</Label>.
          </li>
          <li>
            Your browser opens your bank's own login. Koinkat never sees those credentials.
            Approve read access, and confirm with your second factor if asked.
          </li>
          <li>
            The callback page then hands the code back and your browser asks "Open Koinkat?" -
            click Allow. If no prompt appears, use the <Label>Copy Code</Label> button on that
            page, paste the code into Koinkat, and click <Label>Connect & Sync</Label>. Both
            paths end in the same place.
          </li>
          <li>
            Koinkat imports your accounts and transactions, then shows the{' '}
            <Label>Connected!</Label> screen. New transactions land in the{' '}
            <Label>Review</Label> inbox to be categorized.
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

      {/* Affiliation + accuracy note. Applies to the whole guide, which walks
          through a third party's web interface, so it sits above the step
          chrome rather than inside any one step. */}
      <p
        className="mb-4 text-xs"
        style={{ color: 'var(--text-muted)', lineHeight: '1.5' }}
      >
        Koinkat is not affiliated with, endorsed by, or sponsored by Enable Banking Oy.
        "Enable Banking" is a trademark of Enable Banking Oy. This guide describes their
        Control Panel as it appeared in August 2026; their own documentation at{' '}
        <Mono>enablebanking.com/docs</Mono> is authoritative and may have changed.
      </p>

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
