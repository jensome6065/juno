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
    amount: float
    selected_card_id: str
    selected_card_name: str
    default_card_name: str
    reward_value: float
    default_reward_value: float
    extra_value: float
    reason: str
    created_at: str


class SimulateRequest(BaseModel):
    merchant_id: str
    amount: Optional[float] = Field(default=None, gt=0)


class RouteScore(BaseModel):
    card_id: str
    card_name: str
    value: float
    rate_used: float
    reason: str


class SimulateResponse(BaseModel):
    transaction: TransactionOut
    scores: list[RouteScore]
