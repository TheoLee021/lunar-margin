# Lunar Margin

A mission decision tool for comparing and evaluating landing sites and landing times near the lunar south pole.

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

See [AGENTS.md](AGENTS.md) for conventions, commands, and ownership.

## License

[MIT](LICENSE)

## Lunar viewer preview

The React HUD uses explicitly labeled example candidates and mission metrics. These are UI fixtures, not computed recommendations. `MissionSelection` is the shared map/panel selection; the Cesium viewer and camera stay outside React state and are destroyed on unmount.

Set `VITE_CESIUM_ION_TOKEN` in `web/.env.local` and add Cesium Moon (ion asset 2684829) to the token's account. Without a token, the app reports the missing configuration and keeps the basic Moon surface and example candidates usable. Workers and assets are copied from the installed Cesium package by `postinstall`; generated files are ignored by Git. No DEM, SPICE kernels, or terrain grids are bundled.

For local checks while another project occupies port 5173, use `E2E_BASE_URL=http://localhost:5174 API_PROXY_TARGET=http://localhost:8001 npm run e2e` from `web/`, with the API running on port 8001.
