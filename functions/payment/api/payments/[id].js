import { query, execute, queryFirst } from '../../../../lib/db.js';
import { calculateBalance } from '../../../../lib/interest.js';

// PUT: Update payment (admin only)
export async function onRequestPut(context) {
  const { request, env, params } = context;
  const id = params.id;

  try {
    const body = await request.json();
    const { amount, payment_date, note, status } = body;

    // Get existing payment for audit log
    const existing = await queryFirst(env.DB, 'SELECT * FROM payments WHERE id = ?', [id]);
    if (!existing) {
      return Response.json({ error: 'Payment not found' }, { status: 404 });
    }

    // Build update query dynamically
    const updates = [];
    const values = [];

    if (amount !== undefined) { updates.push('amount = ?'); values.push(parseFloat(amount).toFixed(2)); }
    if (payment_date !== undefined) { updates.push('payment_date = ?'); values.push(payment_date); }
    if (note !== undefined) { updates.push('note = ?'); values.push(note); }
    if (status !== undefined) {
      updates.push('status = ?'); values.push(status);
      if (status === 'validated') {
        updates.push('validated_at = ?'); values.push(new Date().toISOString());
        updates.push('validation_source = ?'); values.push('manual');
      }
    }
    updates.push("updated_at = datetime('now')");

    values.push(id);
    await execute(env.DB, `UPDATE payments SET ${updates.join(', ')} WHERE id = ?`, values);

    // Audit log
    await execute(env.DB,
      'INSERT INTO audit_log (action, details) VALUES (?, ?)',
      ['payment_edited', JSON.stringify({ id, before: existing, changes: body })]
    );

    // Recalculate snapshots
    await recalculateSnapshots(env.DB);

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: 'Update failed: ' + err.message }, { status: 500 });
  }
}

// DELETE: Delete payment (admin only)
export async function onRequestDelete(context) {
  const { env, params } = context;
  const id = params.id;

  try {
    const existing = await queryFirst(env.DB, 'SELECT * FROM payments WHERE id = ?', [id]);
    if (!existing) {
      return Response.json({ error: 'Payment not found' }, { status: 404 });
    }

    await execute(env.DB, 'DELETE FROM payments WHERE id = ?', [id]);

    await execute(env.DB,
      'INSERT INTO audit_log (action, details) VALUES (?, ?)',
      ['payment_deleted', JSON.stringify({ id, payment: existing })]
    );

    await recalculateSnapshots(env.DB);

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: 'Delete failed: ' + err.message }, { status: 500 });
  }
}

async function recalculateSnapshots(db) {
  const loanConfig = await queryFirst(db, 'SELECT * FROM loan_config WHERE id = 1');
  const payments = await query(db, 'SELECT * FROM payments WHERE status != ? ORDER BY payment_date ASC', ['rejected']);
  const rateChanges = await query(db, 'SELECT * FROM rate_changes ORDER BY effective_date ASC');
  const result = calculateBalance(loanConfig, payments, rateChanges);

  await execute(db, 'DELETE FROM interest_snapshots');

  const stmts = [];
  for (let i = 0; i < result.snapshots.length; i += 7) {
    const s = result.snapshots[i];
    stmts.push({ sql: 'INSERT INTO interest_snapshots (snapshot_date, balance_before, interest_amount, balance_after) VALUES (?, ?, ?, ?)', params: [s.date, s.balance + s.interest, s.interest, s.balance] });
  }
  const last = result.snapshots[result.snapshots.length - 1];
  if (last && result.snapshots.length % 7 !== 1) {
    stmts.push({ sql: 'INSERT INTO interest_snapshots (snapshot_date, balance_before, interest_amount, balance_after) VALUES (?, ?, ?, ?)', params: [last.date, last.balance + last.interest, last.interest, last.balance] });
  }
  for (let i = 0; i < stmts.length; i += 50) {
    const chunk = stmts.slice(i, i + 50);
    await db.batch(chunk.map(s => db.prepare(s.sql).bind(...s.params)));
  }
}
