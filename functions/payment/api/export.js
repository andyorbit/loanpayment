import { query, queryFirst } from '../../../lib/db.js';
import { calculateBalance } from '../../../lib/interest.js';

export async function onRequestGet(context) {
  const { env } = context;
  const url = new URL(context.request.url);
  const format = url.searchParams.get('format') || 'csv';

  if (format !== 'csv') {
    return Response.json({ error: 'Only CSV format supported server-side' }, { status: 400 });
  }

  const loanConfig = await queryFirst(env.DB, 'SELECT * FROM loan_config WHERE id = 1');
  const payments = await query(env.DB, 'SELECT * FROM payments ORDER BY payment_date ASC');
  const rateChanges = await query(env.DB, 'SELECT * FROM rate_changes ORDER BY effective_date ASC');

  // Calculate breakdowns
  const validPayments = payments.filter(p => p.status !== 'rejected');
  const result = calculateBalance(loanConfig, validPayments, rateChanges);

  // Build CSV
  const headers = ['Date', 'Amount', 'Interest Portion', 'Capital Portion', 'Running Balance', 'Status', 'Note'];
  const rows = [headers.join(',')];

  for (const payment of payments) {
    const breakdown = result.paymentBreakdowns.find(b => b.paymentId === payment.id);
    rows.push([
      payment.payment_date,
      payment.amount.toFixed(2),
      breakdown ? breakdown.interestPortion.toFixed(2) : 'N/A',
      breakdown ? breakdown.capitalPortion.toFixed(2) : 'N/A',
      breakdown ? breakdown.balanceAfter.toFixed(2) : 'N/A',
      payment.status,
      `"${(payment.note || '').replace(/"/g, '""')}"`
    ].join(','));
  }

  // Add summary row
  rows.push('');
  rows.push(`Loan Summary`);
  rows.push(`Original Amount,${loanConfig.original_amount.toFixed(2)}`);
  rows.push(`Start Date,${loanConfig.start_date}`);
  rows.push(`Annual Rate,${(loanConfig.annual_rate * 100).toFixed(1)}%`);
  rows.push(`Total Paid,${result.totalPaid.toFixed(2)}`);
  rows.push(`Total Interest Accrued,${result.totalInterest.toFixed(2)}`);
  rows.push(`Outstanding Balance,${result.currentBalance.toFixed(2)}`);

  const csv = rows.join('\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="loan-payments-${new Date().toISOString().split('T')[0]}.csv"`
    }
  });
}
