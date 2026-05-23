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

## Cloudinary Setup

Audio and image uploads go to Cloudinary.

1. Sign up at https://cloudinary.com (free tier: 25 GB storage + 25 GB monthly bandwidth).
2. From your Cloudinary dashboard, copy: **Cloud Name**, **API Key**, **API Secret**.
3. Add to `.env` locally:
   ```
   CLOUDINARY_CLOUD_NAME=your-cloud-name
   CLOUDINARY_API_KEY=your-api-key
   CLOUDINARY_API_SECRET=your-api-secret
   ```
4. In Render, set the same three vars in the dashboard (they are declared `sync: false` in `render.yaml`).

## API Surface (v2)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /api/auth/signup | none | creates student |
| POST | /api/auth/login | none | sets sht_session cookie |
| POST | /api/auth/logout | required | clears cookie |
| GET  | /api/auth/me | required | returns current user |
| GET  | /api/health | none | uptime + mongo state |
| GET  | /api/shlokas | required | list published, cursor pagination |
| GET  | /api/shlokas/:slug | required | published only; 404 on drafts |
| GET  | /api/admin/shlokas | admin | list incl. drafts; ?status=draft\|published\|all |
| GET  | /api/admin/shlokas/:id | admin | by id |
| POST | /api/admin/shlokas | admin | create (defaults status=draft) |
| PATCH | /api/admin/shlokas/:id | admin | partial update |
| DELETE | /api/admin/shlokas/:id | admin | hard delete + Cloudinary cleanup |
| POST | /api/admin/uploads/audio | admin | multipart `file`, mp3/wav, ≤20MB |
| POST | /api/admin/uploads/image | admin | multipart `file`, jpg/png/webp, ≤5MB |
