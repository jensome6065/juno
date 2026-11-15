from fastapi import APIRouter

from app.schemas import TransactionOut
from app.store import list_transactions

router = APIRouter(prefix="/transactions", tags=["transactions"])


@router.get("", response_model=list[TransactionOut])
def get_transactions() -> list[TransactionOut]:
    return [TransactionOut(**tx) for tx in list_transactions()]
