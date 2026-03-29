import { verifyPassword, createSession, setSessionCookie } from '../../../../lib/auth.js';
import { queryFirst } from '../../../../lib/db.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { password } = await request.json();

    if (!password) {
      return Response.json({ error: 'Password required' }, { status: 400 });
    }

    // Get admin config from D1
    const admin = await queryFirst(env.DB, 'SELECT password_hash FROM admin_config WHERE id = 1');

    if (!admin) {
      return Response.json({ error: 'Admin not configured' }, { status: 500 });
    }

    const valid = await verifyPassword(password, admin.password_hash);

    if (!valid) {
      return Response.json({ error: 'Invalid password' }, { status: 401 });
    }

    const session = await createSession(env);

    return new Response(JSON.stringify({ success: true }), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': setSessionCookie(session)
      }
    });
  } catch (err) {
    return Response.json({ error: 'Login failed' }, { status: 500 });
  }
}
