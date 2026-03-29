import { query, queryFirst } from '../../../lib/db.js';
import { calculateBalance, getPaymentStreaks, formatCurrency } from '../../../lib/interest.js';

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const loanConfig = await queryFirst(env.DB, 'SELECT * FROM loan_config WHERE id = 1');
    if (!loanConfig) {
      return Response.json({ error: 'Loan not configured' }, { status: 500 });
    }

    const payments = await query(env.DB, 'SELECT * FROM payments WHERE status != ? ORDER BY payment_date ASC', ['rejected']);
    const rateChanges = await query(env.DB, 'SELECT * FROM rate_changes ORDER BY effective_date ASC');

    // Calculate full balance
    const result = calculateBalance(loanConfig, payments, rateChanges);

    // Get streaks
    const streakData = getPaymentStreaks(payments);

    // Calculate progress (total paid as percentage of original + total interest)
    const totalOwed = loanConfig.original_amount + result.totalInterest;
    const progressPercent = totalOwed > 0
      ? Math.min(((result.totalPaid / totalOwed) * 100), 100).toFixed(1)
      : 0;

    // Balance over time for chart (thin to max ~100 points)
    const snapshots = result.snapshots;
    const step = Math.max(1, Math.floor(snapshots.length / 100));
    const balanceOverTime = [];
    for (let i = 0; i < snapshots.length; i += step) {
      balanceOverTime.push({
        date: snapshots[i].date,
        balance: parseFloat(snapshots[i].balance.toFixed(2))
      });
    }
    // Always include the last point
    if (snapshots.length > 0) {
      const last = snapshots[snapshots.length - 1];
      if (balanceOverTime[balanceOverTime.length - 1]?.date !== last.date) {
        balanceOverTime.push({ date: last.date, balance: parseFloat(last.balance.toFixed(2)) });
      }
    }

    // Payment breakdowns for bar chart
    const paymentBreakdowns = result.paymentBreakdowns.map(pb => ({
      paymentId: pb.paymentId,
      date: pb.date,
      amount: pb.amount,
      interestPortion: pb.interestPortion,
      capitalPortion: pb.capitalPortion,
      balanceAfter: pb.balanceAfter
    }));

    // Monthly summary
    const monthlySummary = {};
    for (const p of payments) {
      const month = p.payment_date.substring(0, 7); // YYYY-MM
      monthlySummary[month] = (monthlySummary[month] || 0) + p.amount;
    }
    const monthlyData = Object.entries(monthlySummary).map(([month, total]) => ({
      month,
      total: parseFloat(total.toFixed(2))
    }));

    // Milestones
    const milestones = [25, 50, 75, 90].map(m => ({
      threshold: m,
      reached: parseFloat(progressPercent) >= m
    }));

    return Response.json({
      loan: {
        originalAmount: loanConfig.original_amount,
        startDate: loanConfig.start_date,
        annualRate: loanConfig.annual_rate,
        currency: loanConfig.currency_symbol || '£'
      },
      summary: {
        outstandingBalance: parseFloat(result.currentBalance.toFixed(2)),
        totalPaid: parseFloat(result.totalPaid.toFixed(2)),
        totalInterest: parseFloat(result.totalInterest.toFixed(2)),
        progressPercent: parseFloat(progressPercent),
        paymentCount: payments.length
      },
      chartData: {
        balanceOverTime,
        paymentBreakdowns,
        monthlyData
      },
      streakData: {
        currentStreak: streakData.currentStreak,
        longestStreak: streakData.longestStreak,
        avgGapDays: streakData.avgGapDays,
        daysSinceLastPayment: streakData.daysSinceLastPayment
      },
      milestones
    });
  } catch (err) {
    return Response.json({ error: 'Dashboard error: ' + err.message }, { status: 500 });
  }
}
