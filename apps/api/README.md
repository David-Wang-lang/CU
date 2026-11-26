# CU API

FastAPI backend for the CU endpoint monitoring platform.

## Local development

```bash
cd apps/api
uv sync
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Health check: `GET /api/v1/health`
