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

Backend details (NASA data ingestion, illumination and Earth-visibility analysis): see [api/README.md](api/README.md).

See [AGENTS.md](AGENTS.md) for conventions, commands, and ownership.

## License

[MIT](LICENSE)
