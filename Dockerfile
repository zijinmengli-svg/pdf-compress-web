# Stage 1: Compile Swift binaries on Swift-capable image
FROM swift:5.10-jammy AS builder

WORKDIR /build
COPY scripts/ scripts/
RUN mkdir -p .build && \
    swiftc -O -o .build/compress-pdf scripts/compress_pdf.swift && \
    swiftc -O -o .build/rasterize-pdf scripts/rasterize_pdf.swift && \
    swiftc -O -o .build/inspect-pdf scripts/inspect_pdf.swift

# Stage 2: Lightweight Node.js runtime + pre-compiled Swift binaries
FROM node:20-slim

WORKDIR /app

# Install dependencies first (cached layer)
COPY package*.json ./
RUN npm install --omit=dev

# Copy source code
COPY . .

# Copy pre-compiled Swift binaries from builder stage
COPY --from=builder /build/.build .build/

# Ensure binaries are executable
RUN chmod +x .build/compress-pdf .build/rasterize-pdf .build/inspect-pdf

RUN mkdir -p /data

EXPOSE 3487

CMD ["node", "server-simple.js"]
