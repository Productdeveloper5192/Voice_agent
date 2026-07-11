import os
import uuid
import re
import time
from collections import defaultdict, deque
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from livekit import api
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

app = FastAPI()
token_requests = defaultdict(deque)
TOKEN_RATE_LIMIT = int(os.getenv("TOKEN_RATE_LIMIT_PER_MINUTE", "20"))

allowed_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"message": "Clinic Voice Assistant token service is running."}

@app.get("/health")
async def health():
    required = {
        "livekit": bool(os.getenv("LIVEKIT_API_KEY") and os.getenv("LIVEKIT_API_SECRET")),
        "cors_origins": bool(allowed_origins),
    }
    status = "ok" if all(required.values()) else "misconfigured"
    return {"status": status, "checks": required}

@app.get("/getToken")
async def get_token(request: Request, name: str = "User"):
    client_ip = request.client.host if request.client else "unknown"
    now = time.time()
    recent_requests = token_requests[client_ip]
    while recent_requests and now - recent_requests[0] > 60:
        recent_requests.popleft()

    if len(recent_requests) >= TOKEN_RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Too many token requests. Please try again shortly.")

    recent_requests.append(now)

    livekit_api_key = os.getenv("LIVEKIT_API_KEY")
    livekit_api_secret = os.getenv("LIVEKIT_API_SECRET")
    if not livekit_api_key or not livekit_api_secret:
        raise HTTPException(status_code=500, detail="LiveKit credentials are not configured")

    safe_name = re.sub(r"[^a-zA-Z0-9_-]", "", name.strip())[:64] or "User"

    # Generate a unique room name for this session
    room_name = f"session-{uuid.uuid4().hex[:12]}"
    
    # Generate a token for the user
    token = api.AccessToken(
        livekit_api_key,
        livekit_api_secret
    ).with_identity(safe_name) \
    .with_name(safe_name) \
    .with_grants(api.VideoGrants(
        room_join=True,
        room=room_name,
        can_publish=True,
        can_subscribe=True,
    ))
    
    return {"token": token.to_jwt(), "room": room_name}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
