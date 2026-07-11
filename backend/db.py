import os
from datetime import datetime
from pathlib import Path
from supabase import create_client, Client
from postgrest.exceptions import APIError
from dotenv import load_dotenv

# Load env from the same directory as this file
load_dotenv(dotenv_path=Path(__file__).parent / ".env")

url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")

supabase: Client = create_client(url, key)

OPTIONAL_TABLE_MISSING_CODES = {"PGRST205"}

def _is_optional_table_missing(error: APIError) -> bool:
    return getattr(error, "code", None) in OPTIONAL_TABLE_MISSING_CODES or "schema cache" in str(error)

def _clean_text(value: str | None) -> str | None:
    return value.strip() if isinstance(value, str) else value

def _normalize_phone_number(value: str | None) -> str | None:
    if not value or not isinstance(value, str):
        return value
    digits = "".join(ch for ch in value if ch.isdigit())
    return digits or value.strip()

def _normalize_datetime(value: str) -> str:
    """
    Store appointment times in one comparable ISO format.
    Supabase may accept many ISO variants, but exact-match availability checks
    only work reliably if writes and reads use the same shape.
    """
    cleaned = value.strip().replace("Z", "+00:00")
    parsed = datetime.fromisoformat(cleaned)
    return parsed.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%S")

def _normalize_date_time(date: str, time_slot: str) -> str:
    return _normalize_datetime(f"{date.strip()}T{time_slot.strip()}:00")

async def get_user_by_contact(contact_number: str):
    normalized_contact = _normalize_phone_number(contact_number)
    # Try exact match first
    response = supabase.table("users").select("*").eq("contact_number", normalized_contact).execute()
    if response.data:
        return response.data[0]

    # Fuzzy match: check if stored number ends with input or input ends with stored number
    # This handles cases where STT drops leading digits or country code differences
    if normalized_contact and len(normalized_contact) >= 6:
        all_users = supabase.table("users").select("*").execute()
        for user in all_users.data:
            stored = user.get("contact_number", "")
            if not stored:
                continue
            # Match if last 7+ digits overlap
            min_len = min(len(normalized_contact), len(stored))
            match_len = max(7, min_len - 2)
            if (normalized_contact[-match_len:] == stored[-match_len:]
                    or stored.endswith(normalized_contact)
                    or normalized_contact.endswith(stored)):
                return user
    return None

async def get_user_by_email(email: str):
    """Get user by email address"""
    response = supabase.table("users").select("*").eq("email", email.strip().lower()).execute()
    if response.data:
        return response.data[0]
    return None

async def get_user_by_contact_or_email(identifier: str):
    """
    Get user by either contact number or email.
    Tries contact number first, then email.
    """
    cleaned_identifier = identifier.strip()

    # Try contact number first
    user = await get_user_by_contact(cleaned_identifier)
    if user:
        return user
    
    # If not found, try email
    user = await get_user_by_email(cleaned_identifier)
    return user

async def create_user(contact_number: str, name: str = None, email: str = None):
    """Create a new user with contact number, name, and optional email"""
    normalized_contact = _normalize_phone_number(contact_number)
    data = {
        "contact_number": normalized_contact,
        "name": _clean_text(name)
    }
    if email:
        data["email"] = email.strip().lower()

    try:
        response = supabase.table("users").insert(data).execute()
    except APIError as error:
        # If user already exists or there is a constraint issue, return None so the agent can retry or ask for a different identifier.
        if _is_optional_table_missing(error):
            return None
        raise

    if response.data:
        return response.data[0]
    return None


async def get_user_by_id(user_id: str):
    response = supabase.table("users").select("*").eq("id", user_id).execute()
    if response.data:
        return response.data[0]
    return None

async def get_appointments(user_id: str):
    # Get user's contact number first
    user = await get_user_by_id(user_id)
    if not user:
        return []
    
    # Only fetch active (booked) appointments, not cancelled ones
    response = supabase.table("appointments").select("*").eq("contact_number", user["contact_number"]).eq("status", "booked").execute()
    # Format to match expected structure
    appointments = []
    for appt in response.data:
        appointments.append({
            "id": appt["id"],
            "start_time": appt["appointment_time"],
            "status": appt["status"],
            "details": appt.get("details", ""),
            "created_at": appt.get("created_at")
        })
    return appointments

async def create_appointment(user_id: str, start_time: str, duration_mins: int = 30, summary: str = None):
    user = await get_user_by_id(user_id)
    if not user:
        return None

    normalized_start_time = _normalize_datetime(start_time)
    if not await check_availability_by_datetime(normalized_start_time):
        return None
    
    # Combine duration and summary into details field
    details_text = summary or f"{duration_mins} minute appointment"
    
    data = {
        "contact_number": user["contact_number"],
        "appointment_time": normalized_start_time,
        "details": details_text,
        "status": "booked"
    }
    response = supabase.table("appointments").insert(data).execute()
    if response.data:
        return response.data[0]
    return None

async def reschedule_appointment(appointment_id: str, new_time: str):
    """
    Reschedule an existing appointment by updating its time.
    
    Args:
        appointment_id: The ID of the appointment to reschedule
        new_time: ISO string of the new time (e.g., 2023-10-27T14:00:00)
    """
    normalized_new_time = _normalize_datetime(new_time)
    if not await check_availability_by_datetime(normalized_new_time, exclude_appointment_id=appointment_id):
        return None

    data = {"appointment_time": normalized_new_time}
    response = supabase.table("appointments").update(data).eq("id", appointment_id).eq("status", "booked").execute()
    if response.data:
        return response.data[0]
    return None

async def cancel_appointment(appointment_id: str):
    response = supabase.table("appointments").update({"status": "cancelled"}).eq("id", appointment_id).execute()
    return response.data

async def check_availability(date: str, time_slot: str):
    """
    Check if a time slot is available without revealing other users' appointment details.
    Returns a boolean indicating availability.
    
    Args:
        date: Date in YYYY-MM-DD format
        time_slot: Time in HH:MM format
    """
    datetime_str = _normalize_date_time(date, time_slot)
    return await check_availability_by_datetime(datetime_str)

async def check_availability_by_datetime(datetime_str: str, exclude_appointment_id: str | None = None):
    """
    Check if a normalized appointment datetime is free.
    The database migration adds a partial unique index for booked appointments,
    which is the final guard against race-condition double bookings.
    """
    normalized_datetime = _normalize_datetime(datetime_str)

    # Query for any appointments at this exact time
    query = supabase.table("appointments").select("id").eq("appointment_time", normalized_datetime).eq("status", "booked")
    if exclude_appointment_id:
        query = query.neq("id", exclude_appointment_id)
    response = query.execute()
    
    # If no appointments found, slot is available
    is_available = len(response.data) == 0
    return is_available

async def save_message(user_id: str, role: str, content: str):
    data = {
        "user_id": user_id,
        "role": role,
        "content": content
    }
    try:
        supabase.table("messages").insert(data).execute()
    except APIError as error:
        if not _is_optional_table_missing(error):
            raise

async def get_chat_history(user_id: str, limit: int = 50):
    try:
        response = supabase.table("messages").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(limit).execute()
    except APIError as error:
        if _is_optional_table_missing(error):
            return []
        raise
    # Reverse to get chronological order
    return response.data[::-1] if response.data else []

# ============================================================================
# Session Memory Functions
# ============================================================================

async def create_session(session_id: str):
    """
    Create a new session record.
    Called when a new LiveKit session starts.
    Uses upsert to handle cases where session already exists.
    """
    data = {
        "session_id": session_id,
        "user_id": None,  # Not identified yet
        "metadata": {},
        "started_at": datetime.utcnow().isoformat(),
        "last_activity_at": datetime.utcnow().isoformat()
    }
    # Use upsert to avoid duplicate key errors
    try:
        response = supabase.table("session_memory").upsert(data, on_conflict="session_id").execute()
    except APIError as error:
        if _is_optional_table_missing(error):
            return None
        raise
    return response.data[0] if response.data else None

async def update_session_user(session_id: str, user_id: str):
    """
    Update session with identified user_id.
    Called when user is successfully identified.
    """
    data = {
        "user_id": user_id,
        "last_activity_at": datetime.utcnow().isoformat()
    }
    try:
        response = supabase.table("session_memory").update(data).eq("session_id", session_id).execute()
    except APIError as error:
        if _is_optional_table_missing(error):
            return None
        raise
    return response.data[0] if response.data else None

async def get_session(session_id: str):
    """
    Get session information.
    """
    try:
        response = supabase.table("session_memory").select("*").eq("session_id", session_id).execute()
    except APIError as error:
        if _is_optional_table_missing(error):
            return None
        raise
    return response.data[0] if response.data else None

async def delete_session(session_id: str):
    """
    Delete session when it ends.
    Called when LiveKit session closes.
    """
    try:
        response = supabase.table("session_memory").delete().eq("session_id", session_id).execute()
    except APIError as error:
        if _is_optional_table_missing(error):
            return []
        raise
    return response.data
