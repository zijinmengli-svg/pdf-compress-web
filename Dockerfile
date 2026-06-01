FROM node:20-slim

# 从源码编译 Ghostscript 10.03.1（PDF 压缩引擎）。
# 为什么不用 apt 的 ghostscript：Debian Bookworm 自带 gs 10.0.0 有 bug——它无视 pdfwrite 的自定义
# QFactor（setdistillerparams），把任何画质都压成固定默认值(~11MB)，导致"贴目标的最高清"完全失效。
# gs 10.03.1（本地已验证）能正确响应画质旋钮。本编译层独立缓存：仅首次部署较慢，之后代码变更不重编。
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential wget ca-certificates \
 && wget -q "https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10031/ghostscript-10.03.1.tar.gz" -O /tmp/gs.tar.gz \
 && tar xzf /tmp/gs.tar.gz -C /tmp \
 && cd /tmp/ghostscript-10.03.1 \
 && ./configure --prefix=/usr/local --without-x --disable-cups \
 && make -j"$(nproc)" \
 && make install \
 && cd / && rm -rf /tmp/ghostscript-10.03.1 /tmp/gs.tar.gz \
 && rm -rf /var/lib/apt/lists/* \
 && /usr/local/bin/gs --version

WORKDIR /app

# 依赖层（单独缓存，代码变更不重新安装）
COPY package*.json ./
RUN npm install --omit=dev

# 源码
COPY . .

RUN mkdir -p /data

EXPOSE 3487

CMD ["node", "server-simple.js"]
