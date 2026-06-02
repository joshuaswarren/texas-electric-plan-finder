const upstreamBase = 'https://api.powertochoose.org'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

function jsonResponse(payload: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  })
}

function proxiedResponse(
  body: BodyInit | null,
  status: number,
  contentType: string,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders,
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

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    if (request.method !== 'GET') {
      return jsonResponse({ success: false, message: 'Method not allowed' }, 405)
    }

    const url = new URL(request.url)
    if (url.pathname === '/efl') {
      const target = url.searchParams.get('url') ?? ''
      let targetUrl: URL
      try {
        targetUrl = new URL(target)
      } catch {
        return jsonResponse({ success: false, message: 'A valid EFL URL is required.' }, 400)
      }

      if (!['http:', 'https:'].includes(targetUrl.protocol) || isPrivateHostname(targetUrl.hostname)) {
        return jsonResponse({ success: false, message: 'Unsupported EFL URL.' }, 400)
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
      const response = proxiedResponse(body, upstreamResponse.status, contentType, { 'X-Cache': 'MISS' })

      if (upstreamResponse.ok) {
        await cache.put(cacheKey, response.clone())
      }

      return response
    }

    const zipCode = url.searchParams.get('zip_code') ?? url.searchParams.get('zip') ?? ''
    if (!/^\d{5}$/.test(zipCode)) {
      return jsonResponse({ success: false, message: 'A 5-digit ZIP code is required.' }, 400)
    }

    if (url.pathname !== '/api/PowerToChoose/plans' && url.pathname !== '/plans') {
      return jsonResponse({ success: false, message: 'Not found' }, 404)
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
