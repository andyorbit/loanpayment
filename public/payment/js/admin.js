/* ============================================================
   Admin Panel – Alpine.js component
   Family Loan Tracker
   ============================================================ */

document.addEventListener('alpine:init', () => {
  Alpine.data('adminPanel', () => ({

    /* ── State ─────────────────────────────────────────────── */
    loading: true,
    error: null,
    successMsg: null,

    // Payments
    payments: [],
    paymentsLoading: true,

    // Inline edit state: { [id]: { amount, date, note } }
    editingId: null,
    editDraft: { amount: '', date: '', note: '' },

    // Settings
    settings: null,
    settingsDraft: { originalAmount: '', startDate: '', annualRate: '' },
    settingsLoading: true,
    settingsSaving: false,

    // Password change
    newPassword: '',
    confirmPassword: '',
    passwordError: '',
    passwordSaving: false,

    // Audit log
    auditLog: [],
    expandedAuditId: null,

    // Active section (for mobile accordion / tab feel)
    activeSection: 'payments',

    /* ── Init ──────────────────────────────────────────────── */
    async init() {
      await Promise.all([
        this.fetchPayments(),
        this.fetchSettings(),
        this.fetchMonzoConfig(),
      ]);
      this.loading = false;
    },

    /* ── Auth guard ────────────────────────────────────────── */
    handleAuthError(res) {
      if (res.status === 401) {
        window.location.href = '/payment/admin/login';
        return true;
      }
      return false;
    },

    /* ── Flash messages ────────────────────────────────────── */
    flash(msg, isError = false) {
      if (isError) {
        this.error = msg;
        setTimeout(() => { this.error = null; }, 5000);
      } else {
        this.successMsg = msg;
        setTimeout(() => { this.successMsg = null; }, 3500);
      }
    },

    /* ── Payments ──────────────────────────────────────────── */
    async fetchPayments() {
      this.paymentsLoading = true;
      try {
        const res = await fetch('/payment/api/payments');
        if (this.handleAuthError(res)) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.payments = data.payments || data || [];
      } catch (e) {
        this.flash('Failed to load payments: ' + e.message, true);
      } finally {
        this.paymentsLoading = false;
      }
    },

    get pendingPayments() {
      return this.payments.filter(p => p.status === 'pending');
    },

    get pendingCount() {
      return this.pendingPayments.length;
    },

    formatDate(dateStr) {
      if (!dateStr) return '—';
      try {
        return new Date(dateStr).toLocaleDateString('en-GB', {
          day: '2-digit', month: 'short', year: 'numeric'
        });
      } catch { return dateStr; }
    },

    formatAmount(amount) {
      if (amount == null) return '—';
      return '£' + Number(amount).toFixed(2);
    },

    statusBadgeClass(status) {
      switch (status) {
        case 'validated': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
        case 'rejected':  return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
        default:          return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
      }
    },

    statusLabel(status) {
      switch (status) {
        case 'validated': return 'Validated';
        case 'rejected':  return 'Rejected';
        default:          return 'Pending';
      }
    },

    /* Inline edit */
    startEdit(payment) {
      this.editingId = payment.id;
      this.editDraft = {
        amount: payment.amount ?? '',
        date:   payment.date   ? payment.date.slice(0, 10) : '',
        note:   payment.note   ?? '',
      };
    },

    cancelEdit() {
      this.editingId = null;
      this.editDraft = { amount: '', date: '', note: '' };
    },

    async saveEdit(id) {
      try {
        const res = await fetch(`/payment/api/payments/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: parseFloat(this.editDraft.amount),
            date:   this.editDraft.date,
            note:   this.editDraft.note,
          })
        });
        if (this.handleAuthError(res)) return;
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || `HTTP ${res.status}`);
        }
        const updated = await res.json();
        const idx = this.payments.findIndex(p => p.id === id);
        if (idx !== -1) {
          this.payments[idx] = { ...this.payments[idx], ...updated.payment || updated };
        }
        this.cancelEdit();
        this.flash('Payment updated.');
      } catch (e) {
        this.flash('Save failed: ' + e.message, true);
      }
    },

    async setStatus(id, status) {
      try {
        const res = await fetch(`/payment/api/payments/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status })
        });
        if (this.handleAuthError(res)) return;
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || `HTTP ${res.status}`);
        }
        const updated = await res.json();
        const idx = this.payments.findIndex(p => p.id === id);
        if (idx !== -1) {
          this.payments[idx] = { ...this.payments[idx], ...updated.payment || updated };
        }
        this.flash(`Payment ${status}.`);
      } catch (e) {
        this.flash(`Failed to ${status}: ` + e.message, true);
      }
    },

    async deletePayment(id) {
      const payment = this.payments.find(p => p.id === id);
      const label = payment ? this.formatAmount(payment.amount) + ' on ' + this.formatDate(payment.date) : `#${id}`;
      if (!confirm(`Delete payment ${label}?\n\nThis cannot be undone.`)) return;
      try {
        const res = await fetch(`/payment/api/payments/${id}`, { method: 'DELETE' });
        if (this.handleAuthError(res)) return;
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || `HTTP ${res.status}`);
        }
        this.payments = this.payments.filter(p => p.id !== id);
        this.flash('Payment deleted.');
      } catch (e) {
        this.flash('Delete failed: ' + e.message, true);
      }
    },

    /* ── Loan Settings ─────────────────────────────────────── */
    async fetchSettings() {
      this.settingsLoading = true;
      try {
        const res = await fetch('/payment/api/admin/settings');
        if (this.handleAuthError(res)) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.settings = data;
        this.auditLog = (data.auditLog || []).slice().reverse();
        this.settingsDraft = {
          originalAmount: data.originalAmount ?? '',
          startDate:      data.startDate      ? data.startDate.slice(0, 10) : '',
          annualRate:     data.annualRate      ?? '',
        };
      } catch (e) {
        this.flash('Failed to load settings: ' + e.message, true);
      } finally {
        this.settingsLoading = false;
      }
    },

    async saveSettings() {
      this.settingsSaving = true;
      try {
        const res = await fetch('/payment/api/admin/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originalAmount: parseFloat(this.settingsDraft.originalAmount),
            startDate:      this.settingsDraft.startDate,
            annualRate:     parseFloat(this.settingsDraft.annualRate),
          })
        });
        if (this.handleAuthError(res)) return;
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        this.settings = data;
        this.auditLog = (data.auditLog || []).slice().reverse();
        this.flash('Loan settings saved.');
      } catch (e) {
        this.flash('Save failed: ' + e.message, true);
      } finally {
        this.settingsSaving = false;
      }
    },

    get rateHistory() {
      if (!this.settings || !this.settings.rateHistory) return [];
      return this.settings.rateHistory.slice().reverse();
    },

    /* ── Password change ───────────────────────────────────── */
    async changePassword() {
      this.passwordError = '';
      if (!this.newPassword) {
        this.passwordError = 'Password cannot be empty.';
        return;
      }
      if (this.newPassword !== this.confirmPassword) {
        this.passwordError = 'Passwords do not match.';
        return;
      }
      this.passwordSaving = true;
      try {
        const res = await fetch('/payment/api/admin/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: this.newPassword })
        });
        if (this.handleAuthError(res)) return;
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || `HTTP ${res.status}`);
        }
        this.newPassword = '';
        this.confirmPassword = '';
        this.flash('Password updated successfully.');
      } catch (e) {
        this.passwordError = 'Failed: ' + e.message;
      } finally {
        this.passwordSaving = false;
      }
    },

    /* ── Theme toggle ──────────────────────────────────────── */
    toggleDarkMode() {
      const isDark = document.documentElement.classList.contains('dark');
      localStorage.setItem('darkMode', String(isDark));
    },

    /* ── Monzo / Sheets ────────────────────────────────────── */
    monzoSheetId: '',
    monzoSheetName: 'Personal Account Transactions',
    monzoCriteriaGroups: {},
    monzoLastSync: null,
    monzoSyncing: false,
    monzoLoading: false,
    monzoAvailableFields: ['Name', 'Description', 'Notes and #tags', 'Type', 'Category'],
    monzoAvailableMatchTypes: ['contains', 'exact', 'starts_with', 'ends_with'],
    monzoSyncResult: null,
    newGroupName: '',

    matchTypeLabel(mt) {
      switch (mt) {
        case 'contains': return 'contains';
        case 'exact': return 'exact';
        case 'starts_with': return 'starts with';
        case 'ends_with': return 'ends with';
        default: return mt;
      }
    },

    async fetchMonzoConfig() {
      this.monzoLoading = true;
      try {
        const res = await fetch('/payment/api/admin/monzo');
        if (this.handleAuthError(res)) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.monzoSheetId = data.config?.google_sheet_id || '';
        this.monzoSheetName = data.config?.sheet_name || 'Personal Account Transactions';
        this.monzoLastSync = data.config?.last_sync_at || null;
        this.monzoCriteriaGroups = data.criteriaGroups || {};
        if (data.availableFields) this.monzoAvailableFields = data.availableFields;
        if (data.availableMatchTypes) this.monzoAvailableMatchTypes = data.availableMatchTypes;
      } catch (e) {
        this.flash('Failed to load Monzo config: ' + e.message, true);
      } finally {
        this.monzoLoading = false;
      }
    },

    async saveMonzoConfig() {
      try {
        const res = await fetch('/payment/api/admin/monzo', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ google_sheet_id: this.monzoSheetId, sheet_name: this.monzoSheetName })
        });
        if (this.handleAuthError(res)) return;
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || `HTTP ${res.status}`); }
        this.flash('Monzo config saved.');
      } catch (e) {
        this.flash('Save failed: ' + e.message, true);
      }
    },

    async addCriterionGroup() {
      const name = this.newGroupName.trim();
      if (!name) return;
      if (this.monzoCriteriaGroups[name]) {
        this.flash('Group already exists.', true);
        return;
      }
      // Add a default criterion to the new group
      try {
        const res = await fetch('/payment/api/admin/monzo', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ add_criterion: { group_name: name, field: 'Name', match_type: 'contains', match_value: '' } })
        });
        if (this.handleAuthError(res)) return;
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || `HTTP ${res.status}`); }
        this.newGroupName = '';
        await this.fetchMonzoConfig();
      } catch (e) {
        this.flash('Failed to add group: ' + e.message, true);
      }
    },

    async addCriterion(groupName) {
      try {
        const res = await fetch('/payment/api/admin/monzo', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ add_criterion: { group_name: groupName, field: 'Name', match_type: 'contains', match_value: '' } })
        });
        if (this.handleAuthError(res)) return;
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || `HTTP ${res.status}`); }
        await this.fetchMonzoConfig();
      } catch (e) {
        this.flash('Failed to add criterion: ' + e.message, true);
      }
    },

    async updateCriterion(criterion) {
      try {
        const res = await fetch('/payment/api/admin/monzo', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ update_criterion: { id: criterion.id, field: criterion.field, match_type: criterion.match_type, match_value: criterion.match_value, is_active: criterion.is_active } })
        });
        if (this.handleAuthError(res)) return;
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || `HTTP ${res.status}`); }
      } catch (e) {
        this.flash('Update failed: ' + e.message, true);
      }
    },

    async removeCriterion(id) {
      if (!confirm('Remove this criterion?')) return;
      try {
        const res = await fetch('/payment/api/admin/monzo', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ remove_criterion: { id } })
        });
        if (this.handleAuthError(res)) return;
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || `HTTP ${res.status}`); }
        await this.fetchMonzoConfig();
      } catch (e) {
        this.flash('Remove failed: ' + e.message, true);
      }
    },

    async deleteGroup(groupName) {
      if (!confirm(`Delete group "${groupName}" and all its criteria?`)) return;
      const criteria = this.monzoCriteriaGroups[groupName] || [];
      try {
        for (const c of criteria) {
          await fetch('/payment/api/admin/monzo', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ remove_criterion: { id: c.id } })
          });
        }
        await this.fetchMonzoConfig();
        this.flash(`Group "${groupName}" deleted.`);
      } catch (e) {
        this.flash('Delete failed: ' + e.message, true);
      }
    },

    async renameGroup(oldName) {
      const newName = prompt('New group name:', oldName);
      if (!newName || newName.trim() === oldName) return;
      try {
        const res = await fetch('/payment/api/admin/monzo', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rename_group: { old_name: oldName, new_name: newName.trim() } })
        });
        if (this.handleAuthError(res)) return;
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || `HTTP ${res.status}`); }
        await this.fetchMonzoConfig();
        this.flash(`Group renamed to "${newName.trim()}".`);
      } catch (e) {
        this.flash('Rename failed: ' + e.message, true);
      }
    },

    async syncMonzo() {
      this.monzoSyncing = true;
      this.monzoSyncResult = null;
      try {
        const res = await fetch('/payment/api/admin/monzo', { method: 'POST' });
        if (this.handleAuthError(res)) return;
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        this.monzoSyncResult = data;
        this.monzoLastSync = new Date().toISOString();
        this.flash(data.message || 'Sync complete.');
        await this.fetchPayments();
      } catch (e) {
        this.flash('Sync failed: ' + e.message, true);
      } finally {
        this.monzoSyncing = false;
      }
    },

    /* ── Audit log ─────────────────────────────────────────── */
    toggleAuditRow(id) {
      this.expandedAuditId = this.expandedAuditId === id ? null : id;
    },

    formatAuditTime(ts) {
      if (!ts) return '—';
      try {
        return new Date(ts).toLocaleString('en-GB', {
          day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
      } catch { return ts; }
    },

    formatAuditDetails(details) {
      if (!details) return '';
      try {
        return JSON.stringify(typeof details === 'string' ? JSON.parse(details) : details, null, 2);
      } catch { return String(details); }
    },

  }));
});
