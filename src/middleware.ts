import { defineMiddleware } from 'astro:middleware';
import { getSessionUser, SESSION_COOKIE } from './lib/auth';

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Only protect /documents routes
  if (!pathname.startsWith('/documents')) {
    return next();
  }

  // Allow the login page and login POST through
  if (pathname === '/documents' || pathname === '/documents/') {
    return next();
  }

  // Also allow the login API
  if (pathname === '/documents/api/login') {
    return next();
  }

  // Check session cookie
  const token = context.cookies.get(SESSION_COOKIE)?.value;
  const user = await getSessionUser(token);

  if (!user) {
    // Redirect to login with return URL
    const returnUrl = encodeURIComponent(pathname);
    return context.redirect(`/documents?return=${returnUrl}`);
  }

  // Attach user to locals for use in pages
  context.locals.user = user;

  return next();
});
