"""SQLAlchemy engine / session for the secure data plane.

Never persist raw PAN, CVV, track data, or full account numbers.
Card references use issuer last4 from the rules library only.
"""

from __future__ import annotations

import os
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.tables import Base

DEFAULT_SQLITE = "sqlite+pysqlite:///./juno.db"


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    url = os.getenv("DATABASE_URL") or DEFAULT_SQLITE
    kwargs: dict = {"future": True, "pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
        # Keep a single shared in-memory DB across connections.
        if ":memory:" in url:
            kwargs["poolclass"] = StaticPool
    engine = create_engine(url, **kwargs)
    Base.metadata.create_all(engine)
    return engine


def reset_engine() -> None:
    """Drop the cached engine (tests that swap DATABASE_URL)."""
    get_engine.cache_clear()


def SessionLocal() -> Session:
    return sessionmaker(bind=get_engine(), autoflush=False, autocommit=False, future=True)()


def init_db() -> None:
    get_engine()
