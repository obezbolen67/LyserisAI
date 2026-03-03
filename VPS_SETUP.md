# VPS Setup (Ubuntu 24.04)

## 1) Database (PostgreSQL on VPS)

- Install PostgreSQL 16 and enable the service.
- Create a database and user.
- Apply schema:
  - `psql -U postgres -d lyseris -f LyserisAIBackend/db/schema.sql`
- Allow registrations:
  - `psql -U postgres -d lyseris -c "INSERT INTO whitelist (email) VALUES ('*') ON CONFLICT DO NOTHING;"`
- Set backend env:
  - `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/lyseris`

If you want to place Postgres data on a mounted drive:
- Mount your drive at `/media/yourdrive`
- Move the data directory to `/media/yourdrive/postgres`
- Update PostgreSQL to use that data directory and restart the service

## 2) File Storage (Local Disk)

- Create a storage directory:
  - `/var/lib/lyseris/storage`
- Set backend env:
  - `FILE_STORAGE_PATH=/var/lib/lyseris/storage`
- Set sandbox env:
  - `FILE_STORAGE_PATH=/var/lib/lyseris/storage`

If you want storage on a mounted drive:
- Create `/media/yourdrive/lyseris/storage`
- Set `FILE_STORAGE_PATH=/media/yourdrive/lyseris/storage` for backend and sandbox
- Ensure the backend and sandbox users can read/write that path

## 3) Backend

- Install dependencies:
  - `npm ci`
- Start:
  - `npm run dev`
- If you want the default provider to work without user API keys:
  - `DEFAULT_PROVIDER_TOKEN=`
  - `DEFAULT_PROVIDER_BASE_URL=`
  - `DEFAULT_PROVIDER_MODEL=`

## 4) Sandbox (Jupyter code runner)

- Install dependencies:
  - `pip install -r requirements.txt`
- Start:
  - `python runner.py`
- Ensure `CODE_RUNNER_SECRET` matches the backend.

## 5) Frontend

- Set API URL to backend (example):
  - `VITE_API_URL=http://your-vps-domain:3001`
- Install dependencies:
  - `npm ci`
- Start:
  - `npm run dev`

## 6) Production basics

- Run backend and sandbox with a process manager.
- Put a reverse proxy in front of the backend and frontend.
- Open ports 80/443 only, keep 3001/5001 internal.
