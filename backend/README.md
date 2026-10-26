# Wind Procurement Backend

UK Wholesale Energy Day-Ahead Wind Procurement analysis backend.

## Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

## API

- `GET /api/health` — Health check
- `GET /api/day-ahead-analysis` — Day-ahead wind forecast analysis

See `SPEC.md` in root for full API contract.
