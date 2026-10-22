#!/usr/bin/env bash
# =========================================================
#  AnimeWorld - instalador no servidor (roda COMO ROOT)
#
#  Uso:
#    sudo bash instalar.sh seu-dominio.com
#
#  O que faz:
#    1. instala Node.js 22 (se faltar)
#    2. cria o usuario de sistema 'animeworld'
#    3. instala o app em /opt/animeworld
#    4. registra o servico no systemd
#    5. instala o Caddy e configura HTTPS automatico
# =========================================================
set -euo pipefail

DOMINIO="${1:-}"
APP_DIR="/opt/animeworld"
USUARIO="animeworld"
PORTA="3000"

if [ -z "$DOMINIO" ]; then
    echo "Uso: sudo bash instalar.sh seu-dominio.com" >&2
    exit 1
fi

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
erro() { printf '\033[31mERRO:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || erro "rode como root (sudo)"

# ---------------------------------------------------------
log "1/5  Node.js"
if command -v node >/dev/null 2>&1 && [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -ge 18 ]; then
    echo "    ja instalado: $(node -v)"
else
    echo "    instalando Node 22..."
    apt-get update -qq
    apt-get install -y -qq curl ca-certificates gnupg >/dev/null
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
    echo "    instalado: $(node -v)"
fi

# ---------------------------------------------------------
log "2/5  usuario de sistema"
if ! id "$USUARIO" >/dev/null 2>&1; then
    useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$USUARIO"
    echo "    criado: $USUARIO"
else
    echo "    ja existe: $USUARIO"
fi

# ---------------------------------------------------------
log "3/5  arquivos em $APP_DIR"
mkdir -p "$APP_DIR"
# o script roda de dentro da pasta enviada
for item in server.js package.json index.html style.css script.js leitor.html reader.css reader.js README.md imagens; do
    if [ -e "$item" ]; then
        cp -r "$item" "$APP_DIR/"
    else
        echo "    AVISO: $item nao encontrado, pulando"
    fi
done
chown -R "$USUARIO:$USUARIO" "$APP_DIR"
echo "    ok"

# ---------------------------------------------------------
log "4/5  servico systemd"
cp "$(dirname "$0")/animeworld.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable animeworld >/dev/null
systemctl restart animeworld
sleep 2
if systemctl is-active --quiet animeworld; then
    echo "    animeworld: ativo"
else
    echo "    animeworld: FALHOU, log:"
    journalctl -u animeworld -n 20 --no-pager || true
    exit 1
fi

# ---------------------------------------------------------
log "5/5  Caddy (HTTPS automatico)"
if ! command -v caddy >/dev/null 2>&1; then
    echo "    instalando Caddy..."
    apt-get install -y -qq debian-keyring debian-archive-rings >/dev/null
    curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" \
        | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
    curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" \
        > /etc/apt/sources.list.d/caddy-stable.list || true
    apt-get update -qq
    if ! apt-get install -y -qq caddy >/dev/null; then
        echo "    AVISO: nao foi possivel instalar o Caddy automaticamente."
        echo "    O app esta rodando em http://SEU_IP:$PORTA"
        echo "    Instale o Caddy manualmente ou use Nginx como proxy."
        exit 0
    fi
fi
sed "s/SEUDOMINIO.com/$DOMINIO/g" "$(dirname "$0")/Caddyfile" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy
echo "    caddy configurado para $DOMINIO"

# ---------------------------------------------------------
echo
echo "========================================================="
echo "  Pronto. O site deberia estar em https://$DOMINIO"
echo
echo "  Comandos uteis:"
echo "    systemctl status animeworld     # ver o servico"
echo "    journalctl -u animeworld -f     # logs ao vivo"
echo "    systemctl restart animeworld    # reiniciar"
echo "    caddy reload                    # recarregar o proxy"
echo "========================================================="
