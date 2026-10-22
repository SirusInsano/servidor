#!/usr/bin/env bash
# =========================================================
#  Publicar no Cloudflare (plano gratuito, sem cartao)
#
#  Uso:  bash deploy/publicar.sh
#
#  Cria (ou reusa) a conta, faz login e publica.
#  A URL final e' permanente enquanto a conta existir.
# =========================================================
set -euo pipefail

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
erro() { printf '\033[31mERRO:\033[0m %s\n' "$*" >&2; exit 1; }

cd "$(dirname "$0")/.."

command -v npx >/dev/null 2>&1 || erro "precisa do Node.js instalado"

log "instalando/atualizando o wrangler"
npm install -g wrangler >/dev/null 2>&1 || true

log "verificando login"
if ! npx wrangler whoami >/dev/null 2>&1; then
    echo
    echo "  Vai abrir o navegador para voce autorizar o Cloudflare."
    echo "  (A conta e' gratuita e nao pede cartao de credito.)"
    echo
    npx wrangler login || erro "login nao concluido"
fi

log "publicando"
npx wrangler deploy || erro "falha no deploy"

echo
echo "========================================================="
echo "  Publicado. A URL aparece acima, no formato:"
echo "    https://animeworld.<seu-usuario>.workers.dev"
echo
echo "  Para um dominio proprio:"
echo "    npx wrangler deploy --route animeworld.seudominio.com"
echo
echo "  Comandos uteis:"
echo "    npx wrangler tail              # logs ao vivo"
echo "    npx wrangler deployments list  # historico"
echo "    npx wrangler rollback          # volta a versao anterior"
echo
echo "  IMPORTANTE: se voce mudar o parser em worker.js, incremente"
echo "  VERSAO_CACHE lá em cima, senao a edge serve a resposta"
echo "  antiga por 10 minutos."
echo "========================================================="
