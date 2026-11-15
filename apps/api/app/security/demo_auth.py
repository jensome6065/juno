"""Gate mutate/demo routes behind a shared demo key.

Not a substitute for real user auth - stops open LAN abuse of /simulate
and /demo while keeping the pitch UX one header away.
"""

from __future__ import annotations

import hmac
import os
from typing import Optional

from fastapi import Header, HTTPException


def demo_key_configured() -> bool:
    return bool(os.getenv("DEMO_API_KEY", "").strip())


def require_demo_key(
    x_demo_key: Optional[str] = Header(default=None, alias="X-Demo-Key"),
) -> None:
    expected = os.getenv("DEMO_API_KEY", "").strip()
    if not expected:
        raise HTTPException(
            status_code=503,
            detail="DEMO_API_KEY is not configured",
        )
    provided = (x_demo_key or "").strip()
    if not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing X-Demo-Key")
