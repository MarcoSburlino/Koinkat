# Koinkat MCP scope

The agreed eventual permissions and tool surface for Koinkat MCP. The first milestone implements reads and calculations; limited editing is planned. Current behavior is documented in `api.md`.

## Confirmed permissions

These boundaries were confirmed on 2026-11-09. Limited editing supersedes the initial read-only proposal.

| Area | Allowed | Protected |
|---|---|---|
| Financial reads | Query accounts, transactions, categories, budgets, events, recurring series and shared expenses | Credentials, keys, authorization codes and session tokens |
| Calculations | Sums, differences, averages, percentages, comparisons and hypothetical scenarios | No persistence of hypothetical money movements |
| Existing transactions | Category, note, budget inclusion, budget-event link and recurring classification | Amount, currency, account assignment, date, stored exchange rate and bank identity; no creation/deletion |
| Transfers | Classify, pair and unpair existing rows; mark a one-sided transfer when its counterpart is outside Koinkat | No creation of transfers that move balances |
| Shared expenses | Flag an existing expense as shared; link/unlink existing repayment rows | No new repayment transactions or external reimbursement amounts |
| Budgets | Create and edit, including limits and periods | No deletion in initial scope |
| Budget events | Create and edit, including limits, names, dates and transaction links | No deletion in initial scope |
| Accounts | Read account information | No creation, editing, deletion or balance changes |

Classification can change reporting totals without changing underlying financial amounts or balances. Derived split net spending may change when existing repayments are linked or unlinked; this must never rewrite the original payment amounts.

## Implemented read tools

These tools are implemented; current contracts and limitations live in `api.md`.

| Tool | Purpose |
|---|---|
| `get_context` | Authorized workspace, preferred currency, available history, sync freshness and cached rate dates |
| `list_accounts` | Native balances and combined balances with conversion context |
| `list_categories` | Category hierarchy and filter IDs |
| `search_transactions` | Paginated filtering by dates, account, category, merchant, amount, recurring and review status |
| `get_transaction` | Detail including related fees, transfer links and repayments |
| `summarize_transactions` | Complete-dataset totals grouped by category, merchant, account or time period |
| `get_budgets` | Limits, spending and remaining amounts for recurring budgets and budget events |
| `list_recurring_expenses` | Confirmed series, expected amounts, cadence and expected charges |
| `list_split_expenses` | Open/settled shared expenses, gross amounts, reimbursements and net costs |
| `calculate` | Decimal arithmetic on retrieved results and hypothetical inputs; typed operations rather than executable expressions |

## Proposed organization tools

- `update_transaction_metadata`: explicit allowlist for category and note.
- `set_transaction_budgeted` and `set_transaction_budget_event`: inclusion and event assignment.
- `set_transaction_recurring`: classify an existing expense, respecting Koinkat series semantics.
- `confirm_transfer_pair`, `mark_as_transfer_alone`, `unpair_transfer`: classification only, balances unchanged.
- Split classification and existing-repayment linking/unlinking: names and contracts pending a service audit.
- Budget and budget-event creation/editing: names and contracts pending a service audit.

Category creation/renaming, batch edits, review confirmation and learning categorization rules need separate scope decisions. Do not infer permission from transaction-category editing.

## Calculation and data rules

- Amounts are decimal strings; perform arithmetic through compatible decimal money primitives.
- Default income/expense totals use booked rows, split net spending, and exclude repayment rows and confirmed transfers.
- Balance calculations use actual balance effects, which differ from income/expense totals.
- Return applied filters, currency, rate date, missing conversions and data freshness. Never silently add mixed currencies.
- Aggregate the entire matching dataset, not just a page returned by search.
- Every operation belongs to one explicitly authorized workspace. Switching the app's current workspace must not retarget an operation.
- Read calls must not trigger synchronization, categorization, migrations or exchange-rate downloads.
- Write tools validate both fields and relationships in the application layer. MCP annotations alone do not enforce permissions.

## Open product decisions

- Model policy settled 2026-11-09: support any user-chosen model through a compatible MCP client, including local and cloud models. This supersedes the older local-only preference. Model selection belongs to the client, not the server. Current local stdio support does not imply compatibility with clients requiring remote HTTP.
- How the user enables access and selects an authorized workspace.
- Whether edits require previews or confirmation, and whether to support audit history and undo.
- Initial clients and supported operating systems.
