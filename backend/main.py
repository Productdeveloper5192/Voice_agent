import os
from pathlib import Path

from dotenv import load_dotenv
from livekit.agents import WorkerOptions, cli

from agent import entrypoint


if __name__ == "__main__":
    load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            ws_url=os.environ.get("LIVEKIT_URL", "").strip(),
            api_key=os.environ.get("LIVEKIT_API_KEY", "").strip(),
            api_secret=os.environ.get("LIVEKIT_API_SECRET", "").strip(),
        )
    )
