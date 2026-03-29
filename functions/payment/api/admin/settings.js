import { queryFirst, execute, query } from '../../../../lib/db.js';
import { hashPassword } from '../../../../lib/auth.js';

// GET: Get current settings
export async function onRequestGet(context) {
  const { env } = context;

  const loanConfig = await queryFirst(env.DB, 'SELECT * FROM loan_config WHERE id = 1');
  const adminConfig = await queryFirst(env.DB, 'SELECT id, theme FROM admin_config WHERE id = 1');
  const rateChanges = await query(env.DB, 'SELECT * FROM rate_changes ORDER BY effective_date DESC');
  const auditLog = await query(env.DB, 'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 50');

  return Response.json({
    loan: loanConfig,
    admin: adminConfig,
    rateChanges,
    auditLog
  });
}

// PUT: Update settings
export async function onRequestPut(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { original_amount, start_date, annual_rate, theme, new_password } = body;

    // Update loan config
    if (original_amount !== undefined || start_date !== undefined || annual_rate !== undefined) {
      const current = await queryFirst(env.DB, 'SELECT * FROM loan_config WHERE id = 1');

      if (annual_rate !== undefined && annual_rate !== current.annual_rate) {
        // Log rate change
        await execute(env.DB,
          'INSERT INTO rate_changes (effective_date, old_rate, new_rate) VALUES (?, ?, ?)',
          [new Date().toISOString().split('T')[0], current.annual_rate, annual_rate]
        );
      }

      await execute(env.DB,
        "UPDATE loan_config SET original_amount = ?, start_date = ?, annual_rate = ?, updated_at = datetime('now') WHERE id = 1",
        [
          original_amount !== undefined ? original_amount : current.original_amount,
          start_date !== undefined ? start_date : current.start_date,
          annual_rate !== undefined ? annual_rate : current.annual_rate
        ]
      );
    }

    // Update theme
    if (theme !== undefined) {
      await execute(env.DB, 'UPDATE admin_config SET theme = ? WHERE id = 1', [theme]);
    }

    // Update password
    if (new_password) {
      const hash = await hashPassword(new_password);
      await execute(env.DB, 'UPDATE admin_config SET password_hash = ? WHERE id = 1', [hash]);
    }

    // Audit log
    await execute(env.DB,
      'INSERT INTO audit_log (action, details) VALUES (?, ?)',
      ['settings_updated', JSON.stringify({ changes: Object.keys(body) })]
    );

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: 'Settings update failed: ' + err.message }, { status: 500 });
  }
}
