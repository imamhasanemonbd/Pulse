FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci --workspace=backend
COPY backend/ ./backend/
WORKDIR /app/backend
RUN npx prisma generate

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend ./backend
WORKDIR /app/backend
RUN npx prisma generate
EXPOSE 3000
CMD ["sh", "-c", "npx prisma db push && node src/server.js"]
