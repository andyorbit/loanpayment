import { query, queryFirst, execute } from '../../../../lib/db.js';
import { getAccessToken, fetchSheetRows, matchTransactions } from '../../../../lib/monzo.js';

// Column headers available for criteria matching
const AVAILABLE_FIELDS = ['Name', 'Description', 'Notes and #tags', 'Type', 'Category'];
const AVAILABLE_MATCH_TYPES = ['contains', 'exact', 'starts_with', 'ends_with'];

// GET: Get Monzo config, criteria groups, and recent transactions
export async function onRequestGet(context) {
  const { env } = context;

  try {
    const config = await queryFirst(env.DB, 'SELECT * FROM monzo_config WHERE id = 1');
    const criteriaRows = await query(env.DB, 'SELECT * FROM monzo_criteria ORDER BY group_name ASC, id ASC');
    const pendingPayments = await query(env.DB, "SELECT * FROM payments WHERE status = 'pending' ORDER BY payment_date DESC");

    // Group criteria by group_name
    const criteriaGroups = {};
    for (const row of criteriaRows) {
      if (!criteriaGroups[row.group_name]) criteriaGroups[row.group_name] = [];
      criteriaGroups[row.group_name].push(row);
    }

    let recentTransactions = [];
    let sheetHeaders = [];

    // If configured and we have the Google SA key, fetch recent sheet data
    if (config?.google_sheet_id && env.GOOGLE_SA_KEY) {
      try {
        const accessToken = await getAccessToken(env.GOOGLE_SA_KEY);
        const rows = await fetchSheetRows(accessToken, config.google_sheet_id, config.sheet_name || 'Personal Account Transactions');
        if (rows.length > 0) {
          sheetHeaders = rows[0];
          // Return last 20 data rows for display
          recentTransactions = rows.slice(-20).reverse();
        }
      } catch (err) {
        // Don't fail the whole request if sheet fetch fails
        recentTransactions = [];
      }
    }

    return Response.json({
      config: config || { google_sheet_id: null, sheet_name: 'Personal Account Transactions', last_sync_at: null, sync_interval_minutes: 30 },
      criteriaGroups,
      pendingPayments,
      recentTransactions,
      sheetHeaders,
      availableFields: AVAILABLE_FIELDS,
      availableMatchTypes: AVAILABLE_MATCH_TYPES
    });
  } catch (err) {
    return Response.json({ error: 'Failed to load Monzo config: ' + err.message }, { status: 500 });
  }
}

// PUT: Update Monzo config and criteria
export async function onRequestPut(context) {
  const { request, env } = context;

  try {
    const body = await request.json();

    // Handle config updates (sheet_id, sheet_name, sync_interval)
    if (body.google_sheet_id !== undefined || body.sheet_name !== undefined || body.sync_interval_minutes !== undefined) {
      const existing = await queryFirst(env.DB, 'SELECT * FROM monzo_config WHERE id = 1');
      if (existing) {
        await execute(env.DB,
          'UPDATE monzo_config SET google_sheet_id = ?, sheet_name = ?, sync_interval_minutes = ? WHERE id = 1',
          [
            body.google_sheet_id !== undefined ? body.google_sheet_id : existing.google_sheet_id,
            body.sheet_name !== undefined ? body.sheet_name : existing.sheet_name,
            body.sync_interval_minutes !== undefined ? body.sync_interval_minutes : existing.sync_interval_minutes
          ]
        );
      } else {
        await execute(env.DB,
          'INSERT INTO monzo_config (id, google_sheet_id, sheet_name, sync_interval_minutes) VALUES (1, ?, ?, ?)',
          [body.google_sheet_id, body.sheet_name || 'Personal Account Transactions', body.sync_interval_minutes || 30]
        );
      }
    }

    // Add a new criterion
    if (body.add_criterion) {
      const { group_name, field, match_type, match_value } = body.add_criterion;
      if (!group_name || !field || !match_type || !match_value) {
        return Response.json({ error: 'add_criterion requires group_name, field, match_type, match_value' }, { status: 400 });
      }
      if (!AVAILABLE_FIELDS.includes(field)) {
        return Response.json({ error: `Invalid field: ${field}. Must be one of: ${AVAILABLE_FIELDS.join(', ')}` }, { status: 400 });
      }
      if (!AVAILABLE_MATCH_TYPES.includes(match_type)) {
        return Response.json({ error: `Invalid match_type: ${match_type}. Must be one of: ${AVAILABLE_MATCH_TYPES.join(', ')}` }, { status: 400 });
      }
      await execute(env.DB,
        'INSERT INTO monzo_criteria (group_name, field, match_type, match_value) VALUES (?, ?, ?, ?)',
        [group_name, field, match_type, match_value]
      );
    }

    // Update an existing criterion
    if (body.update_criterion) {
      const { id, field, match_type, match_value, is_active } = body.update_criterion;
      if (!id) return Response.json({ error: 'update_criterion requires id' }, { status: 400 });

      const existing = await queryFirst(env.DB, 'SELECT * FROM monzo_criteria WHERE id = ?', [id]);
      if (!existing) return Response.json({ error: 'Criterion not found' }, { status: 404 });

      await execute(env.DB,
        'UPDATE monzo_criteria SET field = ?, match_type = ?, match_value = ?, is_active = ? WHERE id = ?',
        [
          field !== undefined ? field : existing.field,
          match_type !== undefined ? match_type : existing.match_type,
          match_value !== undefined ? match_value : existing.match_value,
          is_active !== undefined ? is_active : existing.is_active,
          id
        ]
      );
    }

    // Remove a criterion
    if (body.remove_criterion) {
      const { id } = body.remove_criterion;
      if (!id) return Response.json({ error: 'remove_criterion requires id' }, { status: 400 });
      await execute(env.DB, 'DELETE FROM monzo_criteria WHERE id = ?', [id]);
    }

    // Rename a group
    if (body.rename_group) {
      const { old_name, new_name } = body.rename_group;
      if (!old_name || !new_name) return Response.json({ error: 'rename_group requires old_name and new_name' }, { status: 400 });
      await execute(env.DB, 'UPDATE monzo_criteria SET group_name = ? WHERE group_name = ?', [new_name, old_name]);
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

    // Get pending payments and criteria
    const pendingPayments = await query(env.DB, "SELECT * FROM payments WHERE status = 'pending' ORDER BY payment_date ASC");
    const criteriaRows = await query(env.DB, 'SELECT * FROM monzo_criteria WHERE is_active = 1');

    if (pendingPayments.length === 0) {
      return Response.json({ message: 'No pending payments to match', matched: 0 });
    }

    if (criteriaRows.length === 0) {
      return Response.json({ error: 'No matching criteria configured. Add criteria groups first.' }, { status: 400 });
    }

    // Group criteria by group_name
    const criteriaGroups = {};
    for (const row of criteriaRows) {
      if (!criteriaGroups[row.group_name]) criteriaGroups[row.group_name] = [];
      criteriaGroups[row.group_name].push({ field: row.field, match_type: row.match_type, match_value: row.match_value });
    }

    // Fetch sheet
    const accessToken = await getAccessToken(env.GOOGLE_SA_KEY);
    const sheetName = config.sheet_name || 'Personal Account Transactions';
    const rows = await fetchSheetRows(accessToken, config.google_sheet_id, sheetName);

    if (rows.length === 0) {
      return Response.json({ error: 'Sheet returned no data' }, { status: 400 });
    }

    const headers = rows[0];

    // Match
    const matches = await matchTransactions(rows, headers, pendingPayments, criteriaGroups);

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
