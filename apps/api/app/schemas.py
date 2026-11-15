from typing import Optional

from pydantic import BaseModel, Field


class CardOut(BaseModel):
    id: str
    name: str
    issuer: str = ""
    last4: str = "0000"
    is_default: bool = False
    highlight: str = ""
    category_spend: float = 0.0
    intro_apr_ends_on: Optional[str] = None


class MerchantOut(BaseModel):
    id: str
    name: str
    mcc: str
    category: str
    typical_amount: float


class TransactionOut(BaseModel):
    id: int
    merchant_name: str
    mcc: str
    category: str
    category_source: Optional[str] = None
    category_confidence: Optional[float] = None
    amount: float
    selected_card_id: str
    selected_card_name: str
    default_card_name: str
    reward_value: float
    default_reward_value: float
    extra_value: float
    reason: str
    cap_key: Optional[str] = None
    cap_credited_cents: Optional[int] = None
    cap_period_id: Optional[str] = None
    cap_remaining_cents: Optional[int] = None
    created_at: str


class SimulateRequest(BaseModel):
    merchant_id: str
    amount: Optional[float] = Field(default=None, gt=0)
    # Stripe (or demo) authorization id — UNIQUE in the data plane for idempotency.
    authorization_id: Optional[str] = Field(default=None, min_length=1, max_length=128)


class RouteScore(BaseModel):
    card_id: str
    card_name: str
    value: float
    rate_used: float
    reason: str
    rank: Optional[int] = None
    eligible: bool = True
    constraint: Optional[str] = None
    cap_split: bool = False
    bonus_key: Optional[str] = None


class DecisionIntel(BaseModel):
    """How category was resolved and whether caps shaped the winner."""

    category: str
    category_source: str
    category_confidence: Optional[float] = None
    mcc_category: Optional[str] = None
    override_id: Optional[str] = None
    winner_cap_split: bool = False


class SimulateResponse(BaseModel):
    transaction: TransactionOut
    scores: list[RouteScore]
    intel: Optional[DecisionIntel] = None
    wallet_updated: bool = False
    latency_ms: float = 0.0
    signature_verified: bool = False
    authorization_id: Optional[str] = None
    idempotent_replay: bool = False


class WalletStatusOut(BaseModel):
    configured: bool
    serial_number: Optional[str] = None
    share_url: Optional[str] = None
    google_save_url: Optional[str] = None


class WalletPassOut(BaseModel):
    serial_number: str
    share_url: Optional[str] = None
    google_save_url: Optional[str] = None
    apple_pass: Optional[str] = None

