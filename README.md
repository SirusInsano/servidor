# DragonToons

Catálogo de animes, mangás e manhwas com leitor, contas, comentários e histórico. A interface foi remodelada com arte de Rimuru e Veldora e uma paleta azul gelo inspirada no universo de **Tensei Shitara Slime**.

## Desenvolvimento

O projeto está em `Teste/`. Use **Node.js 24**, que fornece `node:sqlite` e WebCrypto usados pelo backend local.

```bash
cd Teste
npm ci --cache /tmp/dragontoons-npm-cache --no-audit --no-fund
NODE_USE_ENV_PROXY=1 npm run dev
```

A porta padrão é 8787. `PORT` e `HOST` permitem alterá-la e escolher a interface. No ambiente de nuvem, `NODE_USE_ENV_PROXY=1` faz o Node usar o proxy configurado pela plataforma para as fontes externas.

O banco SQLite de desenvolvimento é criado automaticamente em `Teste/.dados/dragontoons.db`; seu schema está em `Teste/schema.sql`.

Valide a API local com `GET /api/health` (esperado: `ok: true`). A página inicial está em `/` e o catálogo/leitor em `/leitor.html`. As instruções originais do backend e Cloudflare estão em [Teste/README.md](Teste/README.md).

## Interface

- `Teste/index.html`, `style.css` e `script.js`: página inicial, busca e navegação.
- `Teste/leitor.html` e `reader.css`: catálogo e aparência do leitor. `reader.js` mantém a lógica original.
- `Teste/imagens/tempest-hero.png`: nova arte de Rimuru, Veldora e Tempest.
- `Teste/fontes/`: fontes DM Sans e Barlow Condensed hospedadas localmente, com suas licenças OFL.

O código foi extraído de `Teste.rar`, preservado no repositório. Dependências, caches e o banco local que estavam dentro do arquivo compactado não foram copiados para a árvore de desenvolvimento.

## Serviços externos

O catálogo padrão consulta `api.vegitoons.black` pelo navegador e `loobyt.org` pelo backend. Esses domínios precisam de acesso de rede no ambiente. Capas, páginas e fontes adicionais podem usar outros destinos fornecidos pelos serviços. A saúde da API local não comprova a disponibilidade dessas fontes.

## Validação realizada

A instalação pelo lockfile e os fluxos locais de autenticação, comentários e histórico foram verificados. No Chromium, a navegação, busca encaminhada ao leitor, filtros, modais e layouts entre 320 e 1440 px foram conferidos, sem erros JavaScript ou rolagem horizontal.

A consulta real ao catálogo externo ficou bloqueada pela política de rede do ambiente. A publicação no Cloudflare não faz parte da validação local; o site publicado continua sendo uma implantação separada.
