import { query, queryFirst, execute } from '../../../../lib/db.js';
import { getAccessToken, fetchSheetRows, matchTransactions } from '../../../../lib/monzo.js';

// GET: Get Monzo config, name patterns, and pending payments count
export async function onRequestGet(context) {
  const { env } = context;

  try {
    const config = await queryFirst(env.DB, 'SELECT * FROM monzo_config WHERE id = 1');
    const names = await query(env.DB, 'SELECT * FROM monzo_names ORDER BY id ASC');
    const pendingPayments = await query(env.DB, "SELECT * FROM payments WHERE status = 'pending' ORDER BY payment_date DESC");

    return Response.json({
      config: config || { google_sheet_id: null, sheet_name: 'Personal Account Transactions', last_sync_at: null, sync_interval_minutes: 30 },
      names,
      pendingCount: pendingPayments.length,
    });
  } catch (err) {
    return Response.json({ error: 'Failed to load Monzo config: ' + err.message }, { status: 500 });
  }
}

// PUT: Update Monzo config and name patterns
export async function onRequestPut(context) {
  const { request, env } = context;

  try {
    const body = await request.json();

    // Handle config updates (sheet_id, sheet_name)
    if (body.google_sheet_id !== undefined || body.sheet_name !== undefined) {
      const existing = await queryFirst(env.DB, 'SELECT * FROM monzo_config WHERE id = 1');
      if (existing) {
        await execute(env.DB,
          'UPDATE monzo_config SET google_sheet_id = ?, sheet_name = ? WHERE id = 1',
          [
            body.google_sheet_id !== undefined ? body.google_sheet_id : existing.google_sheet_id,
            body.sheet_name !== undefined ? body.sheet_name : existing.sheet_name,
          ]
        );
      } else {
        await execute(env.DB,
          'INSERT INTO monzo_config (id, google_sheet_id, sheet_name) VALUES (1, ?, ?)',
          [body.google_sheet_id, body.sheet_name || 'Personal Account Transactions']
        );
      }
    }

    // Add a new name pattern
    if (body.add_name) {
      const { label, name_pattern } = body.add_name;
      if (!label || !name_pattern) {
        return Response.json({ error: 'add_name requires label and name_pattern' }, { status: 400 });
      }
      await execute(env.DB,
        'INSERT INTO monzo_names (label, name_pattern) VALUES (?, ?)',
        [label, name_pattern]
      );
    }

    // Remove a name pattern
    if (body.remove_name) {
      const { id } = body.remove_name;
      if (!id) return Response.json({ error: 'remove_name requires id' }, { status: 400 });
      await execute(env.DB, 'DELETE FROM monzo_names WHERE id = ?', [id]);
    }

    // Update a name pattern
    if (body.update_name) {
      const { id, label, name_pattern, is_active } = body.update_name;
      if (!id) return Response.json({ error: 'update_name requires id' }, { status: 400 });

      const existing = await queryFirst(env.DB, 'SELECT * FROM monzo_names WHERE id = ?', [id]);
      if (!existing) return Response.json({ error: 'Name not found' }, { status: 404 });

      await execute(env.DB,
        'UPDATE monzo_names SET label = ?, name_pattern = ?, is_active = ? WHERE id = ?',
        [
          label !== undefined ? label : existing.label,
          name_pattern !== undefined ? name_pattern : existing.name_pattern,
          is_active !== undefined ? is_active : existing.is_active,
          id
        ]
      );
    }

    await execute(env.DB, 'INSERT INTO audit_log (action, details) VALUES (?, ?)',
      ['monzo_config_updated', JSON.stringify(body)]);

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: 'Config update failed: ' + err.message }, { status: 500 });
  }
}

// POST: Trigger manual sync
export async function onRequestPost(context) {
  const { env } = context;

  try {
    const config = await queryFirst(env.DB, 'SELECT * FROM monzo_config WHERE id = 1');
    if (!config?.google_sheet_id) {
      return Response.json({ error: 'Monzo not configured. Set a Google Sheet ID first.' }, { status: 400 });
    }

    if (!env.GOOGLE_SA_KEY) {
      return Response.json({ error: 'Google Service Account key not configured' }, { status: 500 });
    }

    // Get pending payments and active name patterns
    const pendingPayments = await query(env.DB, "SELECT * FROM payments WHERE status = 'pending' ORDER BY payment_date ASC");
    const nameRows = await query(env.DB, 'SELECT * FROM monzo_names WHERE is_active = 1');

    if (pendingPayments.length === 0) {
      return Response.json({ message: 'No pending payments to match', matched: 0 });
    }

    if (nameRows.length === 0) {
      return Response.json({ error: 'No name patterns configured. Add names to watch for first.' }, { status: 400 });
    }

    const namePatterns = nameRows.map(r => r.name_pattern);

    // Get already-matched Transaction IDs
    const matchedRows = await query(env.DB, 'SELECT monzo_match_ref FROM payments WHERE monzo_match_ref IS NOT NULL');
    const alreadyMatchedTxIds = matchedRows.map(r => r.monzo_match_ref);

    // Fetch sheet
    const accessToken = await getAccessToken(env.GOOGLE_SA_KEY);
    const sheetName = config.sheet_name || 'Personal Account Transactions';
    const rows = await fetchSheetRows(accessToken, config.google_sheet_id, sheetName);

    if (rows.length === 0) {
      return Response.json({ error: 'Sheet returned no data' }, { status: 400 });
    }

    // Match
    const matches = matchTransactions(rows, pendingPayments, namePatterns, alreadyMatchedTxIds);

    // Auto-validate matched payments
    for (const match of matches) {
      await execute(env.DB,
        "UPDATE payments SET status = 'validated', validated_at = datetime('now'), validation_source = 'monzo', monzo_match_ref = ? WHERE id = ?",
        [match.matchedTxId, match.paymentId]
      );

      await execute(env.DB,
        'INSERT INTO audit_log (action, details) VALUES (?, ?)',
        ['monzo_auto_validated', JSON.stringify(match)]
      );
    }

    // Update last sync time
    await execute(env.DB, "UPDATE monzo_config SET last_sync_at = datetime('now') WHERE id = 1");

    return Response.json({
      message: `Synced: ${matches.length} of ${pendingPayments.length} pending payments matched`,
      matched: matches.length,
      total: pendingPayments.length,
      matches
    });
  } catch (err) {
    return Response.json({ error: 'Sync failed: ' + err.message }, { status: 500 });
  }
}
