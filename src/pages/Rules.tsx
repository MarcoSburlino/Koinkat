import { UPPERCASE_HEADER_CELL } from '../lib/label-styles';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { CategoryPicker } from '../components/ui/CategoryPicker';
import { PageHeader } from '../components/layout/PageHeader';
import * as ruleService from '../services/rule-service';
import type {
  Rule,
  RuleMatchType,
  RuleMatchField,
  RuleSource,
} from '../services/rule-service';

const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All sources' },
  { value: 'user', label: 'User' },
  { value: 'learned', label: 'Learned' },
  { value: 'mcc', label: 'MCC' },
  { value: 'system', label: 'System' },
];

const ACTIVE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active only' },
  { value: 'inactive', label: 'Inactive only' },
];

const MATCH_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'exact', label: 'Exact match' },
  { value: 'prefix', label: 'Starts with' },
  { value: 'contains', label: 'Contains' },
];

const MATCH_FIELD_OPTIONS: { value: string; label: string }[] = [
  { value: 'merchant_normalized', label: 'Merchant name (normalized)' },
  { value: 'remittance_info', label: 'Remittance info' },
  { value: 'creditor_name', label: 'Creditor name (raw)' },
];

export function Rules() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [activeFilter, setActiveFilter] = useState<string>('all');

  // Edit modal state
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form state (shared between create & edit modals)
  const [formName, setFormName] = useState('');
  const [formMatchField, setFormMatchField] =
    useState<RuleMatchField>('merchant_normalized');
  const [formMatchType, setFormMatchType] = useState<RuleMatchType>('exact');
  const [formPattern, setFormPattern] = useState('');
  const [formCategoryId, setFormCategoryId] = useState<string | null>(null);
  const [formPriority, setFormPriority] = useState<string>('30');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Rule | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Errors from list-level actions (toggle) that have no modal to live in.
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filters: ruleService.ListRulesFilters = {};
      if (sourceFilter) filters.source = sourceFilter as RuleSource;
      if (activeFilter === 'active') filters.isActive = true;
      if (activeFilter === 'inactive') filters.isActive = false;
      const list = await ruleService.listRules(filters);
      setRules(list);
    } finally {
      setLoading(false);
    }
  }, [sourceFilter, activeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreateModal() {
    setIsCreating(true);
    setEditingRule(null);
    setFormName('');
    setFormMatchField('merchant_normalized');
    setFormMatchType('exact');
    setFormPattern('');
    setFormCategoryId(null);
    setFormPriority('30');
    setFormError('');
  }

  function openEditModal(rule: Rule) {
    setEditingRule(rule);
    setIsCreating(false);
    setFormName(rule.name ?? '');
    setFormMatchField(rule.matchField);
    setFormMatchType(rule.matchType);
    setFormPattern(rule.matchPattern);
    setFormCategoryId(rule.categoryId);
    setFormPriority(String(rule.priority));
    setFormError('');
  }

  function closeFormModal() {
    setIsCreating(false);
    setEditingRule(null);
    setFormError('');
  }

  async function handleSaveForm() {
    const pattern = formPattern.trim();
    if (!pattern) {
      setFormError('Match pattern is required');
      return;
    }
    if (!formCategoryId) {
      setFormError('Category is required');
      return;
    }
    const priority = parseInt(formPriority, 10);
    if (isNaN(priority)) {
      setFormError('Priority must be a number');
      return;
    }

    setSaving(true);
    try {
      if (editingRule) {
        await ruleService.updateRule(editingRule.id, {
          name: formName.trim() || null,
          matchField: formMatchField,
          matchType: formMatchType,
          matchPattern: pattern,
          categoryId: formCategoryId,
          priority,
        });
      } else {
        await ruleService.createRule({
          name: formName.trim() || null,
          matchField: formMatchField,
          matchType: formMatchType,
          matchPattern: pattern,
          categoryId: formCategoryId,
          priority,
        });
      }
      closeFormModal();
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save rule');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(rule: Rule) {
    setActionError('');
    try {
      await ruleService.toggleRule(rule.id, !rule.isActive);
      await load();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to toggle rule',
      );
    }
  }

  async function handleDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await ruleService.deleteRule(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      // Keep the modal open so the failure is visible instead of leaving a
      // half-closed modal with no explanation.
      setDeleteError(
        err instanceof Error ? err.message : 'Failed to delete rule',
      );
    } finally {
      setDeleting(false);
    }
  }

  function renderCategoryPath(rule: Rule): string {
    if (rule.categoryParentName) {
      return `${rule.categoryParentName} / ${rule.categoryName}`;
    }
    return rule.categoryName;
  }

  return (
    <div>
      <PageHeader
        serif
        label="Categorization"
        title="Rules"
        subtitle="Control how transactions get auto-categorized. Learned rules come from your confirmations; user rules are manually created."
        right={
          <Button variant="primary" onClick={openCreateModal}>
            <Plus size={16} />
            New rule
          </Button>
        }
      />

      {actionError && (
        <p className="text-sm mb-4" style={{ color: 'var(--danger)' }}>
          {actionError}
        </p>
      )}

      {/* Filters */}
      <Card className="mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Source"
            options={SOURCE_OPTIONS}
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
          />
          <Select
            label="Active"
            options={ACTIVE_OPTIONS}
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value)}
          />
        </div>
      </Card>

      {loading ? (
        <Card>
          <p
            className="text-center py-12"
            style={{
              color: 'var(--text-muted)',
              fontSize: 'var(--fs-body-sm)',
            }}
          >
            Loading rules...
          </p>
        </Card>
      ) : rules.length === 0 ? (
        <Card>
          <p
            className="text-center py-12"
            style={{
              color: 'var(--text-muted)',
              fontSize: 'var(--fs-body-sm)',
            }}
          >
            No rules yet. Rules are created automatically when you confirm
            categories in the review queue, or you can create one manually.
          </p>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Pattern', 'Category', 'Type', 'Source', 'Conf.', 'Matches', ''].map(
                    (h) => (
                      <th
                        key={h}
                        className="py-2 px-3 font-medium uppercase text-left"
                        style={UPPERCASE_HEADER_CELL}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr
                    key={rule.id}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      opacity: rule.isActive ? 1 : 0.5,
                    }}
                  >
                    <td
                      className="py-2.5 px-3 max-w-[240px] truncate"
                      style={{
                        color: 'var(--text)',
                        fontSize: 'var(--fs-body-sm)',
                        fontFamily: 'var(--font-mono)',
                      }}
                      title={rule.matchPattern}
                    >
                      {rule.matchPattern}
                    </td>
                    <td
                      className="py-2.5 px-3"
                      style={{
                        color: 'var(--text)',
                        fontSize: 'var(--fs-body-sm)',
                      }}
                    >
                      {renderCategoryPath(rule)}
                    </td>
                    <td
                      className="py-2.5 px-3 uppercase"
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: 'var(--fs-rate)',
                        letterSpacing: 'var(--ls-uppercase)',
                      }}
                    >
                      {rule.matchType}
                    </td>
                    <td
                      className="py-2.5 px-3 uppercase"
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: 'var(--fs-rate)',
                        letterSpacing: 'var(--ls-uppercase)',
                      }}
                    >
                      {rule.source}
                    </td>
                    <td
                      className="py-2.5 px-3 amount"
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: 'var(--fs-body-sm)',
                      }}
                    >
                      {(rule.confidence * 100).toFixed(0)}%
                    </td>
                    <td
                      className="py-2.5 px-3 amount"
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: 'var(--fs-body-sm)',
                      }}
                    >
                      {rule.matchCount}
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => handleToggle(rule)}
                        className="px-2 py-1 rounded cursor-pointer text-xs"
                        style={{
                          color: rule.isActive
                            ? 'var(--text-muted)'
                            : 'var(--primary)',
                          border: '1px solid var(--border)',
                          marginRight: 8,
                        }}
                        title={rule.isActive ? 'Deactivate' : 'Activate'}
                      >
                        {rule.isActive ? 'Active' : 'Paused'}
                      </button>
                      <button
                        onClick={() => openEditModal(rule)}
                        className="p-1 rounded cursor-pointer transition-opacity hover:opacity-70"
                        style={{ color: 'var(--text-muted)' }}
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(rule)}
                        className="p-1 rounded cursor-pointer transition-opacity hover:opacity-70 ml-1"
                        style={{ color: 'var(--danger)' }}
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Create / Edit Modal */}
      <Modal
        open={isCreating || editingRule !== null}
        onClose={closeFormModal}
        title={editingRule ? 'Edit rule' : 'New rule'}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Name (optional)"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="e.g. Netflix subscription"
          />
          <Select
            label="Match field"
            options={MATCH_FIELD_OPTIONS}
            value={formMatchField}
            onChange={(e) => setFormMatchField(e.target.value as RuleMatchField)}
          />
          <Select
            label="Match type"
            options={MATCH_TYPE_OPTIONS}
            value={formMatchType}
            onChange={(e) => setFormMatchType(e.target.value as RuleMatchType)}
          />
          <Input
            label="Pattern"
            value={formPattern}
            onChange={(e) => setFormPattern(e.target.value)}
            placeholder="e.g. NETFLIX"
            helpText="Stored in uppercase. Case-insensitive matching."
          />
          <CategoryPicker
            label="Category"
            value={formCategoryId}
            onChange={setFormCategoryId}
            allowNull={false}
          />
          <Input
            label="Priority (lower = higher priority)"
            value={formPriority}
            onChange={(e) => setFormPriority(e.target.value)}
            helpText="User rules default to 30; learned rules to 50; MCC to 80."
          />
          {formError && (
            <p className="text-sm" style={{ color: 'var(--danger)' }}>
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-3 mt-2">
            <Button variant="ghost" onClick={closeFormModal}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSaveForm}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete rule?"
      >
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          Are you sure you want to delete this rule? Existing transactions
          that were categorized by it keep their category, but future
          transactions will no longer match.
        </p>
        {deleteError && (
          <p className="text-sm mb-4" style={{ color: 'var(--danger)' }}>
            {deleteError}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button
            variant="ghost"
            onClick={() => { setDeleteTarget(null); setDeleteError(''); }}
          >
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
