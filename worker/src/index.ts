const upstreamBase = 'https://api.powertochoose.org'
const teslaAuthBase = 'https://auth.tesla.com/oauth2/v3'
const teslaTokenUrl = 'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token'
const teslaFleetBase = 'https://fleet-api.prd.na.vn.cloud.tesla.com'

type Env = {
  TESLA_CLIENT_ID?: string
  TESLA_CLIENT_SECRET?: string
  TESLA_REDIRECT_URI?: string
  TESLA_COOKIE_SECRET?: string
  TESLA_APP_RETURN_URL?: string
  ALLOWED_ORIGIN?: string
}

type TeslaSession = {
  access_token: string
  refresh_token?: string
  expires_at: number
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

function corsHeadersFor(request: Request, env?: Env, credentials = false): Record<string, string> {
  const origin = request.headers.get('Origin')
  const allowedOrigin = env?.ALLOWED_ORIGIN ?? env?.TESLA_APP_RETURN_URL
  if (!credentials || !origin || !allowedOrigin || origin !== new URL(allowedOrigin).origin) {
    return corsHeaders
  }

  return {
    ...corsHeaders,
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
  }
}

function jsonResponse(
  request: Request,
  payload: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
  env?: Env,
  credentials = false,
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeadersFor(request, env, credentials),
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  })
}

function proxiedResponse(
  request: Request,
  body: BodyInit | null,
  status: number,
  contentType: string,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(body, {
    status,
    headers: {
      ...corsHeadersFor(request),
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': contentType,
      ...extraHeaders,
    },
  })
}

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  return (
    lower === 'localhost' ||
    lower.endsWith('.local') ||
    /^127\./.test(lower) ||
    /^10\./.test(lower) ||
    /^192\.168\./.test(lower) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(lower)
  )
}

function getCookie(request: Request, name: string): string | undefined {
  const cookies = request.headers.get('Cookie') ?? ''
  return cookies
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = `${value.replace(/-/g, '+').replace(/_/g, '/')}${'==='.slice((value.length + 3) % 4)}`
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function cookieKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encryptSession(session: TeslaSession, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await cookieKey(secret),
    new TextEncoder().encode(JSON.stringify(session)),
  )
  const combined = new Uint8Array(iv.length + encrypted.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(encrypted), iv.length)
  return base64UrlEncode(combined)
}

async function decryptSession(value: string, secret: string): Promise<TeslaSession | undefined> {
  try {
    const combined = base64UrlDecode(value)
    const iv = combined.slice(0, 12)
    const encrypted = combined.slice(12)
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await cookieKey(secret), encrypted)
    return JSON.parse(new TextDecoder().decode(decrypted)) as TeslaSession
  } catch {
    return undefined
  }
}

function requiredTeslaConfig(env: Env): string[] {
  return ['TESLA_CLIENT_ID', 'TESLA_CLIENT_SECRET', 'TESLA_REDIRECT_URI', 'TESLA_COOKIE_SECRET'].filter(
    (key) => !env[key as keyof Env],
  )
}

function redirectResponse(url: string, headers: Record<string, string> = {}) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      ...headers,
    },
  })
}

function sessionCookie(value: string): string {
  return `tesla_session=${value}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=7776000`
}

function expiredCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`
}

async function exchangeTeslaCode(code: string, env: Env): Promise<TeslaSession> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: env.TESLA_CLIENT_ID ?? '',
    client_secret: env.TESLA_CLIENT_SECRET ?? '',
    code,
    audience: teslaFleetBase,
    redirect_uri: env.TESLA_REDIRECT_URI ?? '',
  })
  const response = await fetch(teslaTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const payload = (await response.json()) as Record<string, unknown>
  if (!response.ok || typeof payload.access_token !== 'string') {
    throw new Error(typeof payload.error_description === 'string' ? payload.error_description : 'Tesla token exchange failed.')
  }
  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600
  return {
    access_token: payload.access_token,
    refresh_token: typeof payload.refresh_token === 'string' ? payload.refresh_token : undefined,
    expires_at: Date.now() + expiresIn * 1000,
  }
}

async function refreshTeslaSession(session: TeslaSession, env: Env): Promise<TeslaSession> {
  if (session.expires_at > Date.now() + 120_000) return session
  if (!session.refresh_token) return session

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: env.TESLA_CLIENT_ID ?? '',
    client_secret: env.TESLA_CLIENT_SECRET ?? '',
    refresh_token: session.refresh_token,
  })
  const response = await fetch(teslaTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const payload = (await response.json()) as Record<string, unknown>
  if (!response.ok || typeof payload.access_token !== 'string') {
    throw new Error('Tesla refresh token exchange failed.')
  }
  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600
  return {
    access_token: payload.access_token,
    refresh_token: typeof payload.refresh_token === 'string' ? payload.refresh_token : session.refresh_token,
    expires_at: Date.now() + expiresIn * 1000,
  }
}

async function readTeslaSession(request: Request, env: Env): Promise<{ session?: TeslaSession; setCookie?: string }> {
  const encrypted = getCookie(request, 'tesla_session')
  if (!encrypted || !env.TESLA_COOKIE_SECRET) return {}
  const session = await decryptSession(encrypted, env.TESLA_COOKIE_SECRET)
  if (!session) return {}
  const refreshed = await refreshTeslaSession(session, env)
  if (refreshed !== session) {
    return {
      session: refreshed,
      setCookie: sessionCookie(await encryptSession(refreshed, env.TESLA_COOKIE_SECRET)),
    }
  }
  return { session }
}

async function teslaFetch(path: string, session: TeslaSession): Promise<Response> {
  return fetch(`${teslaFleetBase}${path}`, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      Accept: 'application/json',
    },
  })
}

async function firstEnergySiteId(session: TeslaSession): Promise<number | string | undefined> {
  const response = await teslaFetch('/api/1/products', session)
  const payload = (await response.json()) as Record<string, unknown>
  const products = Array.isArray(payload.response) ? payload.response : []
  const product = products.find((item) => item && typeof item === 'object' && 'energy_site_id' in item) as
    | Record<string, unknown>
    | undefined
  const id = product?.energy_site_id
  return typeof id === 'number' || typeof id === 'string' ? id : undefined
}

async function handleTesla(request: Request, env: Env, url: URL): Promise<Response> {
  const missing = requiredTeslaConfig(env)
  if (url.pathname === '/tesla/status' && missing.length) {
    return jsonResponse(
      request,
      { success: true, configured: false, connected: false, missing },
      200,
      {},
      env,
      true,
    )
  }
  if (missing.length) {
    return jsonResponse(request, { success: false, message: `Tesla API is not configured. Missing: ${missing.join(', ')}` }, 501, {}, env, true)
  }

  if (url.pathname === '/tesla/oauth/start') {
    const state = crypto.randomUUID()
    const returnUrl = url.searchParams.get('return_url') ?? env.TESLA_APP_RETURN_URL ?? '/'
    const authUrl = new URL(`${teslaAuthBase}/authorize`)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('client_id', env.TESLA_CLIENT_ID ?? '')
    authUrl.searchParams.set('redirect_uri', env.TESLA_REDIRECT_URI ?? '')
    authUrl.searchParams.set('scope', 'openid offline_access user_data energy_device_data vehicle_device_data vehicle_charging_cmds')
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('prompt_missing_scopes', 'true')
    return redirectResponse(authUrl.toString(), {
      'Set-Cookie': `tesla_oauth_state=${state}|${encodeURIComponent(returnUrl)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=600`,
    })
  }

  if (url.pathname === '/tesla/oauth/callback') {
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const stateCookie = getCookie(request, 'tesla_oauth_state')
    const separatorIndex = stateCookie?.indexOf('|') ?? -1
    const expectedState = separatorIndex >= 0 ? stateCookie?.slice(0, separatorIndex) : undefined
    const encodedReturnUrl = separatorIndex >= 0 ? stateCookie?.slice(separatorIndex + 1) : undefined
    const returnUrl = encodedReturnUrl ? decodeURIComponent(encodedReturnUrl) : env.TESLA_APP_RETURN_URL ?? '/'
    if (!code || !state || state !== expectedState) {
      return redirectResponse(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}tesla=error`, {
        'Set-Cookie': expiredCookie('tesla_oauth_state'),
      })
    }

    try {
      const session = await exchangeTeslaCode(code, env)
      const encrypted = await encryptSession(session, env.TESLA_COOKIE_SECRET ?? '')
      return redirectResponse(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}tesla=connected`, {
        'Set-Cookie': sessionCookie(encrypted),
      })
    } catch {
      return redirectResponse(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}tesla=error`, {
        'Set-Cookie': expiredCookie('tesla_oauth_state'),
      })
    }
  }

  if (url.pathname === '/tesla/logout') {
    return jsonResponse(request, { success: true }, 200, { 'Set-Cookie': expiredCookie('tesla_session') }, env, true)
  }

  if (url.pathname === '/tesla/status') {
    const { session, setCookie } = await readTeslaSession(request, env)
    return jsonResponse(
      request,
      { success: true, configured: true, connected: Boolean(session) },
      200,
      setCookie ? { 'Set-Cookie': setCookie } : {},
      env,
      true,
    )
  }

  const { session, setCookie } = await readTeslaSession(request, env)
  if (!session) {
    return jsonResponse(request, { success: false, message: 'Connect a Tesla account first.' }, 401, {}, env, true)
  }
  const headers = setCookie ? { 'Set-Cookie': setCookie } : {}

  if (url.pathname === '/tesla/products') {
    const response = await teslaFetch('/api/1/products', session)
    return jsonResponse(request, await response.json(), response.status, headers, env, true)
  }

  if (url.pathname === '/tesla/wall-connector-charge-history') {
    const energySiteId = url.searchParams.get('energy_site_id') ?? (await firstEnergySiteId(session))
    if (!energySiteId) {
      return jsonResponse(request, { success: false, message: 'No Tesla energy site with a Wall Connector was found.' }, 404, headers, env, true)
    }
    const startDate = url.searchParams.get('start_date')
    const endDate = url.searchParams.get('end_date')
    const timeZone = url.searchParams.get('time_zone') ?? 'America/Chicago'
    if (!startDate || !endDate) {
      return jsonResponse(request, { success: false, message: 'start_date and end_date are required.' }, 400, headers, env, true)
    }
    const path = `/api/1/energy_sites/${energySiteId}/telemetry_history?kind=charge&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}&time_zone=${encodeURIComponent(timeZone)}`
    const response = await teslaFetch(path, session)
    return jsonResponse(request, await response.json(), response.status, headers, env, true)
  }

  if (url.pathname === '/tesla/vehicle-data') {
    const vin = url.searchParams.get('vin')
    if (!vin) {
      return jsonResponse(request, { success: false, message: 'vin is required.' }, 400, headers, env, true)
    }
    const response = await teslaFetch(`/api/1/vehicles/${encodeURIComponent(vin)}/vehicle_data`, session)
    return jsonResponse(request, await response.json(), response.status, headers, env, true)
  }

  return jsonResponse(request, { success: false, message: 'Tesla endpoint not found.' }, 404, headers, env, true)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeadersFor(request, env, true) })
    }

    if (request.method !== 'GET' && request.method !== 'POST') {
      return jsonResponse(request, { success: false, message: 'Method not allowed' }, 405)
    }

    const url = new URL(request.url)
    if (url.pathname.startsWith('/tesla/')) {
      return handleTesla(request, env, url)
    }

    if (request.method !== 'GET') {
      return jsonResponse(request, { success: false, message: 'Method not allowed' }, 405)
    }

    if (url.pathname === '/efl') {
      const target = url.searchParams.get('url') ?? ''
      let targetUrl: URL
      try {
        targetUrl = new URL(target)
      } catch {
        return jsonResponse(request, { success: false, message: 'A valid EFL URL is required.' }, 400)
      }

      if (!['http:', 'https:'].includes(targetUrl.protocol) || isPrivateHostname(targetUrl.hostname)) {
        return jsonResponse(request, { success: false, message: 'Unsupported EFL URL.' }, 400)
      }

      const cache = caches.default
      const cacheKey = new Request(targetUrl.toString(), { method: 'GET' })
      const cached = await cache.match(cacheKey)
      if (cached) {
        return new Response(cached.body, {
          status: cached.status,
          headers: {
            ...corsHeaders,
            'Cache-Control': 'public, max-age=3600',
            'Content-Type': cached.headers.get('Content-Type') ?? 'application/octet-stream',
            'X-Cache': 'HIT',
          },
        })
      }

      const upstreamResponse = await fetch(targetUrl.toString(), {
        headers: {
          Accept: 'application/pdf,text/html,application/xhtml+xml,text/plain,*/*',
          'User-Agent': 'texas-electric-plan-finder/0.1',
        },
      })
      const contentType = upstreamResponse.headers.get('Content-Type') ?? 'application/octet-stream'
      const body = await upstreamResponse.arrayBuffer()
      const response = proxiedResponse(request, body, upstreamResponse.status, contentType, { 'X-Cache': 'MISS' })

      if (upstreamResponse.ok) {
        await cache.put(cacheKey, response.clone())
      }

      return response
    }

    const zipCode = url.searchParams.get('zip_code') ?? url.searchParams.get('zip') ?? ''
    if (!/^\d{5}$/.test(zipCode)) {
      return jsonResponse(request, { success: false, message: 'A 5-digit ZIP code is required.' }, 400)
    }

    if (url.pathname !== '/api/PowerToChoose/plans' && url.pathname !== '/plans') {
      return jsonResponse(request, { success: false, message: 'Not found' }, 404)
    }

    const upstreamUrl = `${upstreamBase}/api/PowerToChoose/plans?zip_code=${zipCode}`
    const cache = caches.default
    const cacheKey = new Request(upstreamUrl, { method: 'GET' })
    const cached = await cache.match(cacheKey)
    if (cached) {
      return new Response(cached.body, {
        status: cached.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
          'X-Cache': 'HIT',
        },
      })
    }

    const upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'texas-electric-plan-finder/0.1',
      },
    })
    const body = await upstreamResponse.text()
    const response = new Response(body, {
      status: upstreamResponse.status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        'X-Cache': 'MISS',
      },
    })

    if (upstreamResponse.ok) {
      await cache.put(cacheKey, response.clone())
    }

    return response
  },
}
