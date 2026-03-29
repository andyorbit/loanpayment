/* ============================================================
   Family Loan Tracker – Alpine.js dashboard component
   ============================================================ */

document.addEventListener('alpine:init', () => {

  Alpine.data('dashboard', () => ({

    // ── State ─────────────────────────────────────────────────
    loading: true,
    error: null,
    data: null,

    // Payment form
    showCustomDate: false,
    paymentAmount: '',
    paymentDate: new Date().toISOString().split('T')[0],
    paymentNote: '',
    submitting: false,
    formError: null,
    formSuccess: false,

    // Milestones
    milestone: null,

    // Today display
    get todayFormatted() {
      return new Date().toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });
    },

    // ── Lifecycle ─────────────────────────────────────────────
    async init() {
      await this.fetchDashboard();

      // Wait one tick for DOM, then draw charts
      this.$nextTick(() => this.initCharts());
    },

    // ── Data fetching ─────────────────────────────────────────
    async fetchDashboard() {
      this.loading = true;
      this.error = null;
      try {
        const res = await fetch('/payment/api/dashboard');
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        this.data = await res.json();
      } catch (err) {
        this.error = err.message || 'Could not load dashboard.';
      } finally {
        this.loading = false;
      }
    },

    // ── Payment submission ─────────────────────────────────────
    async submitPayment() {
      this.formError = null;
      this.formSuccess = false;

      const amount = parseFloat(this.paymentAmount);
      if (!this.paymentAmount || isNaN(amount) || amount <= 0) {
        this.formError = 'Please enter a valid amount greater than £0.00';
        return;
      }
      if (amount > 100000) {
        this.formError = 'Amount seems too large – please check.';
        return;
      }

      this.submitting = true;

      try {
        const payload = {
          amount,
          note: this.paymentNote.trim() || null,
          custom_date: this.showCustomDate,
          payment_date: this.showCustomDate ? this.paymentDate : new Date().toISOString().split('T')[0],
        };

        const res = await fetch('/payment/api/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const result = await res.json();

        if (!res.ok || result.error) {
          throw new Error(result.error || `HTTP ${res.status}`);
        }

        // Reset form
        this.paymentAmount = '';
        this.paymentNote = '';
        this.showCustomDate = false;
        this.formSuccess = true;

        // Handle milestone
        if (result.milestone) {
          this.milestone = result.milestone;
          this._fireConfetti();
          // Auto-dismiss after 8s
          setTimeout(() => { this.milestone = null; }, 8000);
        }

        // Reload dashboard data and redraw charts
        await this.fetchDashboard();
        this.$nextTick(() => this.initCharts());

        // Clear success message after 4s
        setTimeout(() => { this.formSuccess = false; }, 4000);

      } catch (err) {
        this.formError = err.message || 'Failed to record payment.';
      } finally {
        this.submitting = false;
      }
    },

    // ── Charts ─────────────────────────────────────────────────
    initCharts() {
      if (!this.data || !window.PayCharts) return;
      const cd = this.data.chartData;

      if (cd.balanceOverTime && cd.balanceOverTime.length > 0) {
        PayCharts.initBalanceChart('chart-balance', cd.balanceOverTime);
      }

      if (cd.paymentBreakdowns && cd.paymentBreakdowns.length > 0) {
        PayCharts.initBreakdownChart('chart-breakdown', cd.paymentBreakdowns);
      }

      if (this.data.summary) {
        PayCharts.initDoughnutChart('chart-doughnut', {
          totalPaid: this.data.summary.totalPaid,
          totalInterest: this.data.summary.totalInterest,
          outstandingBalance: this.data.summary.outstandingBalance,
        });
      }
    },

    // ── Dark mode ──────────────────────────────────────────────
    toggleDarkMode() {
      document.documentElement.classList.toggle('dark');
      const isDark = document.documentElement.classList.contains('dark');
      localStorage.setItem('darkMode', String(isDark));
      // Update charts if they exist
      if (window.PayCharts && typeof window.PayCharts.updateTheme === 'function') {
        setTimeout(() => window.PayCharts.updateTheme(), 100);
      }
    },

    // Computed: preview of interest vs capital split for current payment amount
    get paymentPreview() {
      const amount = parseFloat(this.paymentAmount);
      if (!amount || amount <= 0 || !this.data) return null;

      // Use the real accrued interest from the backend engine
      // Standard loan repayment: payment covers accrued interest first,
      // then remainder reduces principal
      const accruedInterest = this.data.summary.accruedSinceLastPayment || 0;

      const interestPortion = Math.min(amount, accruedInterest);
      const capitalPortion = amount - interestPortion;
      const interestPercent = amount > 0 ? (interestPortion / amount * 100) : 0;
      const capitalPercent = amount > 0 ? (capitalPortion / amount * 100) : 0;

      return {
        interestPortion: interestPortion.toFixed(2),
        capitalPortion: capitalPortion.toFixed(2),
        interestPercent: interestPercent.toFixed(0),
        capitalPercent: capitalPercent.toFixed(0),
        accruedInterest: accruedInterest.toFixed(2)
      };
    },

    // ── Computed helpers ───────────────────────────────────────
    formatCurrency(amount) {
      return '£' + Number(amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    formatPercent(value) {
      return Number(value).toFixed(1) + '%';
    },

    formatDays(days) {
      if (days === null || days === undefined) return '—';
      if (days === 0) return 'Today';
      if (days === 1) return '1 day';
      return days + ' days';
    },

    // Urgency banner config based on daysSinceLastPayment
    get urgency() {
      const days = this.data?.streakData?.daysSinceLastPayment;
      if (days === null || days === undefined) {
        return { cls: 'amber', icon: '⚠️', message: 'No payments recorded yet.' };
      }
      if (days < 14) {
        return {
          cls: 'green',
          icon: '✓',
          message: `Last payment ${this.formatDays(days)} ago – you're on track!`,
        };
      }
      if (days < 30) {
        return {
          cls: 'amber',
          icon: '⚠',
          message: `Last payment ${this.formatDays(days)} ago – consider making a payment soon.`,
        };
      }
      return {
        cls: 'red',
        icon: '!',
        message: `Last payment ${this.formatDays(days)} ago – interest is accumulating.`,
      };
    },

    // Progress ring SVG stroke-dashoffset
    progressRingOffset(percent) {
      const r = 44; // must match SVG r attribute
      const circumference = 2 * Math.PI * r;
      const progress = Math.min(100, Math.max(0, percent));
      return circumference - (progress / 100) * circumference;
    },

    progressCircumference() {
      return 2 * Math.PI * 44;
    },

    // Active nav detection
    isActivePage(path) {
      return window.location.pathname.replace(/\/$/, '') === path.replace(/\/$/, '');
    },

    // ── Confetti ───────────────────────────────────────────────
    _fireConfetti() {
      if (typeof confetti === 'undefined') return;

      const count = 220;
      const defaults = { origin: { y: 0.6 } };

      function fire(particleRatio, opts) {
        confetti(Object.assign({}, defaults, opts, {
          particleCount: Math.floor(count * particleRatio),
        }));
      }

      fire(0.25, { spread: 26, startVelocity: 55 });
      fire(0.20, { spread: 60 });
      fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
      fire(0.10, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
      fire(0.10, { spread: 120, startVelocity: 45 });
    },

  }));

});
