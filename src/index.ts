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
type RedisZRangeResponse = (string | number)[]; // Updated: expecting [member1, score1, member2, score2, ...]

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
  const formatted: Array<{name: string, score: number}> = [];
  if (!entries || entries.length === 0) {
    return formatted;
  }
  for (let i = 0; i < entries.length; i += 2) {
    const member = String(entries[i]); // Ensure member is string
    const score = Number(entries[i+1]); // Ensure score is number
    // Format: "name:timestamp" - we split to get just the name
    const name = member.split(':')[0];
    formatted.push({ name, score });
  }
  return formatted;
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
        const member = `${cleanName}:${Date.now()}`;
        const key = getLeaderboardKey(deviceType);
        // Correct syntax for adding a single score-member pair
        await redis.zadd(key, { score, member });

        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })

      } catch (error: any) {
        console.error(`Error in ${path} (${request.method}):`, error.message, error.stack ? error.stack : 'No stack available');
        return new Response(JSON.stringify({ error: 'Server error processing score submission.', details: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // Get leaderboard
    if (path === '/api/leaderboard' && request.method === 'GET') {
      try {
        const deviceType = url.searchParams.get('deviceType') === 'mobile' ? 'mobile' : 'desktop';
        const key = getLeaderboardKey(deviceType);
        
        // Get top 20 scores
        const leaderboardDataOrNull = await redis.zrange(key, 0, 19, { 
          withScores: true,
          rev: true // Highest scores first
        });

        // Ensure leaderboardDataOrNull is not null before formatting
        const leaderboardData = leaderboardDataOrNull === null ? [] : leaderboardDataOrNull as RedisZRangeResponse;

        return new Response(JSON.stringify(formatLeaderboard(leaderboardData)), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });

      } catch (error: any) {
        console.error(`Error in ${path} (${request.method}):`, error.message, error.stack ? error.stack : 'No stack available');
        return new Response(JSON.stringify({ error: 'Failed to load leaderboard.', details: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // Check if a score qualifies for the leaderboard
    if (path === '/api/check-score' && request.method === 'GET') {
      try {
        const score = parseInt(url.searchParams.get('score') || '0');
        const deviceType = url.searchParams.get('deviceType') === 'mobile' ? 'mobile' : 'desktop';
        const key = getLeaderboardKey(deviceType);
        
        // Get the 20th score entry. If leaderboard has < 20 scores, this will be empty or null.
        const twentiethScoreEntryOrNull = await redis.zrange(key, 19, 19, { 
          withScores: true, 
          rev: true // Highest scores first
        });
        
        let qualifies = false;
        // Handle null case for twentiethScoreEntryOrNull explicitly
        const twentiethScoreEntry = twentiethScoreEntryOrNull === null ? [] : twentiethScoreEntryOrNull as RedisZRangeResponse;

        if (twentiethScoreEntry.length === 0) {
          // No 20th score exists (either key doesn't exist, or fewer than 20 scores).
          // Check total count to see if there's room.
          const count = await redis.zcount(key, '-inf', '+inf');
          if (count < 20) {
            qualifies = true; // Qualifies if fewer than 20 scores total
          }
          // If count is 20 or more, but twentiethScoreEntry is empty, it means we are trying to add the 20th or more item.
          // In this specific branch (twentiethScoreEntry.length === 0), if count >= 20, it implies no specific 20th score to compare against directly here,
          // so it doesn't qualify unless it's among the first 20. This logic path is mainly for <20 scores.
        } else {
          // At least 20 scores exist, and twentiethScoreEntry is [member, score] of the 20th.
          // twentiethScoreEntry will have 2 elements: [member, score]
          const minScoreToQualify = Number(twentiethScoreEntry[1]); 
          qualifies = score > minScoreToQualify;
        }

        return new Response(JSON.stringify({ qualifies }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });

      } catch (error: any) {
        console.error(`Error in ${path} (${request.method}):`, error.message, error.stack ? error.stack : 'No stack available');
        return new Response(JSON.stringify({ error: 'Failed to check score qualification.', details: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // Default response
    return new Response(JSON.stringify({ message: 'Leaderboard API' }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }
}