FROM node:20-slim

# Install Ghostscript (PDF compression engine)
RUN apt-get update && apt-get install -y \
    ghostscript \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (cached layer)
COPY package*.json ./
RUN npm install --omit=dev

# Copy source code
COPY . .

# Data directory for SQLite (overridden by Railway volume at /data)
RUN mkdir -p /data

EXPOSE 3487

CMD ["node", "server-simple.js"]
