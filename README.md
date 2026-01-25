# Curatorr

A web app for scheduling Plex Home collection layouts. Create "Layout Blocks" - saved configurations of which collections appear on your Plex Home and in what order - and schedule them for specific date ranges.

I built this because I wanted my Halloween collections at the top during October, Christmas stuff in December, etc., without manually rearranging things every time.

## What it does

- **Layout Blocks** - Save a complete home layout (order + visibility) and schedule it for a date range
- **Drag and drop** - Reorder collections visually
- **Visibility toggles** - Control what shows on Home, Shared Home, and Friends separately
- **Kometa conflict warnings** - If you use Kometa, the app warns you when a scheduled collection will be deleted by Kometa during your block's time range
- **Dry-run mode** - Preview changes without touching Plex (enabled by default)
- **Snapshots** - Saves your current state before applying changes, just in case

## Quick Start

You'll need Docker and your Plex token ([how to find it](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)).

```bash
# Clone and configure
git clone https://github.com/Shlawpers/Curatorr.git
cd Curatorr
cp .env.example .env
# Edit .env with your PLEX_URL and PLEX_TOKEN

# Run it
docker compose up -d

# Open http://localhost:3000
```

Or grab just the docker-compose and env files:
```bash
mkdir curatorr && cd curatorr
curl -O https://raw.githubusercontent.com/Shlawpers/Curatorr/main/docker-compose.yaml
curl -O https://raw.githubusercontent.com/Shlawpers/Curatorr/main/.env.example
cp .env.example .env
# Edit .env, then: docker compose up -d
```

## Configuration

Edit your `.env` file:

| Variable | Required | Description |
|----------|----------|-------------|
| `PLEX_URL` | Yes | Your Plex server URL |
| `PLEX_TOKEN` | Yes | Your Plex auth token |
| `APPLY_MODE` | No | `dry-run` (default, read-only) or `apply` (allows changes) |
| `TZ` | No | Your timezone, e.g. `America/New_York` |
| `PORT` | No | Web UI port (default: 3000) |
| `KOMETA_CONFIG_PATH` | No | Path to Kometa config for conflict detection |

### Using with Kometa

If you run Kometa, mount your config folder to enable schedule conflict detection:

```yaml
# In docker-compose.yaml, add this volume:
volumes:
  - plex-scheduler-data:/app/data
  - /path/to/your/kometa/config:/kometa/config:ro
```

The app reads your Kometa YAML files and warns you if you're scheduling a collection during a time when Kometa would delete it.

## How it works

1. Pick a library (Movies, TV Shows, etc.)
2. Create a Layout Block with a name and date range
3. Drag collections into the order you want
4. Toggle visibility for each collection
5. Hit Apply when ready (or stay in dry-run mode to preview)

The app verifies changes actually took effect - Plex's reorder API can be flaky, so it retries if needed.

## Known issues

- Plex's hub reorder endpoint doesn't always work. The app retries automatically, but some Plex versions have persistent issues.
- Visibility changes may not work on older Plex versions.
- Collections that only exist in Kometa (not yet created in Plex) won't show up until Kometa runs.

## Development

If you want to run it locally without Docker:

```bash
# Backend (Python 3.11+)
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # edit with your Plex details
uvicorn main:app --reload --port 5100

# Frontend (Node 20+)
cd frontend
npm install
npm run dev
```

Frontend runs on :3000, backend on :5100.

## Security

There's no built-in auth. Your Plex token lives in the `.env` file.

Keep this on your local network, or put it behind a reverse proxy with authentication (Caddy, Authelia, Traefik, etc.) if you need remote access. Don't expose it directly to the internet.

## License

MIT
