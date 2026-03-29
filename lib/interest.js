/**
 * Interest calculation engine for loan payment tracker.
 * Daily compounding, all dates as ISO strings, all money rounded to 2dp in output.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatCurrency(amount) {
  return '£' + Math.abs(amount).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function dateRange(startDate, endDate) {
  const dates = [];
  const end = new Date(endDate + 'T00:00:00Z');
  let current = new Date(startDate + 'T00:00:00Z');
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current = new Date(current.getTime() + 86400000);
  }
  return dates;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function toISO(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Core: calculateBalance
// ---------------------------------------------------------------------------

export function calculateBalance(loanConfig, payments = [], rateChanges = []) {
  const startDate = toISO(loanConfig.start_date);
  const today = todayISO();
  const days = dateRange(startDate, today);

  let balance = loanConfig.original_amount;
  let totalInterest = 0;
  let accruedSinceLastPayment = 0;
  let paymentIndex = 0;
  let rateIndex = 0;
  let currentRate = loanConfig.annual_rate;

  const snapshots = [];
  const paymentBreakdowns = [];

  for (let i = 0; i < days.length; i++) {
    const thisDay = days[i];

    // Check for rate change on this day
    if (
      rateIndex < rateChanges.length &&
      toISO(rateChanges[rateIndex].effective_date) === thisDay
    ) {
      currentRate = rateChanges[rateIndex].new_rate;
      rateIndex++;
    }

    // Calculate daily interest
    const dailyRate = currentRate / 365;
    const dayInterest = balance * dailyRate;
    balance += dayInterest;
    totalInterest += dayInterest;
    accruedSinceLastPayment += dayInterest;

    // Check for payment(s) on this day
    while (
      paymentIndex < payments.length &&
      toISO(payments[paymentIndex].payment_date) === thisDay
    ) {
      const payment = payments[paymentIndex];
      const interestPortion = Math.min(payment.amount, accruedSinceLastPayment);
      const capitalPortion = payment.amount - interestPortion;

      balance -= payment.amount;
      balance = Math.max(balance, 0);

      paymentBreakdowns.push({
        paymentId: payment.id,
        amount: round2(payment.amount),
        interestPortion: round2(interestPortion),
        capitalPortion: round2(capitalPortion),
        balanceAfter: round2(balance),
        date: thisDay,
      });

      accruedSinceLastPayment -= interestPortion;
      accruedSinceLastPayment = Math.max(accruedSinceLastPayment, 0);
      paymentIndex++;
    }

    snapshots.push({
      date: thisDay,
      balance: round2(balance),
      interest: round2(dayInterest),
    });
  }

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

  return {
    currentBalance: round2(balance),
    totalPaid: round2(totalPaid),
    totalInterest: round2(totalInterest),
    accruedSinceLastPayment: round2(accruedSinceLastPayment),
    snapshots,
    paymentBreakdowns,
  };
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export function calculateProjection(currentBalance, annualRate, monthlyPayment) {
  const monthlySnapshots = [];
  let balance = currentBalance;
  let totalInterest = 0;
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth(); // 0-indexed

  // Cap iterations to 50 years to prevent infinite loops
  const maxMonths = 600;
  let months = 0;

  while (balance > 0 && months < maxMonths) {
    // Advance one month
    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
    months++;

    // Compound daily for this month
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const dailyRate = annualRate / 365;

    for (let d = 0; d < daysInMonth; d++) {
      const dayInterest = balance * dailyRate;
      balance += dayInterest;
      totalInterest += dayInterest;
    }

    // Apply monthly payment
    balance -= monthlyPayment;
    if (balance <= 0) {
      balance = 0;
    }

    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    monthlySnapshots.push({
      date: dateStr,
      balance: round2(balance),
    });

    if (balance === 0) break;
  }

  const payoffDate = monthlySnapshots.length > 0
    ? monthlySnapshots[monthlySnapshots.length - 1].date
    : null;

  return {
    payoffDate,
    totalInterest: round2(totalInterest),
    monthlySnapshots,
  };
}

// ---------------------------------------------------------------------------
// Payment streaks
// ---------------------------------------------------------------------------

export function getPaymentStreaks(payments = []) {
  if (payments.length === 0) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      avgGapDays: 0,
      daysSinceLastPayment: null,
    };
  }

  const today = new Date(todayISO() + 'T00:00:00Z');

  // Extract unique months (YYYY-MM) from payments, sorted
  const paymentMonths = [];
  for (const p of payments) {
    const ym = toISO(p.payment_date).slice(0, 7);
    if (paymentMonths.length === 0 || paymentMonths[paymentMonths.length - 1] !== ym) {
      paymentMonths.push(ym);
    }
  }

  // Calculate streaks of consecutive months
  let longestStreak = 1;
  let currentStreak = 1;

  for (let i = 1; i < paymentMonths.length; i++) {
    const [prevY, prevM] = paymentMonths[i - 1].split('-').map(Number);
    const [curY, curM] = paymentMonths[i].split('-').map(Number);
    const prevTotal = prevY * 12 + prevM;
    const curTotal = curY * 12 + curM;

    if (curTotal - prevTotal === 1) {
      currentStreak++;
    } else {
      currentStreak = 1;
    }
    if (currentStreak > longestStreak) {
      longestStreak = currentStreak;
    }
  }

  // Check if current streak extends to the current month
  const currentYM = todayISO().slice(0, 7);
  const lastPaymentYM = paymentMonths[paymentMonths.length - 1];
  const [lastY, lastM] = lastPaymentYM.split('-').map(Number);
  const [curY, curM] = currentYM.split('-').map(Number);
  const lastTotal = lastY * 12 + lastM;
  const curTotal = curY * 12 + curM;

  // If the last payment month is not the current or previous month, streak is broken
  if (curTotal - lastTotal > 1) {
    currentStreak = 0;
  }

  // Average gap in days between consecutive payments
  let totalGap = 0;
  for (let i = 1; i < payments.length; i++) {
    const prev = new Date(toISO(payments[i - 1].payment_date) + 'T00:00:00Z');
    const curr = new Date(toISO(payments[i].payment_date) + 'T00:00:00Z');
    totalGap += (curr - prev) / 86400000;
  }
  const avgGapDays = payments.length > 1
    ? round2(totalGap / (payments.length - 1))
    : 0;

  // Days since last payment
  const lastPaymentDate = new Date(toISO(payments[payments.length - 1].payment_date) + 'T00:00:00Z');
  const daysSinceLastPayment = Math.floor((today - lastPaymentDate) / 86400000);

  return {
    currentStreak,
    longestStreak,
    avgGapDays,
    daysSinceLastPayment,
  };
}
