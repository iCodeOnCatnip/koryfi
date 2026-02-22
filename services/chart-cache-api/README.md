# Chart Cache API (FastAPI + SQLite)

This service stores precomputed basket historical chart payloads by `basketId + year`.
Next.js can read from it first for faster cold starts.

## Run locally

```powershell
cd services/chart-cache-api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:CHART_CACHE_API_KEY="replace-me"
uvicorn main:app --host 0.0.0.0 --port 8787
```

## Next.js env

Add to `.env.local`:

```env
FASTAPI_CHART_CACHE_URL=http://127.0.0.1:8787
FASTAPI_CHART_CACHE_KEY=replace-me
```

If these vars are not set, Next.js will continue using current in-process cache behavior.

## Endpoints

- `GET /health`
- `GET /charts/{basketId}?year=2026`
- `PUT /charts/{basketId}?year=2026` with JSON body:

```json
{
  "basketId": "sol-defi",
  "data": [
    { "timestamp": 1735689600000, "prices": { "mintA": 1.23 } }
  ]
}
```
