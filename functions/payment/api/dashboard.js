import { query, queryFirst, execute } from '../../../lib/db.js';
import { calculateBalance, getPaymentStreaks, formatCurrency } from '../../../lib/interest.js';
import { getAccessToken, fetchSheetRows, matchTransactions } from '../../../lib/monzo.js';

// Background Monzo sync — runs if 30+ minutes since last sync
async function tryAutoSync(env) {
  try {
    const config = await queryFirst(env.DB, 'SELECT * FROM monzo_config WHERE id = 1');
    if (!config?.google_sheet_id || !env.GOOGLE_SA_KEY) return;

    // Check if enough time has passed
    if (config.last_sync_at) {
      const lastSync = new Date(config.last_sync_at).getTime();
      const interval = (config.sync_interval_minutes || 30) * 60 * 1000;
      if (Date.now() - lastSync < interval) return;
    }

    // Get pending payments and active criteria
    const pendingPayments = await query(env.DB, "SELECT * FROM payments WHERE status = 'pending' ORDER BY payment_date ASC");
    if (pendingPayments.length === 0) {
      await execute(env.DB, "UPDATE monzo_config SET last_sync_at = datetime('now') WHERE id = 1");
      return;
    }

    const nameRows = await query(env.DB, 'SELECT * FROM monzo_names WHERE is_active = 1');
    if (nameRows.length === 0) return;

    const namePatterns = nameRows.map(r => r.name_pattern);

    // Get already-matched Transaction IDs
    const matchedRows = await query(env.DB, 'SELECT monzo_match_ref FROM payments WHERE monzo_match_ref IS NOT NULL');
    const alreadyMatchedTxIds = matchedRows.map(r => r.monzo_match_ref);

    // Fetch sheet
    const accessToken = await getAccessToken(env.GOOGLE_SA_KEY);
    const rows = await fetchSheetRows(accessToken, config.google_sheet_id, config.sheet_name || 'Personal Account Transactions');
    if (rows.length < 2) return;

    const matches = matchTransactions(rows, pendingPayments, namePatterns, alreadyMatchedTxIds);

    // Auto-validate matched payments
    for (const match of matches) {
      await execute(env.DB,
        "UPDATE payments SET status = 'validated', validated_at = datetime('now'), validation_source = 'monzo', monzo_match_ref = ? WHERE id = ?",
        [match.matchedTxId, match.paymentId]
      );
      await execute(env.DB,
        'INSERT INTO audit_log (action, details) VALUES (?, ?)',
        ['monzo_auto_validated', JSON.stringify({ paymentId: match.paymentId, matchedTxId: match.matchedTxId, trigger: 'dashboard_load' })]
      );
    }

    await execute(env.DB, "UPDATE monzo_config SET last_sync_at = datetime('now') WHERE id = 1");
  } catch (e) {
    // Silent fail — don't block dashboard load
  }
}

export async function onRequestGet(context) {
  const { env } = context;

  try {
    // Fire Monzo sync in background (non-blocking via waitUntil)
    context.waitUntil(tryAutoSync(env));

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
        accruedSinceLastPayment: parseFloat(result.accruedSinceLastPayment.toFixed(2)),
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
