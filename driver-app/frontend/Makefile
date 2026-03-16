.PHONY: help install dev dev-client dev-server build start db-generate db-push db-migrate db-studio clean

# Install dependencies
install:
	bun install
	bun prisma generate
	bun prisma migrate deploy --config prisma/prisma.config.ts

# Development
dev:
	bun run dev

dev-client:
	bun run dev:client

dev-server:
	bun run dev:server

# Build
build:
	bun run build

# Production
start:
	bun run start

# Database commands
db-generate:
	bunx prisma generate

db-push:
	bunx prisma db push

db-migrate:
	bunx prisma migrate dev --config prisma/prisma.config.ts

db-studio:
	bunx prisma studio

# Cleanup
clean:
	rm -rf node_modules
	rm -rf dist
	rm -rf .vite

up:
	pm2 start pm2.config.cjs

down:
	pm2 delete pm2.config.cjs

restart:
	pm2 delete pm2.config.cjs
	pm2 start pm2.config.cjs
