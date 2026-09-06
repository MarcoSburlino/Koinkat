# Screenshot assets

Captured 2026-09-06 from a **demo build** (`npm run tauri:build:demo`,
identifier `com.koinkat.app.demo`) against a manual workspace holding
invented accounts and transactions. No personal data, and the production
database was never opened.

Rendered at 2x (2560x1600) so they stay legible when scaled down.

| File | What it shows | Used in |
|---|---|---|
| `01-first-launch.png` | First launch, the user-profile step | spare |
| `02-workspace-hub.png` | Workspace hub with the three creation cards | spare |
| `03-bank-credentials.png` | Bank-linked workspace form: application ID, private key, redirect URL | README, Step 7 |
| `04-bank-setup-guide.png` | The in-app Enable Banking guide, step 1 of 8 | README, Connecting a bank |
| `06-dashboard.png` | Dashboard: net worth across EUR and USD, account split, month pulse | spare |

## Where visuals belong

**The app's look lives on the website**, not here:
<https://www.marcosburlino.com/koinkat>. That page carries the screen
showcase and the walkthrough, built as HTML replicas rather than images,
and its source is `projects/koinkat/design/` in the personal-website repo.

**This README is the setup manual.** It keeps only the two screenshots that
help while following the instructions. Adding a gallery here would
duplicate the site and drift from it.

## Still missing

`05-consent-flow.png` - the bank's own consent screen, or the callback page
showing "Open Koinkat?". It has to be captured against a real bank, so it
cannot come from a demo build. The README carries a placeholder for it.

Capture convention if you add more: `NN-short-kebab-name.png`, numbered in
the order the guide reaches them, demo or sandbox workspace only.
