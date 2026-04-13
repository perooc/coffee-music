# Setup Guide

## Prerequisites

- Node.js 20+
- Docker (for PostgreSQL)
- npm

## Quick Start

### 1. Clone and install
```bash
git clone https://github.com/perooc/coffee-music.git
cd coffee-music
npm install
```

### 2. Start PostgreSQL
```bash
docker run -d --name coffee-pg -p 5433:5432 \
  -e POSTGRES_DB=coffee_bar \
  -e POSTGRES_USER=coffee_user \
  -e POSTGRES_PASSWORD=coffee_password \
  postgres:16
```

### 3. Configure backend
```bash
echo "DATABASE_URL=postgresql://coffee_user:coffee_password@localhost:5433/coffee_bar" > apps/backend/.env
```

### 4. Run migrations and seed
```bash
cd apps/backend
npx prisma generate --schema prisma/schema.prisma
npx prisma migrate deploy --schema prisma/schema.prisma

# Seed initial data (4 tables, 4 products)
# Set DATABASE_URL in shell since seed doesn't load .env
$env:DATABASE_URL="postgresql://coffee_user:coffee_password@localhost:5433/coffee_bar"
npx tsx prisma/seed.ts
```

### 5. Configure frontend
```bash
# apps/frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:3001/api
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
```

### 6. Run
```bash
# Terminal 1 — Backend (from apps/backend)
npm run dev

# Terminal 2 — Frontend (from root)
npm run dev --workspace apps/frontend
```

### 7. Open
- Frontend: http://localhost:3000/mesa/1
- Admin: http://localhost:3000/admin
- API: http://localhost:3001/api/health

## Project Structure

```
coffee-bar-system/
├── apps/
│   ├── frontend/    # Next.js 16 + Zustand + Socket.IO client
│   └── backend/     # NestJS + Prisma + Socket.IO server
├── packages/
│   └── shared/      # Shared types and constants
├── docs/            # API contract, socket events, rules
└── package.json     # npm workspaces root
```
