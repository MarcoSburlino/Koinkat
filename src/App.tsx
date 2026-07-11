import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Shell } from './components/layout/Shell';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { AccountCreate } from './pages/AccountCreate';
import { AccountEdit } from './pages/AccountEdit';
import { TransactionList } from './pages/TransactionList';
import { TransactionCreate } from './pages/TransactionCreate';
import { TransactionTransfer } from './pages/TransactionTransfer';
import { TransactionEdit } from './pages/TransactionEdit';
import { TransactionSplit } from './pages/TransactionSplit';
import { Categories } from './pages/Categories';
import { Analysis } from './pages/Analysis';
import { Summary } from './pages/Summary';
import { Budgets } from './pages/Budgets';
import { BankLink } from './pages/BankLink';
import { Review } from './pages/Review';
import { Rules } from './pages/Rules';

// Note: the Connection (account hub) is NOT a route - Shell renders it
// directly when `view === 'accountHub'`, because it sits outside the
// routed app (no sidebar, no workspace features).

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Dashboard />} />
            <Route path="accounts/create" element={<AccountCreate />} />
            <Route path="accounts/:id/edit" element={<AccountEdit />} />
            <Route path="transactions" element={<TransactionList />} />
            <Route path="transactions/create" element={<TransactionCreate />} />
            <Route path="transactions/transfer" element={<TransactionTransfer />} />
            <Route path="transactions/:id/edit" element={<TransactionEdit />} />
            <Route path="transactions/:id/split" element={<TransactionSplit />} />
            <Route path="categories" element={<Categories />} />
            <Route path="review" element={<Review />} />
            {/* Rules is a debug/admin surface - hidden from navigation
                everywhere, and fully removed from non-development builds. */}
            {__KOINKAT_ALLOW_DEBUG_ROUTES__ && (
              <Route path="rules" element={<Rules />} />
            )}
            <Route path="analysis" element={<Analysis />} />
            <Route path="summary" element={<Summary />} />
            <Route path="budgets" element={<Budgets />} />
            {/* Budget events merged into /budgets page (2026-04-22). Redirect any stale links. */}
            <Route path="budget-events" element={<Navigate to="/budgets" replace />} />
            <Route path="bank-link" element={<BankLink />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
