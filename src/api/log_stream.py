"""
Live log streaming module.
Patches status.py print functions to also push into a shared in-memory queue,
then exposes an SSE endpoint to stream them to the frontend.
"""
import asyncio
import json
import time
from collections import deque
from typing import AsyncGenerator

# In-memory log buffer (max 300 entries)
_log_queue: deque = deque(maxlen=300)

# SSE subscriber queues for active connections
_subscribers: list[asyncio.Queue] = []


def add_log(level: str, message: str) -> None:
    """Push a log entry to the buffer and notify all SSE subscribers."""
    entry = {
        "ts": time.strftime("%H:%M:%S"),
        "level": level,        # info | warning | error | success
        "message": message.strip(),
    }
    _log_queue.append(entry)

    # Notify live subscribers (non-blocking)
    for q in list(_subscribers):
        try:
            q.put_nowait(entry)
        except asyncio.QueueFull:
            pass


async def _log_generator(request) -> AsyncGenerator[str, None]:
    """Async generator that yields SSE-formatted log events."""
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    _subscribers.append(q)

    # Replay last 50 logs on connect so the console isn't blank
    for entry in list(_log_queue)[-50:]:
        yield f"data: {json.dumps(entry)}\n\n"

    try:
        while not await request.is_disconnected():
            try:
                entry = await asyncio.wait_for(q.get(), timeout=20)
                yield f"data: {json.dumps(entry)}\n\n"
            except asyncio.TimeoutError:
                # Heartbeat to keep connection alive
                yield f"data: {json.dumps({'ts': time.strftime('%H:%M:%S'), 'level': 'ping', 'message': ''})}\n\n"
    finally:
        _subscribers.remove(q)


def get_log_history() -> list:
    """Return full in-memory log buffer as list (for REST fallback)."""
    return list(_log_queue)
