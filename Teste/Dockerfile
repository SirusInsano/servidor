FROM node:22-alpine

#usuario sem privilegios
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app

# nao ha dependencias npm: o servidor usa so a lib padrao do Node
COPY package.json ./
COPY server.js ./
COPY index.html style.css script.js ./
COPY leitor.html reader.css reader.js ./
COPY imagens ./imagens
COPY README.md ./

RUN addgroup -S anime && adduser -S anime -G anime && chown -R anime:anime /app
USER anime

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "server.js"]
