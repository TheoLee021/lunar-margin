# Lunar Margin

A mission decision tool for comparing and evaluating landing sites and landing times near the lunar south pole.

## NASA data

The analysis is computed from two NASA datasets (about 269 MB, downloaded by `cd api && uv run python -m lunar_margin.pipeline.fetch`, never committed to git):

- **Terrain**: LRO LOLA south-pole DEM (`ldem_80s_80m_float`, 80 m/px, 80°S–90°S) from PDS Geosciences. Used to compute the terrain horizon seen from a site.
- **Sun and Earth positions**: NAIF SPICE kernels (DE440s ephemeris, lunar orientation and frame kernels, leap seconds) from NASA JPL. Used to compute where the Sun and Earth are in the lunar sky over time.

A body counts as visible when its elevation is above the terrain horizon in its direction. Sources, versions, and file list: [docs/data.md](docs/data.md) and [api/README.md](api/README.md).

## Quick start

```sh
# Backend (Docker)
docker compose up --build

# Backend (local development, Python 3.14 + uv)
cd api
uv sync
cp .env.example .env
uv run fastapi dev src/lunar_margin/app/main.py

# Frontend (Node 24)
cd web
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:5173.

Backend details (NASA data ingestion, illumination and Earth-visibility analysis): see [api/README.md](api/README.md).

See [AGENTS.md](AGENTS.md) for conventions, commands, and ownership.

## License

[MIT](LICENSE)
