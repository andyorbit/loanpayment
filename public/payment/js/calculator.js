/* ============================================================
   Family Loan Tracker – Calculator / Prediction Slider
   Alpine.data('calculator', ...) + Chart.js projection chart
   ============================================================ */

(function () {
  'use strict';

  // ── Math helpers ────────────────────────────────────────────

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function addMonths(date, months) {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
  }

  function formatMonthYear(date) {
    return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }

  function monthsFromNow(date) {
    const now = new Date();
    const diff =
      (date.getFullYear() - now.getFullYear()) * 12 +
      (date.getMonth() - now.getMonth());
    return Math.max(0, diff);
  }

  /**
   * Project payoff schedule with correct interest-first repayment.
   * @param {number} currentBalance - outstanding balance today
   * @param {number} annualRate - e.g. 0.07 for 7%
   * @param {number} monthlyPayment - regular monthly payment
   * @param {Object[]} lumpSums - [{amount, monthOffset}] where monthOffset 0 = this month
   * @returns {{ payoffDate, totalInterest, months, snapshots }}
   */
  function projectPayoff(currentBalance, annualRate, monthlyPayment, lumpSums) {
    const monthlyRate = annualRate / 12;
    let balance = currentBalance;
    let totalInterest = 0;
    const snapshots = [];
    let month = 0;

    // Index lump sums by month for quick lookup
    const lumpSumByMonth = {};
    if (Array.isArray(lumpSums)) {
      for (const ls of lumpSums) {
        const m = ls.monthOffset || 0;
        lumpSumByMonth[m] = (lumpSumByMonth[m] || 0) + ls.amount;
      }
    } else if (typeof lumpSums === 'number' && lumpSums > 0) {
      // Backward compat: single number = lump sum at month 0
      lumpSumByMonth[0] = lumpSums;
    }

    // Apply month-0 lump sum before the loop (reduces balance immediately)
    if (lumpSumByMonth[0]) {
      balance = Math.max(0, balance - lumpSumByMonth[0]);
    }

    // Guard: if monthly payment can't cover interest, loan never pays off
    if (balance > 0 && monthlyPayment <= balance * monthlyRate) {
      return { payoffDate: null, totalInterest: null, months: null, snapshots: [] };
    }

    while (balance > 0.005 && month < 600) {
      month++;

      // 1. Calculate this month's interest on current balance
      const interest = round2(balance * monthlyRate);
      totalInterest += interest;
      balance += interest;

      // 2. Apply regular monthly payment (interest first, then principal)
      const payment = round2(Math.min(monthlyPayment, balance));
      const principal = round2(payment - interest);
      balance = round2(Math.max(0, balance - payment));

      // 3. Apply any lump sum scheduled for this month
      let lumpApplied = 0;
      if (lumpSumByMonth[month]) {
        lumpApplied = Math.min(lumpSumByMonth[month], balance);
        balance = round2(Math.max(0, balance - lumpApplied));
      }

      snapshots.push({
        month,
        date: addMonths(new Date(), month),
        payment: payment + lumpApplied,
        interest,
        principal: round2(principal + lumpApplied),
        balance: Math.max(0, balance),
        lumpSum: lumpApplied > 0 ? lumpApplied : undefined,
      });
    }

    return {
      payoffDate: snapshots.length ? snapshots[snapshots.length - 1].date : null,
      totalInterest: round2(totalInterest),
      months: month,
      snapshots,
    };
  }

  // ── Chart instance ──────────────────────────────────────────

  let _projChart = null;

  function isDark() {
    return document.documentElement.classList.contains('dark');
  }

  function chartPalette() {
    const dark = isDark();
    return {
      indigo:      dark ? '#818cf8' : '#6366f1',
      indigoFill:  dark ? 'rgba(129,140,248,0.15)' : 'rgba(99,102,241,0.10)',
      grey:        dark ? '#4b4975' : '#9ca3af',
      greyFill:    dark ? 'rgba(75,73,117,0.10)' : 'rgba(156,163,175,0.10)',
      gridLine:    dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      tickColor:   dark ? '#8b89b0' : '#9ca3af',
      tooltipBg:   dark ? '#19182d' : '#ffffff',
      tooltipBorder: dark ? '#2a2847' : '#e5e7eb',
      tooltipText: dark ? '#f0effe' : '#1a1836',
    };
  }

  function buildProjectionChart(canvasId, currentSnapshots, selectedSnapshots) {
    const el = document.getElementById(canvasId);
    if (!el) return;

    if (_projChart) {
      _projChart.destroy();
      _projChart = null;
    }

    const c = chartPalette();

    // Build unified month axis from the longer dataset
    const longer = currentSnapshots.length >= selectedSnapshots.length
      ? currentSnapshots
      : selectedSnapshots;

    const labels = longer.map((s) => {
      const d = s.date;
      return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
    });

    // Pad shorter dataset with zeros
    function padBalances(snaps, targetLen) {
      const vals = snaps.map((s) => s.balance);
      while (vals.length < targetLen) vals.push(0);
      return vals;
    }

    const baseFont = { family: "'DM Sans', system-ui, sans-serif", size: 12 };

    _projChart = new Chart(el, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Current pace',
            data: padBalances(currentSnapshots, longer.length),
            borderColor: c.grey,
            backgroundColor: c.greyFill,
            borderWidth: 2,
            borderDash: [6, 4],
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: true,
            tension: 0.35,
          },
          {
            label: 'Selected plan',
            data: padBalances(selectedSnapshots, longer.length),
            borderColor: c.indigo,
            backgroundColor: c.indigoFill,
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: true,
            tension: 0.35,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
              color: c.tickColor,
              font: baseFont,
              boxWidth: 20,
              boxHeight: 2,
              usePointStyle: false,
              padding: 16,
            },
          },
          tooltip: {
            backgroundColor: c.tooltipBg,
            borderColor: c.tooltipBorder,
            borderWidth: 1,
            borderRadius: 8,
            padding: 10,
            titleColor: c.tooltipText,
            bodyColor: c.tooltipText,
            titleFont: { family: baseFont.family, size: 12, weight: '600' },
            bodyFont: { family: "'DM Mono', monospace", size: 12 },
            displayColors: true,
            boxPadding: 4,
            callbacks: {
              label(ctx) {
                return ' £' + ctx.parsed.y.toLocaleString('en-GB', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                });
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: c.gridLine, drawBorder: false },
            ticks: {
              color: c.tickColor,
              font: baseFont,
              maxTicksLimit: 8,
              maxRotation: 0,
            },
          },
          y: {
            grid: { color: c.gridLine, drawBorder: false },
            ticks: {
              color: c.tickColor,
              font: { family: "'DM Mono', monospace", size: 11 },
              callback(v) {
                return '£' + v.toLocaleString('en-GB');
              },
            },
            beginAtZero: true,
          },
        },
      },
    });
  }

  // ── Alpine component ────────────────────────────────────────

  document.addEventListener('alpine:init', () => {

    Alpine.data('calculator', () => ({

      // ── State ────────────────────────────────────────────────
      loading: true,
      error: null,

      // Loan data fetched from API
      balance: 0,
      annualRate: 0,
      startDate: null,
      currentPacePayment: 0, // inferred "current pace" (avg monthly)
      currentPaceResult: null,

      // Slider
      sliderValue: 200,
      sliderMin: 50,
      sliderMax: 2000,
      sliderStep: 25,

      // Lump sums
      showLumpSums: false,
      lumpSums: [],  // [{id, amount, date, monthOffset}]
      _lumpIdCounter: 0,

      // Results (computed from slider)
      result: null,

      // Amortization table
      showFullTable: false,

      // Chart debounce timer
      _chartTimer: null,

      // ── Computed ─────────────────────────────────────────────

      get sliderDisplay() {
        return '£' + this.sliderValue.toLocaleString('en-GB');
      },

      get effectiveLumpSums() {
        if (!this.showLumpSums) return [];
        return this.lumpSums
          .filter(ls => parseFloat(ls.amount) > 0)
          .map(ls => ({
            amount: parseFloat(ls.amount),
            monthOffset: ls.monthOffset || 0
          }));
      },

      get tableRows() {
        if (!this.result || !this.result.snapshots) return [];
        return this.showFullTable
          ? this.result.snapshots
          : this.result.snapshots.slice(0, 12);
      },

      get interestSaved() {
        if (!this.result || !this.currentPaceResult) return null;
        if (this.result.totalInterest === null || this.currentPaceResult.totalInterest === null) return null;
        return round2(this.currentPaceResult.totalInterest - this.result.totalInterest);
      },

      get monthsSaved() {
        if (!this.result || !this.currentPaceResult) return null;
        if (this.result.months === null || this.currentPaceResult.months === null) return null;
        return this.currentPaceResult.months - this.result.months;
      },

      get payoffTooLong() {
        return this.result && this.result.months === null;
      },

      // ── Lifecycle ────────────────────────────────────────────

      async init() {
        await this.fetchStatus();
      },

      // ── API ──────────────────────────────────────────────────

      async fetchStatus() {
        this.loading = true;
        this.error = null;
        try {
          const res = await fetch('/payment/api/dashboard');
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${res.status}`);
          }
          const data = await res.json();

          this.balance = data.summary.outstandingBalance;
          this.annualRate = data.loan.annualRate;
          this.startDate = data.loan.startDate;

          // Infer current pace from average payment
          const avgPayment = data.summary.totalPaid / Math.max(1, data.summary.paymentCount);
          // Clamp to something sensible; fall back to £100 if no payments yet
          this.currentPacePayment = Math.max(50, Math.round(avgPayment / 25) * 25) || 100;

          // Seed slider at current pace
          this.sliderValue = Math.min(this.sliderMax, this.currentPacePayment);

        } catch (err) {
          this.error = err.message || 'Could not load loan status.';
        } finally {
          this.loading = false;
          // Compute after DOM is ready so chart canvas exists
          this.$nextTick(() => {
            this.recalculate();
          });
        }
      },

      // ── Core calculation ─────────────────────────────────────

      recalculate() {
        if (!this.balance || !this.annualRate) return;

        // Current pace (no lump sums)
        this.currentPaceResult = projectPayoff(
          this.balance,
          this.annualRate,
          this.currentPacePayment,
          [],
        );

        // Selected plan
        this.result = projectPayoff(
          this.balance,
          this.annualRate,
          this.sliderValue,
          this.effectiveLumpSums,
        );

        // Debounced chart update
        clearTimeout(this._chartTimer);
        this._chartTimer = setTimeout(() => {
          this._drawChart();
        }, 100);
      },

      // Called by slider input event
      onSliderInput() {
        this.recalculate();
      },

      // Preset buttons
      setPreset(value) {
        this.sliderValue = value;
        this.recalculate();
      },

      // Lump sum management
      addLumpSum() {
        this._lumpIdCounter++;
        this.lumpSums.push({
          id: this._lumpIdCounter,
          amount: '',
          date: new Date().toISOString().split('T')[0],
          monthOffset: 0
        });
      },

      removeLumpSum(id) {
        this.lumpSums = this.lumpSums.filter(ls => ls.id !== id);
        this.recalculate();
      },

      updateLumpSumOffset(ls) {
        // Calculate month offset from date
        const lsDate = new Date(ls.date);
        const now = new Date();
        ls.monthOffset = Math.max(0, Math.round(
          (lsDate.getFullYear() - now.getFullYear()) * 12 +
          (lsDate.getMonth() - now.getMonth())
        ));
        this.recalculate();
      },

      // ── Chart ────────────────────────────────────────────────

      _drawChart() {
        if (!this.currentPaceResult || !this.result) return;
        buildProjectionChart(
          'calc-projection-chart',
          this.currentPaceResult.snapshots,
          this.result.snapshots,
        );
      },

      // ── Dark mode ────────────────────────────────────────────

      toggleDarkMode() {
        document.documentElement.classList.toggle('dark');
        const isDark = document.documentElement.classList.contains('dark');
        localStorage.setItem('darkMode', String(isDark));
        // Update charts if they exist
        setTimeout(() => {
          this._drawChart();
        }, 100);
      },

      // ── Formatters ───────────────────────────────────────────

      formatCurrency(amount) {
        if (amount === null || amount === undefined) return '—';
        return '£' + Number(amount).toLocaleString('en-GB', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
      },

      formatMonthYear(date) {
        if (!date) return '—';
        return formatMonthYear(new Date(date));
      },

      monthsFromNowLabel(date) {
        if (!date) return '';
        const m = monthsFromNow(new Date(date));
        if (m === 0) return 'this month';
        if (m === 1) return '1 month from now';
        return m + ' months from now';
      },

      formatMonths(n) {
        if (n === null || n === undefined) return '—';
        if (n === 1) return '1 month';
        return n + ' months';
      },

      rowDate(snap) {
        return snap.date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
      },

    }));

  });

})();
