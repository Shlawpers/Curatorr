# Curatorr

A web app for scheduling Plex Home collection layouts. Create scheduled layouts for specific date ranges - perfect for featuring horror collections in October, holiday movies in December, or Oscar nominees during awards season.

![Curatorr Overview](docs/screenshots/main-overview.png)

## Features

- **Scheduled Layouts** - Save a complete home layout and schedule it for a date range
- **Promotions** - Boost specific collections to the top without changing your entire layout
- **Repeat Yearly** - Schedules automatically repeat every year (set it and forget it)
- **Drag and Drop** - Reorder collections visually
- **Collection Pool** - Pull any plex or kometa collection into your home hub's scheduled layout (even kometa collections that aren't currently active in plex)
- **Visibility Toggles** - Control Home, Shared Home, and Friends visibility separately
- **Preview Mode** - Time-travel to see what your home will look like at any date
- **Kometa Integration** - Detects schedule conflicts and can auto-fix them
- **Dry-run Mode** - Preview changes without touching Plex (enabled by default)
- **Snapshots & Rollback** - One-click restore if something goes wrong

## Quick Start

You'll need Docker and your Plex token ([how to find it](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)).

```bash
git clone https://github.com/Shlawpers/Curatorr.git
cd Curatorr
cp .env.example .env
# Edit .env with your PLEX_URL and PLEX_TOKEN
docker compose up -d
# Open http://localhost:3000
```

## Configuration

Edit your `.env` file:

| Variable | Required | Description |
|----------|----------|-------------|
| `PLEX_URL` | Yes | Your Plex server URL |
| `PLEX_TOKEN` | Yes | Your Plex auth token |
| `APPLY_MODE` | No | `dry-run` (default) or `apply` |
| `TZ` | No | Your timezone, e.g. `America/New_York` |

See [GUIDE.md](GUIDE.md) for additional options including password authentication and Kometa integration.

## Known Issues

- Plex's hub reorder API can be flaky - the app retries automatically and confirms state change, which has worked well in testing.
- Visibility changes may not work on older Plex versions, I'm running latest stable PMS.
- Kometa-only collections won't appear in plex until Kometa creates them, this app can only change their scheduled dates with the assumption kometa will run. Missing collections are handled gracefully. 

## Documentation

- **[User Guide](GUIDE.md)** - Detailed usage instructions, tips, and troubleshooting

## Acknowledgments

- Hub reordering recovery pattern inspired by [Agregarr](https://github.com/agregarr/agregarr) - their solution to Plex's float precision convergence issue saved significant debugging time

## License

MIT
