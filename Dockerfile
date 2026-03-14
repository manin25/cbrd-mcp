FROM node:22-slim

# Install Lightpanda headless browser
RUN apt-get update && \
    apt-get install -y curl ca-certificates && \
    curl -L -o /usr/local/bin/lightpanda \
    https://github.com/lightpanda-io/browser/releases/latest/download/lightpanda-x86_64-linux && \
    chmod +x /usr/local/bin/lightpanda && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all dependencies (including dev for build)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Remove dev dependencies
RUN npm prune --omit=dev

EXPOSE 8080

# Start Lightpanda CDP server in background, then start MCP server
CMD lightpanda serve --host 127.0.0.1 --port 9222 & \
    sleep 2 && \
    node dist/index.js
