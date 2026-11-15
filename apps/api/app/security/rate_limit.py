"""Simple in-memory per-IP rate limit for mutate paths."""

from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


def _is_limited(path: str) -> bool:
    if path in ("/simulate", "/infer"):
        return True
    return (
        path.startswith("/demo")
        or path.startswith("/webhooks/stripe")
        or path == "/wallet/pass"
    )


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app,
        max_requests: Optional[int] = None,
        window_seconds: Optional[float] = None,
    ):
        super().__init__(app)
        self.max_requests = max_requests or int(os.getenv("RATE_LIMIT_MAX", "60"))
        self.window_seconds = window_seconds or float(
            os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60")
        )
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return await call_next(request)
        path = request.url.path
        if not _is_limited(path):
            return await call_next(request)

        client = request.client.host if request.client else "unknown"
        bucket = path.split("/")[1] if path.startswith("/") else path
        key = f"{client}:{bucket}"
        now = time.monotonic()
        window = self._hits[key]
        cutoff = now - self.window_seconds
        while window and window[0] < cutoff:
            window.popleft()
        if len(window) >= self.max_requests:
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded"},
                headers={"Retry-After": str(int(self.window_seconds))},
            )
        window.append(now)
        return await call_next(request)
