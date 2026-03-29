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
export async function fetchSheetRows(accessToken, sheetId, sheetName = 'Sheet1', range = 'A:Z') {
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

// Match sheet transactions against pending payments
export async function matchTransactions(sheetRows, pendingPayments, senderPatterns) {
  const matches = [];

  // Skip header row
  const dataRows = sheetRows.slice(1);

  for (const payment of pendingPayments) {
    for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
      const row = dataRows[rowIdx];
      // Try to find amount and sender in the row
      // Monzo sheets typically have: Date, Time, Type, Name, Emoji, Category, Amount, Currency, ...
      // But column order may vary. We search all cells.

      const rowText = row.join(' ').toUpperCase();
      const rowAmounts = row
        .map(cell => parseFloat(String(cell).replace(/[£,$,\s]/g, '')))
        .filter(n => !isNaN(n) && n > 0);

      // Check if any sender pattern matches
      const senderMatch = senderPatterns.some(pattern =>
        rowText.includes(pattern.toUpperCase())
      );

      // Check if amount matches (within 0.02 tolerance)
      const amountMatch = rowAmounts.some(amt =>
        Math.abs(amt - payment.amount) < 0.02
      );

      if (senderMatch && amountMatch) {
        matches.push({
          paymentId: payment.id,
          paymentAmount: payment.amount,
          paymentDate: payment.payment_date,
          matchedRow: rowIdx + 2, // +2 for 1-indexed + header
          matchedData: row,
          confidence: 'high'
        });
        break; // One match per payment
      }
    }
  }

  return matches;
}
