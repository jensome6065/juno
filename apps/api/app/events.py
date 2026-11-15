"""In-process pub/sub for live dashboard updates (SSE)."""

from __future__ import annotations

import queue
import threading
from typing import Any

_lock = threading.Lock()
_subscribers: list[queue.Queue] = []


def publish(event_type: str, payload: dict[str, Any]) -> None:
    message = {"type": event_type, **payload}
    with _lock:
        subscribers = list(_subscribers)
    for q in subscribers:
        try:
            q.put_nowait(message)
        except queue.Full:
            # Drop oldest if a slow client falls behind; newest events matter for the demo.
            try:
                q.get_nowait()
            except queue.Empty:
                pass
            try:
                q.put_nowait(message)
            except queue.Full:
                pass


def subscribe() -> queue.Queue:
    q: queue.Queue = queue.Queue(maxsize=64)
    with _lock:
        _subscribers.append(q)
    return q


def unsubscribe(q: queue.Queue) -> None:
    with _lock:
        if q in _subscribers:
            _subscribers.remove(q)
