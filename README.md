# shloka-backend

Node/Express/TypeScript backend for the Shloka Sutra app.

## Stack

- Express 4, TypeScript 5, Mongoose 8
- MongoDB Atlas (M0 free tier)
- JWT in httpOnly cookie
- Vitest + supertest + mongodb-memory-server

## Local Development

```bash
cp .env.example .env       # fill in MONGO_URI, JWT_SECRET, etc.
npm install
npm run dev                # starts on http://localhost:4000
```

A local MongoDB is required (or point MONGO_URI at Atlas).

## Tests

```bash
npm test                   # vitest run
npm run test:watch
```

Tests use `mongodb-memory-server` — no external DB needed.

## Seeding the First Admin

After env vars are set:

```bash
npm run seed:admin
```

Idempotent. Reads `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` from `.env`.

## Deployment (Render)

1. Push this repo to GitHub.
2. In Render, "New +" → "Blueprint" and point to this repo. It picks up `render.yaml`.
3. Set the secret env vars in the Render dashboard:
   - `MONGO_URI` (from MongoDB Atlas — make sure Atlas IP allowlist includes `0.0.0.0/0` since Render free tier has no static outbound IPs)
   - `JWT_SECRET` (random 32+ char string)
   - `FRONTEND_ORIGIN` (your deployed frontend URL, comma-separate to allow more than one)
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`
4. Deploy. Health check at `/api/health` should pass.
5. Once up, run `npm run seed:admin` via Render's shell to create the first admin.

Free tier sleeps after 15 min idle — first request after sleep takes ~30s.

## API Surface (v1)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /api/auth/signup | none | creates student |
| POST | /api/auth/login | none | sets sht_session cookie |
| POST | /api/auth/logout | any | clears cookie |
| GET  | /api/auth/me | required | returns current user |
| GET  | /api/health | none | uptime + mongo state |
