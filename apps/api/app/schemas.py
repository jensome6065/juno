from typing import Optional

from pydantic import BaseModel, Field, model_validator


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
    """Catalog id OR free-text name+MCC. Category is always inferred by the DE."""

    merchant_id: Optional[str] = None
    merchant_name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    mcc: Optional[str] = Field(default=None, min_length=3, max_length=8)
    amount: Optional[float] = Field(default=None, gt=0)
    # When > 0, rank by reward minus APR carry cost (demo: Reflect 0% promo).
    carry_months: float = Field(default=0.0, ge=0, le=36)
    # Stripe (or demo) authorization id — UNIQUE in the data plane for idempotency.
    authorization_id: Optional[str] = Field(default=None, min_length=1, max_length=128)

    @model_validator(mode="after")
    def require_catalog_or_free_text(self) -> "SimulateRequest":
        if self.merchant_id:
            return self
        if self.merchant_name and self.mcc:
            return self
        raise ValueError("provide merchant_id, or merchant_name + mcc")


class InferRequest(BaseModel):
    merchant_name: str = Field(min_length=1, max_length=255)
    mcc: str = Field(min_length=3, max_length=8)


class InferResponse(BaseModel):
    category: str
    confidence: float
    source: str
    override_id: Optional[str] = None
    mcc_category: Optional[str] = None
    mcc: str
    merchant_name: str


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


class CapBucketOut(BaseModel):
    """One bonus-spend bucket for the current period (UI meter)."""

    spent_cents: int
    limit_cents: int
    remaining_cents: int
    spent: float
    limit: float
    remaining: float
    period: str
    period_id: str
    period_start: str
    period_end: str
    progress: float = Field(ge=0)


class CapStatusResponse(BaseModel):
    as_of: str
    caps: dict[str, dict[str, CapBucketOut]]


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

