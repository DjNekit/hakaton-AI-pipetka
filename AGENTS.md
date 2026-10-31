# AGENTS.md

Hackathon MVP «Колорпаспорт»: checks facade-color passports and sign design projects against Moscow regulations, compares facade drawings with photos. Python/Django backend + React/Vite frontend, Docker Compose.

## Run and verify

Docker is the supported path (tesseract, OpenCV, PostgreSQL, GigaChat CA certs live in images):

```bash
cp .env.example .env
docker compose up --build          # UI http://localhost:5173, API http://localhost:8000/api/health
docker compose down
docker compose exec backend python -m colorpass check ../dataset/real/<file>.pdf --no-llm
docker compose exec backend python -m colorpass eval
docker compose exec backend python -m colorpass eval ../dataset/signs
docker compose exec backend python -m colorpass eval-photos
docker compose exec backend python -m colorpass llm-status
```

Frontend only: `cd frontend && npm ci && npm run dev` (or `npm run build`). There is no lint, typecheck, or test script.

**There is no automated test suite.** README, `docs/project-context.md`, and `dataset/README.md` still mention `backend/tests/*` and `python -m unittest discover` — those tests were removed (commit "Убрать тесты: CI только деплоит"). Do not claim tests pass; verify with the `eval` commands and `/api/health`.

## Architecture boundaries

- Pipeline: `backend/colorpass` (framework-independent) `ingest -> extract/signage -> checks -> report`. Django is a thin HTTP layer: `backend/api/views.py` -> `colorpass/service.py`.
- `backend/devserver.py` is a stdlib fallback server with the same `/api/*` routes. When adding an endpoint, update both `api/urls.py`/`api/views.py` and `devserver.py`; update `frontend/src/api.js` too.
- Django has **no ORM models and no migrations**. History is raw SQL in `colorpass/store.py`, which auto-creates its schema. Do not run `makemigrations`.
- `DATABASE_URL` enables PostgreSQL history; without it the service falls back to files under `runs/web/<id>/`. Report files always live in `runs/`.
- Checks run in background threads and keep status in process memory + `runs/web/<id>/status.json`. Production gunicorn must stay at **one worker** (threads are fine); multiple workers would break status sharing.
- Rules, thresholds, and requirement texts belong in `backend/colorpass/data/rules.yaml`, not in Python or JS.
- GigaChat is optional and is never the judge: code decides pass/fail from rules; the LLM only reads text/images and drafts conclusions. Preserve this invariant. With no `GIGACHAT_AUTH_KEY`, everything runs rules-only.

## Conventions

- Comments, findings, report text, and UI strings are in Russian. Python: PEP 8 + type hints + `from __future__ import annotations`.
- React: functional components, no UI library; styles in `frontend/src/styles.css`.
- API routes have no trailing slash (`APPEND_SLASH = False`).
- Python CLI must be run from `backend/` (it imports top-level `colorpass`); `python -m colorpass` resolves the repo root for `dataset/` and `runs/`.
- `.env` is loaded manually by `colorpass/envfile.py`; real environment variables override it.

## Data

- `dataset/real/`: passports + `*.expected.json` + `*.photos.json`; `dataset/signs/`: sign design-project samples. PDFs are committed despite the dataset README claiming otherwise.
- A sample appears in the UI only when both its PDF and matching `*.expected.json` exist. `dataset/` is mounted into the backend container.
- `runs/` is gitignored (generated reports, status, local SQLite fallback).

## Deployment

- Push to `main` deploys production automatically (`compose.prod.yml`, Caddy, https://ai-pipetka.fun) via `.github/workflows/deploy.yml`. Treat `main` as production; do not push unless asked.
- Local stack: `compose.yml` (runserver + Vite hot reload). Production images are built from the Dockerfiles; `compose.prod.yml` is the source of truth for prod env.
