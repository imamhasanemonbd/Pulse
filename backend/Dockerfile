FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci --workspace=backend
COPY backend/ ./backend/
WORKDIR /app/backend
RUN npx prisma generate

FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend ./backend
WORKDIR /app/backend
RUN npx prisma generate

# Install python3 and yt-dlp for audio extraction fallback
RUN apt-get update && apt-get install -y python3 curl && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

EXPOSE 3000
CMD ["sh", "-c", "npx prisma db push && node src/server.js"]
