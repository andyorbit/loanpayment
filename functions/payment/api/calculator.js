import { queryFirst, query } from '../../../lib/db.js';
import { calculateBalance, calculateProjection } from '../../../lib/interest.js';

export async function onRequestGet(context) {
  const { env } = context;
  const url = new URL(context.request.url);
  const monthlyPayment = parseFloat(url.searchParams.get('monthly') || '200');
  const lumpSum = parseFloat(url.searchParams.get('lump') || '0');

  try {
    const loanConfig = await queryFirst(env.DB, 'SELECT * FROM loan_config WHERE id = 1');
    const payments = await query(env.DB, 'SELECT * FROM payments WHERE status != ? ORDER BY payment_date ASC', ['rejected']);
    const rateChanges = await query(env.DB, 'SELECT * FROM rate_changes ORDER BY effective_date ASC');

    const result = calculateBalance(loanConfig, payments, rateChanges);

    // Current balance adjusted for potential lump sum
    const adjustedBalance = Math.max(result.currentBalance - lumpSum, 0);

    // Project with monthly payment
    const projection = calculateProjection(adjustedBalance, loanConfig.annual_rate, monthlyPayment);

    // Also project current pace (if they keep paying at their average rate)
    const avgMonthlyPayment = result.totalPaid > 0 && payments.length > 0
      ? result.totalPaid / Math.max(1, monthsDiff(loanConfig.start_date, new Date().toISOString().split('T')[0]))
      : 0;

    const currentPaceProjection = avgMonthlyPayment > 0
      ? calculateProjection(result.currentBalance, loanConfig.annual_rate, avgMonthlyPayment)
      : null;

    return Response.json({
      currentBalance: parseFloat(result.currentBalance.toFixed(2)),
      projection: {
        monthlyPayment,
        lumpSum,
        payoffDate: projection.payoffDate,
        totalInterest: parseFloat(projection.totalInterest.toFixed(2)),
        monthlySnapshots: projection.monthlySnapshots
      },
      currentPace: currentPaceProjection ? {
        avgMonthlyPayment: parseFloat(avgMonthlyPayment.toFixed(2)),
        payoffDate: currentPaceProjection.payoffDate,
        totalInterest: parseFloat(currentPaceProjection.totalInterest.toFixed(2))
      } : null,
      interestSaved: currentPaceProjection
        ? parseFloat((currentPaceProjection.totalInterest - projection.totalInterest).toFixed(2))
        : null
    });
  } catch (err) {
    return Response.json({ error: 'Calculation error: ' + err.message }, { status: 500 });
  }
}

function monthsDiff(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) || 1;
}
