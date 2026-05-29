FROM node:20-slim

# 安装 Ghostscript（PDF 压缩引擎）
RUN apt-get update && apt-get install -y --no-install-recommends \
    ghostscript \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依赖层（单独缓存，代码变更不重新安装）
COPY package*.json ./
RUN npm install --omit=dev

# 源码
COPY . .

RUN mkdir -p /data

EXPOSE 3487

CMD ["node", "server-simple.js"]
