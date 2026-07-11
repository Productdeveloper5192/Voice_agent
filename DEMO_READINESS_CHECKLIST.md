# LinkedIn / Client Demo Readiness Checklist

Use this checklist before recording or sharing the demo with clients.

## Required Environment

Backend:

```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
DEEPGRAM_API_KEY=your_deepgram_api_key
CARTESIA_API_KEY=your_cartesia_api_key
BEY_API_KEY=your_bey_api_key
GOOGLE_API_KEY=your_google_api_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_supabase_key
GEMINI_MODEL=gemini-2.0-flash-exp
CARTESIA_VOICE_ID=a167e0f3-df7e-4d52-a9c3-f949145efdab
CORS_ALLOWED_ORIGINS=https://your-frontend-domain.com
TOKEN_RATE_LIMIT_PER_MINUTE=20
```

Frontend:

```env
VITE_LIVEKIT_URL=wss://your-project.livekit.cloud
VITE_BACKEND_URL=https://your-backend-domain.com
VITE_SHOW_DEBUG_TRACKS=false
VITE_SHOW_AGENT_ACTIVITY=true
```

## Database

Run all migrations in `backend/migrations`, especially:

```sql
prevent_double_booked_appointments.sql
```

This prevents duplicate active bookings at the database level.

## Demo Flow

1. Start the backend token server.
2. Start the LiveKit agent worker.
3. Start the frontend.
4. Open the frontend in a clean browser tab.
5. Test one booking, one reschedule, and one cancellation.
6. Confirm `/health` returns `status: ok` from the backend.

## Client-Facing Settings

- Keep `VITE_SHOW_DEBUG_TRACKS=false`.
- Keep real secrets out of frontend env files.
- Use a clean Supabase demo database with sample clinic data.
- Do not share logs that include phone numbers, emails, or appointment details.

