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

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    if (request.method !== 'GET') {
      return jsonResponse({ success: false, message: 'Method not allowed' }, 405)
    }

    const url = new URL(request.url)
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
