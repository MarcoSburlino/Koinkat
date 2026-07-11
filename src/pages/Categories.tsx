import { useState, useEffect, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { CategoryIcon } from '../components/ui/CategoryIcon';
import { PageHeader } from '../components/layout/PageHeader';
import * as categoryService from '../services/category-service';
import type { Category } from '../types/models';

/**
 * Category management page: two columns (expense | income), each listing
 * system macro categories as expandable rows. Users can add / edit /
 * delete their own subcategories under any macro. System macros
 * themselves are immutable.
 */
export function Categories() {
  const [tree, setTree] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Per-exact-category counts (no rollup) - shown on subcategory rows so
  // the user knows how many rows a subcategory holds before deleting it.
  const [subCounts, setSubCounts] = useState<Record<string, number>>({});

  // Expand/collapse state: macro ids that are currently open.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Inline "add subcategory" form: which macro is currently showing the
  // form, and its working name.
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [newSubName, setNewSubName] = useState('');
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);

  // Inline "new macro category" form: only one open at a time, tracked
  // by the column type ('expense' | 'income' | null).
  const [addingMacroType, setAddingMacroType] = useState<
    'expense' | 'income' | null
  >(null);
  const [newMacroName, setNewMacroName] = useState('');
  const [newMacroError, setNewMacroError] = useState('');

  // Inline edit state: which subcategory id is currently being edited.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState('');

  // Delete confirmation target
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, c, sc] = await Promise.all([
        categoryService.listCategoryTree(),
        categoryService.countTransactionsPerMacro(),
        categoryService.countTransactionsPerCategory(),
      ]);
      setTree(t);
      setCounts(c);
      setSubCounts(sc);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const expenseMacros = tree.filter((c) => c.type === 'expense');
  const incomeMacros = tree.filter((c) => c.type === 'income');

  function toggleExpanded(macroId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(macroId)) next.delete(macroId);
      else next.add(macroId);
      return next;
    });
  }

  // ── Add macro category ───────────────────────────────────────────────
  function startAddMacro(type: 'expense' | 'income') {
    setAddingMacroType(type);
    setNewMacroName('');
    setNewMacroError('');
  }

  function cancelAddMacro() {
    setAddingMacroType(null);
    setNewMacroName('');
    setNewMacroError('');
  }

  async function handleAddMacro() {
    if (!addingMacroType) return;
    const trimmed = newMacroName.trim();
    if (!trimmed) {
      setNewMacroError('Name is required');
      return;
    }
    setSaving(true);
    try {
      await categoryService.createMacro({
        name: trimmed,
        type: addingMacroType,
      });
      setAddingMacroType(null);
      setNewMacroName('');
      setNewMacroError('');
      await load();
    } catch (err) {
      setNewMacroError(
        err instanceof Error ? err.message : 'Failed to add category',
      );
    } finally {
      setSaving(false);
    }
  }

  // ── Add subcategory ──────────────────────────────────────────────────
  function startAdd(macroId: string) {
    setAddingFor(macroId);
    setNewSubName('');
    setAddError('');
    // Auto-expand so the form is visible
    setExpanded((prev) => new Set(prev).add(macroId));
  }

  function cancelAdd() {
    setAddingFor(null);
    setNewSubName('');
    setAddError('');
  }

  async function handleAdd(macroId: string) {
    const trimmed = newSubName.trim();
    if (!trimmed) {
      setAddError('Name is required');
      return;
    }
    setSaving(true);
    try {
      await categoryService.createSubcategory({
        parentId: macroId,
        name: trimmed,
      });
      setAddingFor(null);
      setNewSubName('');
      setAddError('');
      await load();
    } catch (err) {
      setAddError(
        err instanceof Error ? err.message : 'Failed to add subcategory',
      );
    } finally {
      setSaving(false);
    }
  }

  // ── Edit subcategory ─────────────────────────────────────────────────
  function startEdit(category: Category) {
    setEditingId(category.id);
    setEditName(category.name);
    setEditError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName('');
    setEditError('');
  }

  async function handleEditSave(id: string) {
    const trimmed = editName.trim();
    if (!trimmed) {
      setEditError('Name is required');
      return;
    }
    setSaving(true);
    try {
      await categoryService.updateCategory(id, { name: trimmed });
      setEditingId(null);
      setEditName('');
      setEditError('');
      await load();
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : 'Failed to update subcategory',
      );
    } finally {
      setSaving(false);
    }
  }

  // ── Delete subcategory ───────────────────────────────────────────────
  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      // Default reparent: move transactions to the parent macro.
      await categoryService.deleteCategory(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      // Keep the modal open so the user can read why it failed (e.g. a
      // macro that still has subcategories, or a DB error).
      setDeleteError(
        err instanceof Error ? err.message : 'Failed to delete category',
      );
    } finally {
      setDeleting(false);
    }
  }

  // ── Render helpers ───────────────────────────────────────────────────
  function renderMacro(macro: Category) {
    const isExpanded = expanded.has(macro.id);
    const children = macro.children ?? [];
    const txnCount = counts[macro.id] ?? 0;
    const isAdding = addingFor === macro.id;

    return (
      <div
        key={macro.id}
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <button
          type="button"
          onClick={() => toggleExpanded(macro.id)}
          className="w-full flex items-center gap-3 py-3 cursor-pointer transition-colors hover:opacity-85"
        >
          {isExpanded ? (
            <ChevronDown
              size={16}
              style={{ color: 'var(--text-muted)' }}
              className="shrink-0"
            />
          ) : (
            <ChevronRight
              size={16}
              style={{ color: 'var(--text-muted)' }}
              className="shrink-0"
            />
          )}
          <CategoryIcon
            name={macro.icon}
            size={16}
            color="var(--text)"
          />
          <span
            className="flex-1 text-left truncate"
            style={{
              color: 'var(--text)',
              fontSize: 'var(--fs-body)',
              fontWeight: 'var(--fw-medium)',
            }}
          >
            {macro.name}
          </span>
          {txnCount > 0 && (
            <span
              className="px-2 py-0.5 rounded-full shrink-0"
              style={{
                backgroundColor: 'var(--surface-alt)',
                color: 'var(--text-muted)',
                fontSize: 'var(--fs-rate)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {txnCount}
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              startAdd(macro.id);
            }}
            className="p-1 rounded transition-opacity hover:opacity-70 cursor-pointer shrink-0"
            style={{ color: 'var(--primary)' }}
            title="Add subcategory"
          >
            <Plus size={14} />
          </button>
        </button>

        {isExpanded && (
          <div className="pb-2">
            {children.length === 0 && !isAdding && (
              <p
                className="px-8 py-2"
                style={{
                  color: 'var(--text-muted)',
                  fontSize: 'var(--fs-body-sm)',
                }}
              >
                No subcategories yet. Click + to add one.
              </p>
            )}
            {children.map((sub) => renderSubcategory(sub))}
            {isAdding && (
              <div className="flex items-center gap-2 pl-8 pr-2 py-2">
                <Input
                  value={newSubName}
                  onChange={(e) => {
                    setNewSubName(e.target.value);
                    if (addError) setAddError('');
                  }}
                  placeholder="Subcategory name"
                  error={addError}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAdd(macro.id);
                    if (e.key === 'Escape') cancelAdd();
                  }}
                />
                <button
                  type="button"
                  onClick={() => handleAdd(macro.id)}
                  disabled={saving}
                  className="p-1.5 rounded cursor-pointer disabled:opacity-50"
                  style={{ color: 'var(--income)' }}
                  title="Save"
                >
                  <Check size={16} />
                </button>
                <button
                  type="button"
                  onClick={cancelAdd}
                  className="p-1.5 rounded cursor-pointer"
                  style={{ color: 'var(--text-muted)' }}
                  title="Cancel"
                >
                  <X size={16} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderSubcategory(sub: Category) {
    const isEditing = editingId === sub.id;
    if (isEditing) {
      return (
        <div
          key={sub.id}
          className="flex items-center gap-2 pl-8 pr-2 py-2"
        >
          <Input
            value={editName}
            onChange={(e) => {
              setEditName(e.target.value);
              if (editError) setEditError('');
            }}
            error={editError}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleEditSave(sub.id);
              if (e.key === 'Escape') cancelEdit();
            }}
          />
          <button
            type="button"
            onClick={() => handleEditSave(sub.id)}
            disabled={saving}
            className="p-1.5 rounded cursor-pointer disabled:opacity-50"
            style={{ color: 'var(--income)' }}
            title="Save"
          >
            <Check size={16} />
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            className="p-1.5 rounded cursor-pointer"
            style={{ color: 'var(--text-muted)' }}
            title="Cancel"
          >
            <X size={16} />
          </button>
        </div>
      );
    }

    return (
      <div
        key={sub.id}
        className="flex items-center gap-2 pl-8 pr-2 py-2 transition-colors"
      >
        <span
          className="flex-1 min-w-0 truncate"
          style={{
            color: 'var(--text-secondary)',
            fontSize: 'var(--fs-body-sm)',
          }}
        >
          {sub.name}
        </span>
        {(subCounts[sub.id] ?? 0) > 0 && (
          <span
            className="px-2 py-0.5 rounded-full shrink-0"
            title={`${subCounts[sub.id]} transaction${subCounts[sub.id] !== 1 ? 's' : ''} use this subcategory`}
            style={{
              backgroundColor: 'var(--surface-alt)',
              color: 'var(--text-muted)',
              fontSize: 'var(--fs-rate)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {subCounts[sub.id]}
          </span>
        )}
        <button
          type="button"
          onClick={() => startEdit(sub)}
          className="p-1.5 rounded transition-opacity hover:opacity-70 cursor-pointer"
          style={{ color: 'var(--text-muted)' }}
          title="Edit"
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          onClick={() => setDeleteTarget(sub)}
          className="p-1.5 rounded transition-opacity hover:opacity-70 cursor-pointer"
          style={{ color: 'var(--danger)' }}
          title="Delete"
        >
          <Trash2 size={12} />
        </button>
      </div>
    );
  }

  function renderColumn(
    type: 'expense' | 'income',
    title: string,
    macros: Category[],
  ) {
    const isAdding = addingMacroType === type;
    return (
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2
            className="text-lg font-semibold"
            style={{ color: 'var(--text)', fontFamily: 'var(--font-head)' }}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={() => (isAdding ? cancelAddMacro() : startAddMacro(type))}
            className="inline-flex items-center gap-1 px-2 py-1 rounded cursor-pointer transition-opacity hover:opacity-80"
            style={{
              color: 'var(--primary)',
              fontSize: 'var(--fs-body-sm)',
              fontWeight: 'var(--fw-medium)',
              border: '1px solid color-mix(in srgb, var(--primary) 30%, transparent)',
            }}
            title={isAdding ? 'Cancel' : 'Add a new top-level category'}
          >
            {isAdding ? <X size={14} /> : <Plus size={14} />}
            {isAdding ? 'Cancel' : 'New category'}
          </button>
        </div>

        {isAdding && (
          <div
            className="flex items-center gap-2 mb-3 p-2 rounded"
            style={{
              backgroundColor: 'var(--surface-alt)',
              border: '1px solid var(--border)',
            }}
          >
            <Input
              value={newMacroName}
              onChange={(e) => {
                setNewMacroName(e.target.value);
                if (newMacroError) setNewMacroError('');
              }}
              placeholder="Category name"
              error={newMacroError}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddMacro();
                if (e.key === 'Escape') cancelAddMacro();
              }}
            />
            <button
              type="button"
              onClick={handleAddMacro}
              disabled={saving}
              className="p-1.5 rounded cursor-pointer disabled:opacity-50"
              style={{ color: 'var(--income)' }}
              title="Save"
            >
              <Check size={16} />
            </button>
            <button
              type="button"
              onClick={cancelAddMacro}
              className="p-1.5 rounded cursor-pointer"
              style={{ color: 'var(--text-muted)' }}
              title="Cancel"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {macros.length === 0 && !isAdding ? (
          <p
            className="text-sm py-4 text-center"
            style={{ color: 'var(--text-muted)' }}
          >
            No {type} categories yet.
          </p>
        ) : (
          <div>{macros.map(renderMacro)}</div>
        )}
      </Card>
    );
  }

  return (
    <div>
      <PageHeader
        serif
        label="Overview"
        title="Categories"
        subtitle="Organize your transactions. Add your own top-level categories, or create subcategories under any existing macro."
      />

      {loading ? (
        <Card>
          <p
            className="text-center py-12"
            style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}
          >
            Loading...
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {renderColumn('expense', 'Expense categories', expenseMacros)}
          {renderColumn('income', 'Income categories', incomeMacros)}
        </div>
      )}

      <Modal
        open={deleteTarget !== null}
        onClose={() => { setDeleteTarget(null); setDeleteError(null); }}
        title="Delete subcategory?"
      >
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          Are you sure you want to delete{' '}
          <strong style={{ color: 'var(--text)' }}>{deleteTarget?.name}</strong>?
          Any transactions using this subcategory will be moved to the
          parent macro category.
        </p>
        {deleteError && (
          <p className="text-sm mb-4" style={{ color: 'var(--danger)' }}>
            {deleteError}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button
            variant="ghost"
            onClick={() => { setDeleteTarget(null); setDeleteError(null); }}
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
