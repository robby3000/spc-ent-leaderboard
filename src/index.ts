import { Redis } from '@upstash/redis/cloudflare'

interface Env {
  UPSTASH_REDIS_REST_URL: string
  UPSTASH_REDIS_REST_TOKEN: string
}

interface ScoreEntry {
  name: string
  score: number
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const redis = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    })

    const url = new URL(request.url)
    const path = url.pathname

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // Submit score
    if (path === '/api/score' && request.method === 'POST') {
      try {
        const { name, score } = await request.json<ScoreEntry>()
        if (!name || typeof score !== 'number') {
          return new Response(JSON.stringify({ error: 'Invalid request' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          })
        }
        
        await redis.zadd('leaderboard', { 
			score,
			member: name 
		  })
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })
      }
    }

    // Get leaderboard (top 10)
    if (path === '/api/leaderboard' && request.method === 'GET') {
      try {
        const leaderboard = await redis.zrange('leaderboard', 0, 9, { 
			withScores: true,
			rev: true  // This makes it behave like zrevrange
		  })
        return new Response(JSON.stringify(leaderboard), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Failed to fetch leaderboard' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })
      }
    }

    // Default response
    return new Response(JSON.stringify({ message: 'Leaderboard API' }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }
}