// Password hashing using Web Crypto API (Workers-compatible)
// We use PBKDF2 since bcrypt isn't available in Workers runtime

export async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return `${saltB64}:${hashB64}`;
}

export async function verifyPassword(password, stored) {
  const [saltB64, expectedHashB64] = stored.split(':');
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return hashB64 === expectedHashB64;
}

export async function createSession(env) {
  // Create a random session token
  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min

  // Sign with HMAC using SESSION_SECRET
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(env.SESSION_SECRET || 'default-secret'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(token + expires));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

  return { token, expires, signature: sigB64 };
}

export async function verifySession(cookieValue, env) {
  try {
    const { token, expires, signature } = JSON.parse(atob(cookieValue));

    // Check expiry
    if (new Date(expires) < new Date()) return false;

    // Verify HMAC
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(env.SESSION_SECRET || 'default-secret'),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    return await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(token + expires));
  } catch {
    return false;
  }
}

export function setSessionCookie(session) {
  const value = btoa(JSON.stringify(session));
  return `session=${value}; Path=/payment/; HttpOnly; Secure; SameSite=Strict; Max-Age=1800`;
}

export function clearSessionCookie() {
  return `session=; Path=/payment/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function getSessionCookie(request) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/session=([^;]+)/);
  return match ? match[1] : null;
}
