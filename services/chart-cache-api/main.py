import json
import os
import sqlite3
import time
from contextlib import contextmanager
from typing import Any, Dict, List

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

DB_PATH = os.getenv("CHART_CACHE_DB_PATH", "./chart_cache.db")
API_KEY = os.getenv("CHART_CACHE_API_KEY")

app = FastAPI(title="KoryFi Chart Cache API", version="1.0.0")


class ChartPoint(BaseModel):
    timestamp: int
    prices: Dict[str, float]


class ChartPayload(BaseModel):
    basketId: str
    data: List[ChartPoint]


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.row_factory = sqlite3.Row
        yield conn
    finally:
        conn.close()


def require_api_key(x_api_key: str | None):
    if not API_KEY:
        return
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")


def init_db():
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chart_cache (
                basket_id TEXT NOT NULL,
                year INTEGER NOT NULL,
                payload TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                PRIMARY KEY (basket_id, year)
            )
            """
        )
        conn.commit()


@app.on_event("startup")
def on_startup():
    init_db()


@app.get("/health")
def health():
    return {"ok": True, "ts": int(time.time() * 1000)}


@app.get("/charts/{basket_id}", response_model=ChartPayload)
def get_chart(basket_id: str, year: int, x_api_key: str | None = Header(default=None)):
    require_api_key(x_api_key)
    with get_conn() as conn:
        row = conn.execute(
            "SELECT payload FROM chart_cache WHERE basket_id = ? AND year = ?",
            (basket_id, year),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    try:
        payload = json.loads(row["payload"])
    except Exception:
        raise HTTPException(status_code=500, detail="Corrupted payload")
    return payload


@app.put("/charts/{basket_id}")
def upsert_chart(
    basket_id: str,
    year: int,
    payload: ChartPayload,
    x_api_key: str | None = Header(default=None),
):
    require_api_key(x_api_key)
    if payload.basketId != basket_id:
        raise HTTPException(status_code=400, detail="basketId mismatch")
    now_ms = int(time.time() * 1000)
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO chart_cache (basket_id, year, payload, updated_at_ms)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(basket_id, year) DO UPDATE SET
                payload = excluded.payload,
                updated_at_ms = excluded.updated_at_ms
            """,
            (basket_id, year, payload.model_dump_json(), now_ms),
        )
        conn.commit()
    return {"ok": True, "updatedAtMs": now_ms}
