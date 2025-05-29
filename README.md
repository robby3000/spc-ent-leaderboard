# Space Entropy Defense Leaderboard

A high-performance leaderboard service for the Space Entropy Defense game, built with Cloudflare Workers and Upstash Redis.

## Features

- 🚀 Real-time score submission and retrieval
- 🏆 Top 10 global leaderboard
- ⚡ Edge-deployed for low-latency worldwide access
- 🔒 Secure API endpoints with CORS support

## API Endpoints

### Submit Score
```
POST /api/score
Content-Type: application/json

{
  "name": "Player1",
  "score": 1000
}
```

### Get Leaderboard
```
GET /api/leaderboard
```

## Local Development

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.dev.vars` file with your Upstash credentials:
   ```
   UPSTASH_REDIS_REST_URL="your-upstash-url"
   UPSTASH_REDIS_REST_TOKEN="your-upstash-token"
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```

## Deployment

1. Deploy to Cloudflare Workers:
   ```bash
   npm run deploy
   ```

2. Set environment variables in the Cloudflare dashboard:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

## Technologies Used

- Cloudflare Workers
- Upstash Redis
- TypeScript
- Wrangler CLI

## License

MIT
