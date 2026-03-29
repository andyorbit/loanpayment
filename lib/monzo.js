/**
 * Google Sheets API client for Cloudflare Workers
 * Uses Service Account JWT auth via Web Crypto API
 */

// Create a JWT and exchange it for an access token
export async function getAccessToken(serviceAccountKey) {
  const key = typeof serviceAccountKey === 'string' ? JSON.parse(serviceAccountKey) : serviceAccountKey;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  // Base64url encode
  const b64url = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const headerB64 = b64url(header);
  const payloadB64 = b64url(payload);
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import the private key for RS256 signing
  const pemContents = key.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\n/g, '');

  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Sign
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, encoder.encode(unsignedToken));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const jwt = `${unsignedToken}.${sigB64}`;

  // Exchange JWT for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error('Failed to get access token: ' + JSON.stringify(tokenData));
  }

  return tokenData.access_token;
}

// Fetch rows from a Google Sheet
export async function fetchSheetRows(accessToken, sheetId, sheetName = 'Personal Account Transactions', range = 'A:Z') {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}!${range}`;

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.values || [];
}

/**
 * Match sheet transactions to pending payments.
 *
 * @param {string[][]} sheetRows - All rows including header
 * @param {Object[]} pendingPayments - [{id, amount, payment_date}]
 * @param {string[]} namePatterns - ["LIM", "MUM"]
 * @param {string[]} alreadyMatchedTxIds - Transaction IDs already used
 * @returns {Object[]} matches
 */
export function matchTransactions(sheetRows, pendingPayments, namePatterns, alreadyMatchedTxIds = []) {
  if (sheetRows.length < 2 || namePatterns.length === 0) return [];

  const headers = sheetRows[0];
  const txIdIdx = headers.indexOf('Transaction ID');
  const dateIdx = headers.indexOf('Date');
  const typeIdx = headers.indexOf('Type');
  const nameIdx = headers.indexOf('Name');
  const amtIdx = headers.indexOf('Amount');

  const matches = [];
  const usedTxIds = new Set(alreadyMatchedTxIds);
  const usedPaymentIds = new Set();

  // Pre-filter sheet to only incoming faster payments not already matched
  const candidates = [];
  for (let i = 1; i < sheetRows.length; i++) {
    const row = sheetRows[i];
    const txId = row[txIdIdx] || '';
    const type = (row[typeIdx] || '').toLowerCase();
    const amount = parseFloat(String(row[amtIdx] || '0').replace(/[£,\s]/g, ''));
    const name = (row[nameIdx] || '').toUpperCase();
    const dateStr = row[dateIdx] || ''; // DD/MM/YYYY

    // Only incoming faster payments not already matched
    if (amount <= 0) continue;
    if (!type.includes('faster payment')) continue;
    if (usedTxIds.has(txId)) continue;

    // Check if name matches any pattern
    const nameMatch = namePatterns.some(p => name.includes(p.toUpperCase()));
    if (!nameMatch) continue;

    // Parse date DD/MM/YYYY -> Date object
    const dateParts = dateStr.split('/');
    if (dateParts.length !== 3) continue;
    const sheetDate = new Date(
      parseInt(dateParts[2]), parseInt(dateParts[1]) - 1, parseInt(dateParts[0])
    );

    candidates.push({ rowIndex: i + 1, txId, amount, name: row[nameIdx], sheetDate, dateStr, row });
  }

  // For each pending payment, find best matching candidate
  // Sort payments by date for consistent matching
  const sortedPayments = [...pendingPayments].sort((a, b) => a.payment_date.localeCompare(b.payment_date));

  for (const payment of sortedPayments) {
    if (usedPaymentIds.has(payment.id)) continue;

    const paymentDate = new Date(payment.payment_date);

    let bestMatch = null;
    let bestDateDiff = Infinity;

    for (const candidate of candidates) {
      if (usedTxIds.has(candidate.txId)) continue;

      // Amount must match within £0.02
      if (Math.abs(candidate.amount - payment.amount) > 0.02) continue;

      // Date must be within ±2 days
      const daysDiff = Math.abs((candidate.sheetDate - paymentDate) / (1000 * 60 * 60 * 24));
      if (daysDiff > 2) continue;

      // Pick closest date match
      if (daysDiff < bestDateDiff) {
        bestDateDiff = daysDiff;
        bestMatch = candidate;
      }
    }

    if (bestMatch) {
      usedTxIds.add(bestMatch.txId);
      usedPaymentIds.add(payment.id);
      matches.push({
        paymentId: payment.id,
        paymentAmount: payment.amount,
        paymentDate: payment.payment_date,
        matchedTxId: bestMatch.txId,
        matchedRow: bestMatch.rowIndex,
        matchedName: bestMatch.name,
        matchedAmount: bestMatch.amount,
        matchedDate: bestMatch.dateStr,
        dateDiffDays: Math.round(bestDateDiff)
      });
    }
  }

  return matches;
}
