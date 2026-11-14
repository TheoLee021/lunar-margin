# Lunar Margin

A mission decision tool for comparing and evaluating landing sites and landing times near the lunar south pole.

## Quick start

```sh
# Backend
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
