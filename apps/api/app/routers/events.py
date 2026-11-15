import asyncio
import json
import queue

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.events import subscribe, unsubscribe

router = APIRouter(tags=["events"])


@router.get("/events")
async def stream_events(request: Request) -> StreamingResponse:
    q = subscribe()

    async def event_generator():
        try:
            yield f"data: {json.dumps({'type': 'connected'})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    # Short timeout so --reload can shut down instead of hanging
                    # on open EventSource connections.
                    event = await asyncio.to_thread(q.get, True, 0.5)
                    yield f"data: {json.dumps(event, default=str)}\n\n"
                except queue.Empty:
                    yield ": keepalive\n\n"
                    await asyncio.sleep(0)
        finally:
            unsubscribe(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
