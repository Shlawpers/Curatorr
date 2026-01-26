# Curatorr

A web app for scheduling Plex Home collection layouts. Create "Scheduled Layouts" - saved configurations of which collections appear on your Plex Home and in what order - and schedule them for specific date ranges. Add "Promotions" to temporarily boost specific collections to the top without changing your entire layout.

I built this because I wanted my Halloween collections at the top during October, Christmas stuff in December, etc., without manually rearranging things every time.

## Features

- **Scheduled Layouts** - Save a complete home layout (order + visibility) and schedule it for a date range
- **Promotions** - Temporarily boost specific collections to the top during a date range, without affecting the rest of your layout
- **Repeat Yearly** - Set schedules and promotions to automatically repeat every year (perfect for holidays)
- **Saved Layouts** - Save layout templates and reuse them across different schedules
- **Drag and drop** - Reorder collections visually
- **Visibility toggles** - Control what shows on Home, Shared Home, and Friends separately
- **Preview mode** - Jump to any date/time to see what your home will look like
- **Auto-sync** - Optionally auto-apply scheduled layouts at the right time
- **Kometa conflict warnings** - If you use Kometa, the app warns you when a scheduled collection will be deleted during your block's time range
- **Dry-run mode** - Preview changes without touching Plex (enabled by default)
- **Snapshots & Rollback** - Saves your current state before applying changes, with one-click rollback
- **Optional Password Authentication** - Protect access with a simple password

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

### Authentication (Optional)

To require a password to access the app, add these to your `.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `CURATORR_AUTH_ENABLED` | No | Set to `true` to enable password authentication |
| `CURATORR_AUTH_PASSWORD` | If auth enabled | The password users must enter to access the app |
| `CURATORR_SESSION_SECRET` | No | Secret key for signing session cookies (auto-generated if not set) |

Example:
```bash
CURATORR_AUTH_ENABLED=true
CURATORR_AUTH_PASSWORD=your-secure-password-here
CURATORR_SESSION_SECRET=random-string-for-signing-cookies
```

When auth is enabled, users see a login page and must enter the password. Sessions last 24 hours.

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

### Scheduled Layouts
1. Pick a library (Movies, TV Shows, etc.)
2. Create a Scheduled Layout with a name and date range
3. Drag collections into the order you want
4. Toggle visibility for each collection
5. Enable "Repeat yearly" if it should happen every year
6. Hit Apply when ready (or stay in dry-run mode to preview)

### Promotions
Promotions overlay on top of your current layout (whether that's a scheduled block or your default Plex state):

1. Create a Promotion with a name and date range
2. Add the collections you want boosted to the top
3. Enable "Repeat yearly" for annual events
4. The promotion will temporarily insert those collections at the top during the active period

**Priority Stack:**
```
PROMOTIONS (top layer) - Always applies if active
SCHEDULED LAYOUT      - Replaces default if active
CURRENT PLEX STATE    - Base when no layout active
```

### Preview Mode
Click "Preview" in the top bar to:
- Jump to any date/time to see what your home will look like
- Navigate between schedule boundaries with Next/Previous buttons
- See which layouts and promotions will be active

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

**Built-in authentication:** Enable password protection by setting `CURATORR_AUTH_ENABLED=true` in your `.env` file. This provides simple password-based access control suitable for home networks.

**Network security:** Your Plex token lives in the `.env` file. If you don't enable the built-in auth, anyone who can reach the app can manage your Plex home. Keep it on your local network, or put it behind a reverse proxy with authentication (Caddy, Authelia, Traefik, etc.) if you need more robust access control.

## License

MIT
