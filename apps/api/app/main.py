from fastapi import FastAPI

app = FastAPI(title="Juno API")


@app.get("/health")
def health():
    return {"ok": True}
