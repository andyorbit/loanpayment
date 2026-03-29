import { query, queryFirst, execute } from '../../../../lib/db.js';
import { getAccessToken, fetchSheetRows, matchTransactions } from '../../../../lib/monzo.js';

// GET: Get Monzo config, senders, and recent transactions
export async function onRequestGet(context) {
  const { env } = context;

  try {
    const config = await queryFirst(env.DB, 'SELECT * FROM monzo_config WHERE id = 1');
    const senders = await query(env.DB, 'SELECT * FROM monzo_senders ORDER BY id ASC');
    const pendingPayments = await query(env.DB, "SELECT * FROM payments WHERE status = 'pending' ORDER BY payment_date DESC");

    let recentTransactions = [];

    // If configured and we have the Google SA key, fetch recent sheet data
    if (config?.google_sheet_id && env.GOOGLE_SA_KEY) {
      try {
        const accessToken = await getAccessToken(env.GOOGLE_SA_KEY);
        const rows = await fetchSheetRows(accessToken, config.google_sheet_id, config.sheet_name || 'Sheet1');
        // Return last 20 rows for display
        recentTransactions = rows.slice(-20).reverse();
      } catch (err) {
        // Don't fail the whole request if sheet fetch fails
        recentTransactions = [];
      }
    }

    return Response.json({
      config: config || { google_sheet_id: null, sheet_name: 'Sheet1', last_sync_at: null, sync_interval_minutes: 30 },
      senders,
      pendingPayments,
      recentTransactions
    });
  } catch (err) {
    return Response.json({ error: 'Failed to load Monzo config: ' + err.message }, { status: 500 });
  }
}

// PUT: Update Monzo config
export async function onRequestPut(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { google_sheet_id, sheet_name, sync_interval_minutes } = body;

    // Upsert monzo_config
    const existing = await queryFirst(env.DB, 'SELECT * FROM monzo_config WHERE id = 1');
    if (existing) {
      await execute(env.DB,
        'UPDATE monzo_config SET google_sheet_id = ?, sheet_name = ?, sync_interval_minutes = ? WHERE id = 1',
        [google_sheet_id || existing.google_sheet_id, sheet_name || existing.sheet_name, sync_interval_minutes || existing.sync_interval_minutes]
      );
    } else {
      await execute(env.DB,
        'INSERT INTO monzo_config (id, google_sheet_id, sheet_name, sync_interval_minutes) VALUES (1, ?, ?, ?)',
        [google_sheet_id, sheet_name || 'Sheet1', sync_interval_minutes || 30]
      );
    }

    // Handle sender patterns
    if (body.add_sender) {
      await execute(env.DB, 'INSERT INTO monzo_senders (name_pattern, description) VALUES (?, ?)',
        [body.add_sender.pattern, body.add_sender.description || null]);
    }
    if (body.remove_sender_id) {
      await execute(env.DB, 'DELETE FROM monzo_senders WHERE id = ?', [body.remove_sender_id]);
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

    // Get pending payments and sender patterns
    const pendingPayments = await query(env.DB, "SELECT * FROM payments WHERE status = 'pending' ORDER BY payment_date ASC");
    const senders = await query(env.DB, 'SELECT name_pattern FROM monzo_senders');
    const senderPatterns = senders.map(s => s.name_pattern);

    if (pendingPayments.length === 0) {
      return Response.json({ message: 'No pending payments to match', matched: 0 });
    }

    if (senderPatterns.length === 0) {
      return Response.json({ error: 'No sender patterns configured. Add trusted senders first.' }, { status: 400 });
    }

    // Fetch sheet
    const accessToken = await getAccessToken(env.GOOGLE_SA_KEY);
    const rows = await fetchSheetRows(accessToken, config.google_sheet_id, config.sheet_name || 'Sheet1');

    // Match
    const matches = await matchTransactions(rows, pendingPayments, senderPatterns);

    // Auto-validate matched payments
    for (const match of matches) {
      await execute(env.DB,
        "UPDATE payments SET status = 'validated', validated_at = datetime('now'), validation_source = 'monzo', monzo_match_ref = ? WHERE id = ?",
        [`Row ${match.matchedRow}`, match.paymentId]
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
