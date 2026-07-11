# Instant Appointment Voice AI

An AI voice agent that answers the phone (or a browser call) for a medical clinic, has a natural spoken conversation with the caller, and books, reschedules, or cancels their appointment directly in the clinic's database — with no human receptionist involved.

The caller talks to a real-time avatar. Behind the scenes, their speech is transcribed, understood, and acted on in well under a second per turn, and the result is written straight to the clinic's appointment database.

---

## 1. The Problem

Clinics lose revenue and patients every day to phone-based scheduling friction:

- Front-desk staff are expensive and unavailable outside office hours.
- Callers who hit voicemail or long hold times often just book elsewhere.
- Manual scheduling is error-prone — double bookings, missed cancellations, mistyped contact info.

## 2. The Solution

A always-on voice AI receptionist that:

- Picks up instantly, in a natural, human-sounding conversation.
- Verifies who the caller is (or creates a new patient record with consent).
- Checks real-time availability and books/reschedules/cancels appointments — with database-level protection against double-booking.
- Never reveals another patient's information, and only ever shows the caller their own active appointments.
- Runs 24/7 at a fraction of the cost of a human receptionist, and scales to unlimited simultaneous callers.

## 3. End-to-End Flow

```
 Caller (browser/phone)
        │  1. requests a session
        ▼
 Token Server (FastAPI)  ──issues a secure, rate-limited LiveKit token──▶ Caller
        │
        │  2. caller joins a private real-time room
        ▼
 LiveKit (real-time audio transport)
        │
        ▼
 Voice Agent Worker  ─────────────────────────────────────────────┐
   │                                                               │
   │  Deepgram STT        →  turns caller speech into text         │
   │  Gemini / Azure LLM  →  understands intent, decides next step │
   │  Deepgram TTS        →  turns the agent's reply into speech   │
   │  Beyond Presence     →  renders a talking avatar in sync      │
   │  Silero VAD          →  detects when the caller starts/stops  │
   │                          talking, for natural turn-taking     │
   └───────────────────────────────────────────────────────────────┘
        │
        │  3. structured "tool calls" (identify user, check slot,
        │     book / reschedule / cancel) — never free-form SQL
        ▼
 Supabase (Postgres)
   - users            → patient identity, contact info
   - appointments     → booked / cancelled slots, with a DB-level
                         constraint that makes double-booking impossible
   - session_memory   → which caller is on which call, right now
   - messages         → conversation transcript, tied to the patient

        │
        ▼
 Caller hears the confirmation and sees the same event mirrored
 live in the web UI (booking confirmed, slot unavailable, etc.)
```

**Round trip:** caller speaks → text → intent → database read/write → spoken confirmation, typically in a couple of seconds, indistinguishable from talking to a live scheduler.

## 4. What Makes This Reliable, Not Just a Demo

- **Identity verification before any action.** The agent confirms the caller's phone number and spells names/emails back letter-by-letter before touching any patient data — modeled on how a careful human receptionist operates.
- **Consent-gated account creation.** New patients are only added to the database after they explicitly agree; the agent states plainly that their data is private and never sold.
- **No double-booking, even under race conditions.** A Postgres constraint (not just application logic) makes it physically impossible for two callers to book the same slot at once.
- **Privacy by design.** The agent will only ever confirm "available / not available" for a slot — it never leaks whose appointment is whose, and only shows a caller their own bookings.
- **Full audit trail.** Every message and every booking action is persisted, so every conversation is reviewable.
- **Live operational visibility.** The frontend shows in real time which pipeline stage is active (speech-to-text, reasoning, text-to-speech, avatar, database) — useful for both debugging and for showing a technical audience exactly what's happening under the hood.

## 5. Technology Stack

| Layer | Technology | Role |
|---|---|---|
| Real-time transport | **LiveKit** | Low-latency audio/video room between caller and agent |
| Speech-to-Text | **Deepgram** | Converts caller speech to text in real time |
| Reasoning / dialogue | **Gemini** (or Azure OpenAI) | Understands intent, drives the conversation, calls tools |
| Text-to-Speech | **Deepgram Aura** | Converts the agent's reply into natural speech |
| Avatar | **Beyond Presence** | Renders a synchronized talking avatar |
| Turn-taking | **Silero VAD** | Detects when the caller starts/stops speaking |
| Database | **Supabase (Postgres)** | Patients, appointments, sessions, transcripts |
| Backend | **FastAPI (Python)** | Secure token issuance, agent orchestration |
| Frontend | **React + Vite + LiveKit Components** | In-browser calling experience and live status UI |

This is a modular, swappable pipeline — any component (STT/LLM/TTS/avatar) can be replaced without touching the rest of the system, which keeps the product resilient to vendor pricing/availability changes as it scales.

## 6. Where This Goes Next

- Outbound calling (appointment reminders, no-show follow-ups, recall campaigns).
- Multi-clinic / multi-tenant support from a single deployment.
- Insurance and intake-form collection during the same call.
- Analytics dashboard on booking volume, no-show rates, and call outcomes.

---

## Local Setup

### 1. Clone the Repository
```bash
git clone https://github.com/iamvaar-dev/instant-appointment-voice-ai
cd instant-appointment-voice-ai
```

### 2. Environment Variables
Create `.env` files in `frontend/` and `backend/` with the following variables:

**Backend (`backend/.env`):**
```env
LIVEKIT_URL=wss://...
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
DEEPGRAM_API_KEY=...
CARTESIA_API_KEY=...
BEY_API_KEY=...
GOOGLE_API_KEY=...
SUPABASE_URL=...
SUPABASE_KEY=...
```

**Frontend (`frontend/.env`):**
```env
VITE_LIVEKIT_URL=wss://...
```

### 3. Run Locally
To start the backend (Token Server & Agent) and frontend concurrently:

```bash
./run_all.sh
```
