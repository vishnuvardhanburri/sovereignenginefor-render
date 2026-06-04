import { NextResponse, type NextRequest } from 'next/server'

// Next.js 16 deprecates the `middleware.ts` convention in favor of `proxy.ts`.
// This file keeps the same behavior: protect dashboard routes via cookie presence.

const PUBLIC_PATHS = new Set([
  '/login',
  '/book',
  '/api/auth/login',
  '/api/auth/me',
  '/api/auth/logout',
  '/api/qualification',
  '/api/webhooks/resend',
])
const SESSION_COOKIE = 'xo_session'

export function proxy(request: NextRequest) {
  // HTTPS enforcement:
  // - Safe by default for real domains behind a reverse proxy.
  // - Explicitly disabled when APP_PROTOCOL=http or APP_BASE_URL starts with http://
  //   (common for early EC2 deployments where TLS termination isn't configured yet).
  if (process.env.NODE_ENV === 'production') {
    const appProtocol = (process.env.APP_PROTOCOL || '').trim().toLowerCase()
    const baseUrl = (process.env.APP_BASE_URL || '').trim().toLowerCase()
    const forceHttps = appProtocol !== 'http' && !baseUrl.startsWith('http://')
    const xfProto = request.headers.get('x-forwarded-proto')
    if (forceHttps && xfProto && xfProto.toLowerCase() === 'http') {
      const url = request.nextUrl.clone()
      url.protocol = 'https:'
      return NextResponse.redirect(url, 308)
    }
  }

  const { pathname } = request.nextUrl
  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next()
  }

  if (pathname.startsWith('/_next') || pathname.startsWith('/public')) {
    return NextResponse.next()
  }

  // Protect dashboard pages (and keep APIs open for workers/integrations).
  const protect =
    pathname === '/' ||
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/campaigns') ||
    pathname.startsWith('/contacts') ||
    pathname.startsWith('/linkedin') ||
    pathname.startsWith('/domains') ||
    pathname.startsWith('/reputation') ||
    pathname.startsWith('/sequences') ||
    pathname.startsWith('/inbox') ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/next-level') ||
    pathname.startsWith('/ai-assistant')

  if (!protect) {
    return NextResponse.next()
  }

  // Proxy runs on the Edge runtime; only check cookie presence here.
  // Token verification is handled by API routes / server code.
  const token = request.cookies.get(SESSION_COOKIE)?.value ?? ''
  if (!token) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
