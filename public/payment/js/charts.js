/* ============================================================
   PayCharts – Chart.js helpers
   Exposed as window.PayCharts for Alpine to call.
   ============================================================ */

(function () {
  'use strict';

  // ── Colour helpers ─────────────────────────────────────────

  function isDark() {
    return document.documentElement.classList.contains('dark');
  }

  function palette() {
    const dark = isDark();
    return {
      indigo:        dark ? '#818cf8' : '#6366f1',
      indigoFill:    dark ? 'rgba(129,140,248,0.18)' : 'rgba(99,102,241,0.12)',
      indigoFill2:   dark ? 'rgba(129,140,248,0.00)' : 'rgba(99,102,241,0.00)',
      green:         dark ? '#4ade80' : '#22c55e',
      greenFill:     dark ? 'rgba(74,222,128,0.7)'  : 'rgba(34,197,94,0.8)',
      amber:         dark ? '#fbbf24' : '#f59e0b',
      amberFill:     dark ? 'rgba(251,191,36,0.7)'  : 'rgba(245,158,11,0.8)',
      gridLine:      dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      tickColor:     dark ? '#8b89b0' : '#9ca3af',
      tooltipBg:     dark ? '#19182d' : '#ffffff',
      tooltipBorder: dark ? '#2a2847' : '#e5e7eb',
      tooltipText:   dark ? '#f0effe' : '#1a1836',
    };
  }

  // ── Shared defaults ─────────────────────────────────────────

  function baseFont() {
    return { family: "'DM Sans', system-ui, sans-serif", size: 12 };
  }

  function tooltipStyle(c) {
    return {
      backgroundColor: c.tooltipBg,
      borderColor: c.tooltipBorder,
      borderWidth: 1,
      borderRadius: 8,
      padding: 10,
      titleColor: c.tooltipText,
      bodyColor: c.tooltipText,
      titleFont: { family: baseFont().family, size: 12, weight: '600' },
      bodyFont: { family: "'DM Mono', monospace", size: 12 },
      displayColors: true,
      boxPadding: 4,
    };
  }

  function gridStyle(c) {
    return {
      color: c.gridLine,
      drawBorder: false,
    };
  }

  function tickStyle(c) {
    return { color: c.tickColor, font: baseFont() };
  }

  // ── Register chart instances so we can destroy/recreate ─────

  const _instances = {};

  function register(id, chart) {
    if (_instances[id]) {
      _instances[id].destroy();
    }
    _instances[id] = chart;
  }

  // ── Balance Over Time (line) ────────────────────────────────

  function initBalanceChart(canvasId, balanceOverTime) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    const c = palette();

    const labels = balanceOverTime.map(d => d.date);
    const values = balanceOverTime.map(d => d.balance);

    const chart = new Chart(el, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Balance (£)',
          data: values,
          borderColor: c.indigo,
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: c.indigo,
          fill: true,
          backgroundColor(ctx) {
            const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, ctx.chart.height);
            gradient.addColorStop(0, c.indigoFill);
            gradient.addColorStop(1, c.indigoFill2);
            return gradient;
          },
          tension: 0.35,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipStyle(c),
            callbacks: {
              label: ctx => ' £' + Number(ctx.raw).toLocaleString('en-GB', { minimumFractionDigits: 2 }),
            },
          },
        },
        scales: {
          x: {
            grid: gridStyle(c),
            ticks: {
              ...tickStyle(c),
              maxTicksLimit: 6,
              maxRotation: 0,
              callback(val, idx) {
                const date = labels[idx];
                if (!date) return '';
                const d = new Date(date);
                return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
              },
            },
          },
          y: {
            grid: gridStyle(c),
            ticks: {
              ...tickStyle(c),
              callback: val => '£' + Number(val).toLocaleString('en-GB', { maximumFractionDigits: 0 }),
            },
            border: { dash: [4, 4], display: false },
          },
        },
      },
    });

    register(canvasId, chart);
    return chart;
  }

  // ── Payment Breakdown (stacked bar) ─────────────────────────

  function initBreakdownChart(canvasId, paymentBreakdowns) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    const c = palette();

    const labels = paymentBreakdowns.map(d => d.date);
    const capitalData = paymentBreakdowns.map(d => parseFloat(d.capitalPortion.toFixed(2)));
    const interestData = paymentBreakdowns.map(d => parseFloat(d.interestPortion.toFixed(2)));

    const chart = new Chart(el, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Capital',
            data: capitalData,
            backgroundColor: c.greenFill,
            borderRadius: 4,
            borderSkipped: false,
            stack: 'payment',
          },
          {
            label: 'Interest',
            data: interestData,
            backgroundColor: c.amberFill,
            borderRadius: 4,
            borderSkipped: false,
            stack: 'payment',
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
              font: baseFont(),
              boxWidth: 10,
              boxHeight: 10,
              borderRadius: 3,
              useBorderRadius: true,
              padding: 12,
            },
          },
          tooltip: {
            ...tooltipStyle(c),
            callbacks: {
              label: ctx => ' ' + ctx.dataset.label + ': £' + Number(ctx.raw).toLocaleString('en-GB', { minimumFractionDigits: 2 }),
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: {
              ...tickStyle(c),
              maxRotation: 45,
              callback(val, idx) {
                const date = labels[idx];
                if (!date) return '';
                const d = new Date(date);
                return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
              },
            },
          },
          y: {
            stacked: true,
            grid: gridStyle(c),
            ticks: {
              ...tickStyle(c),
              callback: val => '£' + Number(val).toLocaleString('en-GB', { maximumFractionDigits: 0 }),
            },
            border: { display: false },
          },
        },
      },
    });

    register(canvasId, chart);
    return chart;
  }

  // ── Doughnut – interest vs principal ────────────────────────

  function initDoughnutChart(canvasId, data) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    const c = palette();

    // data: { totalPaid, totalInterest, outstandingBalance }
    const principal = Math.max(0, data.totalPaid - data.totalInterest);
    const interest  = Math.max(0, data.totalInterest);
    const remaining = Math.max(0, data.outstandingBalance);

    const chart = new Chart(el, {
      type: 'doughnut',
      data: {
        labels: ['Capital Repaid', 'Interest Paid', 'Remaining'],
        datasets: [{
          data: [principal, interest, remaining],
          backgroundColor: [c.greenFill, c.amberFill, isDark() ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'],
          borderColor: isDark() ? '#19182d' : '#ffffff',
          borderWidth: 3,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: c.tickColor,
              font: baseFont(),
              padding: 14,
              boxWidth: 10,
              boxHeight: 10,
              borderRadius: 3,
              useBorderRadius: true,
            },
          },
          tooltip: {
            ...tooltipStyle(c),
            callbacks: {
              label: ctx => ' £' + Number(ctx.raw).toLocaleString('en-GB', { minimumFractionDigits: 2 }),
            },
          },
        },
      },
    });

    register(canvasId, chart);
    return chart;
  }

  // ── Update all charts on theme change ───────────────────────

  function updateTheme() {
    Object.values(_instances).forEach(chart => {
      if (!chart) return;
      chart.destroy();
    });
    // Charts will be re-initialised by Alpine when it calls initCharts again
    Object.keys(_instances).forEach(k => delete _instances[k]);
  }

  // ── Public API ───────────────────────────────────────────────

  window.PayCharts = {
    initBalanceChart,
    initBreakdownChart,
    initDoughnutChart,
    updateTheme,
  };
})();
