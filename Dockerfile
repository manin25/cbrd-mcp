FROM node:22-slim

# Install Chromium dependencies and Playwright's bundled Chromium
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all dependencies (including dev for build)
COPY package*.json ./
RUN npm ci

# Install Playwright Chromium browser binary
RUN npx playwright install chromium

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Remove dev dependencies
RUN npm prune --omit=dev

EXPOSE 8080

# Use local Chromium instead of Lightpanda CDP
ENV CBRD_USE_CHROMIUM=true

CMD ["node", "dist/index.js"]
