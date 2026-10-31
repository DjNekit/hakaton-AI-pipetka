# AGENTS.md

Hackathon MVP «Колорпаспорт»: checks facade-color passports and sign design projects against Moscow regulations, compares facade drawings with photos. Services: Django backend (API, PostgreSQL), processor (PDF/files, Redis queue workers), chat (GigaChat API, TanStack AI), React/Vite frontend; Docker Compose.

## Run and verify

Docker is the supported path (tesseract, OpenCV, Redis, PostgreSQL, GigaChat CA certs live in images):

```bash
cp .env.example .env
docker compose up --build          # UI http://localhost:5173, API http://localhost:8000/api/health
docker compose down
docker compose exec processor python -m colorpass check ../dataset/real/<file>.pdf
docker compose exec processor python -m colorpass eval
docker compose exec processor python -m colorpass eval ../dataset/signs
docker compose exec processor python -m colorpass eval-photos
curl localhost:3000/chat/health    # is GigaChat available
```

Frontend only: `cd frontend && npm ci && npm run dev` (or `npm run build`). There is no lint, typecheck, or test script.

**There is no automated test suite.** README, `docs/project-context.md`, and `dataset/README.md` still mention `backend/tests/*` and `python -m unittest discover` — those tests were removed (commit "Убрать тесты: CI только деплоит"). Do not claim tests pass; verify with the `eval` commands and `/api/health`.

## Architecture boundaries

- `processor/` owns everything file-related: `processor/colorpass` (framework-independent pipeline `ingest -> extract/signage -> checks -> report`, photo comparison, Excel) and `processor/worker` (Redis queue workers in `jobs.py`, package cross-checks in `package.py`, HTTP for files/uploads in `fileserver.py`, `runs/` layout in `storage.py`). Only processor mounts `runs/` and `dataset/`.
- `backend/` (Django) is API + PostgreSQL only: packages, documents (status + report jsonb), findings, decisions, comparisons, LLM texts. It never opens PDFs or images. `backend/api/views.py` -> `backend/core/service.py`; storage in `backend/core/store.py` (raw SQL, auto-created schema; no ORM models, do not run `makemigrations`). Without `DATABASE_URL` it uses an in-memory store (dev only).
- Backend ↔ processor only via Redis (`core/redisq.py` = copy of `processor/worker/redisq.py`; keep both in sync): heavy `check_package` jobs on `cp:jobs`; quick file ops with a reply on `cp:rpc` (`blocks`, `corners`, `compare`, `recalc`, `excel`, `samples`, `rules`, `archive`); results in `cp:result:*` + `cp:ready`, pulled into the DB by `service.sync()` on reads.
- When adding an endpoint: backend `api/urls.py` + `api/views.py` + `core/service.py`; if it needs files, a processor RPC handler in `worker/jobs.py`; update `frontend/src/api.js`.
- Frontend URLs: `/api` → backend, `/files` → processor (uploads, page images, Excel), `/chat` → chat (Caddy in prod, Vite proxy in dev).
- Rules, thresholds, and requirement texts belong in `processor/colorpass/data/rules.yaml`, not in Python or JS.
- The only LLM is GigaChat API, used only from `chat/` (no local models). Chat has no tool calling: check data goes into the system prompt. Code decides pass/fail from rules; models only draft text and describe photos, and chat saves results through backend API. Preserve this invariant.

## Conventions

- Comments, findings, report text, and UI strings are in Russian. Python: PEP 8 + type hints + `from __future__ import annotations`.
- React: functional components, no UI library; styles in `frontend/src/styles.css`.
- API routes have no trailing slash (`APPEND_SLASH = False`).
- Python CLI must be run from `processor/` (it imports top-level `colorpass`); `python -m colorpass` resolves the repo root for `dataset/` and `runs/`.
- `.env` is loaded manually by `envfile.py` (processor/colorpass and backend/core); real environment variables override it.

## Data

- `dataset/real/`: passports + `*.expected.json` + `*.photos.json`; `dataset/signs/`: sign design-project samples. PDFs are committed despite the dataset README claiming otherwise.
- A sample appears in the UI only when both its PDF and matching `*.expected.json` exist. `dataset/` is mounted into the backend container.
- `runs/` is gitignored (generated reports, status, local SQLite fallback).

## Deployment

- Push to `main` deploys production automatically (`compose.prod.yml`, Caddy, https://ai-pipetka.fun) via `.github/workflows/deploy.yml`. Treat `main` as production; do not push unless asked.
- Local stack: `compose.yml` (runserver + Vite hot reload). Production images are built from the Dockerfiles; `compose.prod.yml` is the source of truth for prod env.
