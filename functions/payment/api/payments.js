import { query, execute, queryFirst } from '../../../lib/db.js';
import { calculateBalance } from '../../../lib/interest.js';

// GET: List all payments
export async function onRequestGet(context) {
  const { env } = context;
  const payments = await query(env.DB, 'SELECT * FROM payments ORDER BY payment_date DESC, created_at DESC');
  return Response.json({ payments });
}

// POST: Create new payment
export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { amount, note, payment_date, custom_date } = body;

    if (!amount || amount <= 0) {
      return Response.json({ error: 'Valid amount required' }, { status: 400 });
    }

    // Use custom date if provided, otherwise today
    const date = custom_date ? payment_date : new Date().toISOString().split('T')[0];

    // Insert payment
    await execute(env.DB,
      'INSERT INTO payments (amount, payment_date, note, status) VALUES (?, ?, ?, ?)',
      [parseFloat(amount).toFixed(2), date, note || null, 'pending']
    );

    // Log to audit
    await execute(env.DB,
      'INSERT INTO audit_log (action, details) VALUES (?, ?)',
      ['payment_added', JSON.stringify({ amount, date, note })]
    );

    // Recalculate interest snapshots
    await recalculateSnapshots(env.DB);

    // Check for milestone
    const loanConfig = await queryFirst(env.DB, 'SELECT * FROM loan_config WHERE id = 1');
    const payments = await query(env.DB, 'SELECT * FROM payments WHERE status != ? ORDER BY payment_date ASC', ['rejected']);
    const rateChanges = await query(env.DB, 'SELECT * FROM rate_changes ORDER BY effective_date ASC');
    const result = calculateBalance(loanConfig, payments, rateChanges);

    const progressPercent = ((loanConfig.original_amount - result.currentBalance + result.totalInterest) / (loanConfig.original_amount + result.totalInterest)) * 100;
    const milestones = [25, 50, 75, 90];
    const hitMilestone = milestones.find(m => progressPercent >= m && progressPercent < m + 5);

    return Response.json({
      success: true,
      milestone: hitMilestone || null,
      currentBalance: result.currentBalance,
      progressPercent: Math.min(progressPercent, 100).toFixed(1)
    });
  } catch (err) {
    return Response.json({ error: 'Failed to create payment: ' + err.message }, { status: 500 });
  }
}

async function recalculateSnapshots(db) {
  const loanConfig = await queryFirst(db, 'SELECT * FROM loan_config WHERE id = 1');
  const payments = await query(db, 'SELECT * FROM payments WHERE status != ? ORDER BY payment_date ASC', ['rejected']);
  const rateChanges = await query(db, 'SELECT * FROM rate_changes ORDER BY effective_date ASC');

  const result = calculateBalance(loanConfig, payments, rateChanges);

  // Clear old snapshots and insert new ones
  await execute(db, 'DELETE FROM interest_snapshots');

  // Store weekly snapshots for chart efficiency (every 7th day)
  const stmts = [];
  for (let i = 0; i < result.snapshots.length; i += 7) {
    const s = result.snapshots[i];
    stmts.push({
      sql: 'INSERT INTO interest_snapshots (snapshot_date, balance_before, interest_amount, balance_after) VALUES (?, ?, ?, ?)',
      params: [s.date, s.balance + s.interest, s.interest, s.balance]
    });
  }
  // Always include latest day
  const last = result.snapshots[result.snapshots.length - 1];
  if (last && result.snapshots.length % 7 !== 1) {
    stmts.push({
      sql: 'INSERT INTO interest_snapshots (snapshot_date, balance_before, interest_amount, balance_after) VALUES (?, ?, ?, ?)',
      params: [last.date, last.balance + last.interest, last.interest, last.balance]
    });
  }

  // D1 batch limit is 100, chunk if needed
  for (let i = 0; i < stmts.length; i += 50) {
    const chunk = stmts.slice(i, i + 50);
    const batch = chunk.map(s => db.prepare(s.sql).bind(...s.params));
    await db.batch(batch);
  }
}
