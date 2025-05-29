import { Redis } from '@upstash/redis/cloudflare'

interface Env {
  UPSTASH_REDIS_REST_URL: string
  UPSTASH_REDIS_REST_TOKEN: string
}

// Define interfaces for our data structures
interface ScoreRequest {
  name: string
  score: number
  deviceType: 'mobile' | 'desktop'
}

// Redis returns an array of [member, score] tuples
type RedisZRangeResponse = [string, number][];

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Helper to get current month key (e.g., "2025-05:mobile" or "2025-05:desktop")
function getLeaderboardKey(deviceType: 'mobile' | 'desktop'): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1 // 1-12
  return `leaderboard:${year}-${month}:${deviceType}`
}

// Helper to format leaderboard response
function formatLeaderboard(entries: RedisZRangeResponse): Array<{name: string, score: number}> {
  return entries.map(([member, score]) => {
    // Format: "name:timestamp" - we split to get just the name
    const name = member.split(':')[0]
    return { name, score }
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const redis = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    })

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // Submit a new score
    if (path === '/api/score' && request.method === 'POST') {
      try {
        const body: unknown = await request.json()
        const { name, score, deviceType } = body as ScoreRequest
        
        // Basic validation
        if (!name || typeof score !== 'number' || !['mobile', 'desktop'].includes(deviceType)) {
          return new Response(JSON.stringify({ error: 'Invalid request' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          })
        }

        // Clean and validate name (max 5 chars, alphanumeric)
        const cleanName = name.toString().substring(0, 5).replace(/[^a-zA-Z0-9]/g, '')
        if (!cleanName) {
          return new Response(JSON.stringify({ error: 'Invalid name' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          })
        }

        // Add score to the leaderboard with timestamp for uniqueness
        const member = `${cleanName}:${Date.now()}`
        const key = getLeaderboardKey(deviceType)
        await redis.zadd(key, { score, member })

        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })

      } catch (error) {
        return new Response(JSON.stringify({ error: 'Server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })
      }
    }

    // Get leaderboard
    if (path === '/api/leaderboard' && request.method === 'GET') {
      try {
        const deviceType = url.searchParams.get('deviceType') === 'mobile' ? 'mobile' : 'desktop'
        const key = getLeaderboardKey(deviceType)
        
        // Get top 20 scores
        const leaderboard = await redis.zrange(key, 0, 19, { 
          withScores: true,
          rev: true // Highest scores first
        }) as unknown as RedisZRangeResponse

        return new Response(JSON.stringify(formatLeaderboard(leaderboard)), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })

      } catch (error) {
        return new Response(JSON.stringify({ error: 'Failed to load leaderboard' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })
      }
    }

    // Check if a score qualifies for the leaderboard
    if (path === '/api/check-score' && request.method === 'GET') {
      try {
        const score = parseInt(url.searchParams.get('score') || '0')
        const deviceType = url.searchParams.get('deviceType') === 'mobile' ? 'mobile' : 'desktop'
        const key = getLeaderboardKey(deviceType)
        
        // Get current 20th score (or empty array if fewer than 20 entries)
        const leaderboard = await redis.zrange(key, 19, 19, { 
          withScores: true, 
          rev: true 
        }) as unknown as RedisZRangeResponse
        
        // Get the minimum score needed to qualify
        const minScore = leaderboard.length > 0 ? leaderboard[0][1] : 0
        
        // Qualifies if leaderboard has fewer than 20 entries or score is higher than the 20th
        const qualifies = leaderboard.length === 0 || score > minScore

        return new Response(JSON.stringify({ qualifies }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })

      } catch (error) {
        return new Response(JSON.stringify({ error: 'Failed to check score' }), {
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