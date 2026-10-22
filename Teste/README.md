# Anime &amp; Manhwa World

Site de catálogo de animes/mangás com leitor integrado.

## No ar

**https://animeworld.animeworldbr.workers.dev**

(Workers, plano gratuito. Para republicar: 
px wrangler deploy.)

## Como rodar

```bash
node server.js          # porta 8787
```

Abre em <http://127.0.0.1:8787>.

O `server.js` faz duas coisas:
1. serve o site estático (`index.html`, `leitor.html`, CSS/JS, imagens);
2. expõe a API de anime (`/api/...`), porque as fontes externas não liberam CORS.

Só o módulo de **manhwa/mangá** funciona sem o servidor — ele fala direto com a
API da fonte pelo navegador. O módulo de **anime** precisa do `server.js` rodando.

### Variáveis de ambiente

| Variável | Padrão | O que faz |
|---|---|---|
| `PORT` | `8787` | porta HTTP |
| `HOST` | `0.0.0.0` | interface de escuta (em produção, `127.0.0.1` atrás do proxy) |

Endpoints úteis: `GET /api/health` (status), `GET /api/fontes` (fontes + estado).

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` / `style.css` | site principal (catálogo, hero, cards) |
| `script.js` | menu mobile, ano do rodapé, busca da tela inicial |
| `leitor.html` / `reader.css` / `reader.js` | leitor (busca, capítulos, páginas) |
| `server.js` | servidor Node: site estático + API de anime |
| `worker.js` | a mesma API como Cloudflare Worker (deploy grátis) |
| `wrangler.toml` / `_headers` / `.assetsignore` | config do projeto Workers |
| `imagens/` | capas e banner |

## Endpoints do backend

| Rota | O que devolve |
|---|---|
| `GET /api/health` | status do serviço |
| `GET /api/fontes` | fontes de anime + estado (online/offline) |
| `GET /api/anime/busca?q=&fonte=` | catálogo unificado de animes |
| `GET /api/anime/:fonte/:slug/episodios` | episódios de um anime |
| `GET /api/anime/player?url=` | extrai o player (iframe) de uma página de episódio |

## Busca e filtros

A **tela inicial** (`index.html`) é a porta de entrada: logo abaixo do hero tem a
barra de busca e os chips de tipo. Escolher um tipo ou digitar um nome leva para
o leitor com o filtro já aplicado (`leitor.html?busca=...&tipo=...`).

Uma linha só de **Tipo**, igual nas duas telas:

`Tudo` · `Manhwa` · `Manhua` · `Manga` · `Anime` · `Novel` · `Hentai 18+`

- **Tudo** — catálogo geral (gênero "Livres" por padrão)
- **Hentai 18+** — exige confirmação de idade (uma vez por navegador) e abre
  três subtipos: **Hentai Anime** (Hydra Hentai), **Hentai Manhwa** e
  **Hentai Manga** (one-shots com a tag "Adulto").
- **Filtros avançados** (recolhido, só no leitor) — 34 gêneros no padrão de
  <https://meusanimes.blog/genero/> (Ação, Aventura, Romance, Isekai, Terror...),
  mapeados para as tags da fonte via `tag_ids`. Seleção única: clicar de novo desmarca.

Conteúdo adulto fica **fora** do padrão: só aparece se você escolher o filtro
Hentai explicitamente.

### Modo adulto (tema vermelho)

- Clicar em **Hentai 18+** abre a verificação de idade (uma vez por navegador).
- Com o filtro Hentai ativo, a paleta inteira do site passa do ciano para o
  vermelho (`--accent-color` vira `#ff4d4d` em `html.tema-adulto`), com
  transição suave. Ao trocar para outro tipo, volta ao ciano.
- A confirmação de idade fica salva, mas **não** mantém o vermelho: o vermelho
  só aparece enquanto o filtro Hentai estiver selecionado.

## Publicar (de graça)

O site inteiro roda no **Cloudflare Workers**, no plano gratuito:
sem cartão de crédito, sem comprar domínio.

- Assets estáticos: **ilimitados** (o site + o leitor de manhwa inteiro)
- API de anime: 100.000 requisições/dia (só o que roda código conta)
- Subdomínio `*.workers.dev` de graça

### Publicar

```bash
npm install -g wrangler
wrangler login          # abre o navegador, autorize
wrangler deploy
```

Ou o script:

```bash
bash deploy/publicar.sh
```

O `wrangler.toml` já está configurado: os assets estáticos vão no mesmo
projeto do Worker, e `run_worker_first = ["/api/*"]` faz só as rotas de API
passarem pelo Worker. Um domínio só, sem CORS.

### Estrutura de deploy

| Arquivo | Para que serve |
|---|---|
| `worker.js` | a API de anime como Worker (substitui o `server.js` no deploy) |
| `wrangler.toml` | config do projeto (assets + bindings + nodejs_compat) |
| `_headers` | cabeçalhos de segurança dos assets estáticos |
| `.assetsignore` | o que não sobe (cache local, deploy, fontes) |
| `deploy/publicar.sh` | atalho do `wrangler deploy` |
| `server.js` | servidor Node local (dev e VPS) |
| `Dockerfile` / `docker-compose.yml` | alternativa com Docker, se quiser um VPS |
| `deploy/instalar.sh` | instalador completo em VPS (Node + systemd + Caddy) |

### Notas do plano gratuito

- `nodejs_compat` é obrigatório: o desafio de cookie AES das fontes usa
  AES-CBC sem padding, e o WebCrypto recusa isso (o `node:crypto` aceita).
- Custo de CPU medido: **~0,8 ms por request** (o limite é 10 ms).
- O cache da edge (`caches.default`) faz o cache hit não executar o Worker:
  a 2ª chamada do mesmo search caiu de 1059 ms para 23 ms.
- A URL `*.workers.dev` de conta temporária expira. Para uma URL definitiva,
  crie uma conta no Cloudflare (grátis) e faça `wrangler deploy` logado.

### Alternativa com VPS

Se algum dia quiser um servidor próprio (IP fixo, sem limite de requisições),
o `deploy/instalar.sh` sobe Node 22 + systemd + Caddy com HTTPS automático.
O `server.js` local é o mesmo backend, só que como processo Node.

## Contas, comentários e histórico

Tudo no **Cloudflare D1** (SQLite no edge, plano gratuito).

### Cadastro e login

- Botão **Entrar** no topo do leitor → modal com login e cadastro
- Senha guardada com **PBKDF2-SHA256** (100.000 iterações, salt de 16 bytes)
- Sessão em cookie **HttpOnly / SameSite=Lax**, 30 dias
- Token guardado no banco (tabela `sessions`), nunca no navegador

### Comentários

- Uma conversa por obra, com autor e data
- Cada usuário apaga só o próprio comentário
- Para comentar é preciso estar logado

### Histórico

- Grava automaticamente o que você abre (obra, capítulo, página, progresso)
- Seção **"Continuar de onde parei"** na tela de busca, com barra de progresso
- Dá para remover itens do histórico

### Endpoints

| Rota | O que faz |
|---|---|
| `POST /api/auth/registrar` | cria conta e loga |
| `POST /api/auth/login` / `logout` | entra / sai |
| `GET /api/auth/eu` | dados do usuário logado |
| `GET/POST /api/comments` | lista / cria comentário (`work_id`) |
| `DELETE /api/comments/:id` | apaga o próprio |
| `GET/POST /api/history` | lista / grava progresso |
| `DELETE /api/history/:workId` | remove do histórico |

### Banco

O schema está em `schema.sql` e é aplicado nos dois ambientes:

```bash
# local (criado sozinho no 1º start)
# Cloudflare
wrangler d1 execute animeworld --remote --file=schema.sql
```

## Segurança

O que já foi blindado (e o que não depende de mim):

| Risco | Como foi tratado |
|---|---|
| **SSRF** (proxy aberto / metadados da nuvem) | `/api/anime/player` só busca hosts de uma **allowlist**; redes privadas e link-local são bloqueados explicitamente |
| **XSS** | todo conteúdo remoto entra por `textContent`; a CSP trava `script-src` em `'self'` (não há script inline) |
| **Path traversal** | o servidor Node normaliza o caminho e exige que fique dentro da raiz; arquivos-fonte têm denylist |
| **Divulgação de código-fonte** | `server.js`, `worker.js`, `package.json`, `wrangler.toml` e pastas com ponto não são servidos |
| **Clickjacking** | `X-Frame-Options: SAMEORIGIN` + `frame-ancestors 'self'` |
| **Fingerprinting / recursos** | `Permissions-Policy` desliga geolocalização, microfone, câmera e pagamento |
| **Downgrade de conexão** | HSTS com 1 ano + `includeSubDomains` |
| **MIME sniffing** | `X-Content-Type-Options: nosniff` + `base-uri 'none'` + `object-src 'none'` |
| **Cache envenenado** | código revalida sempre (`no-cache`); imagens ficam 7 dias |

### O que NÃO depende do código

- **Cota do plano grátis**: 100.000 requisições/dia no Worker. Alguém pode queimar
  isso de propósito. A defesa é a **Cloudflare WAF** (o plano grátis tem algumas
  regras): criar uma regra de *rate limiting* em `/api/*` e uma de *block* para
  IPs de bot conhecidos.
- **DNS / domínio**: a URL `*.workers.dev` de conta temporária expira e tem um
  nome aleatório. Com conta própria dá para usar um domínio próprio.
- **Conteúdo das fontes**: são sites de terceiros, fora do meu alcance. Quando um
  cai, o `GET /api/fontes` mostra o estado.
- **Ataques ao reader (client-side)**: não há login nem dado sensível no
  navegador. A verificação de idade é só uma barreira de interface (fácil de
  burlar de propósito) — não é controle de segurança.

## Fontes

**Manhwa/mangá** — API do Vegitoons (`api.vegitoons.black`), consumida direto
pelo navegador. Tem CORS liberado, então não precisa de backend.

**Anime** — agregadas no backend com failover automático:

| Fonte | Observação |
|---|---|
| animesonlinecc.to | links de episódio estáticos |
| animesdigital.org | listagem na raiz |
| meusanimes.blog | rota `/a/` |
| assistiranimesonline.net | ~1180 episódios em One Piece |
| hydraani.free.nf | desafio de cookie AES (resolvido no servidor) |

## Notas técnicas

- O vídeo nunca passa pelo seu servidor: o player da fonte é embutido em
  `<iframe>`.
- O backend resolve o desafio AES dos sites "hydra" (modo **CBC**,
  `aes-128-cbc`) e guarda o cookie por host.
- Cache em memória de 10 min (listagens) e 30 min (episódios), mais o cache da
  edge no deploy em Workers.
- Lighthouse 100/100/100 em `index.html` e `leitor.html`.
