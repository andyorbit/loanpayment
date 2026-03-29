import { verifySession, getSessionCookie } from '../../../lib/auth.js';

const PUBLIC_PATHS = [
  '/payment/api/dashboard',
  '/payment/api/payments',
  '/payment/api/calculator',
  '/payment/api/export',
  '/payment/api/admin/login'
];

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Allow public GET routes
  const isPublicGet = PUBLIC_PATHS.some(p => path.startsWith(p)) && request.method === 'GET';

  // Allow POST to payments (parents adding payments) and admin login
  const isPaymentPost = path === '/payment/api/payments' && request.method === 'POST';
  const isLoginPost = path === '/payment/api/admin/login' && request.method === 'POST';

  if (isPublicGet || isPaymentPost || isLoginPost) {
    return next();
  }

  // All other routes (PUT, DELETE, admin/*) require auth
  if (path.includes('/admin/') || request.method === 'PUT' || request.method === 'DELETE') {
    const cookie = getSessionCookie(request);
    if (!cookie) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const valid = await verifySession(cookie, env);
    if (!valid) {
      return Response.json({ error: 'Session expired' }, { status: 401 });
    }
  }

  return next();
}
