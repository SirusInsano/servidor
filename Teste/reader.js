/* =========================================================
   DragonToons — leitor
   Cliente 100% no navegador: as páginas são carregadas
   direto da fonte original (sem passar por este site).
   ========================================================= */
(function () {
    'use strict';

    /* ======================= Configuração ======================= */

    var API = 'https://api.vegitoons.black';
    var SITE = 'https://vegitoons.black';
    // Backend local de anime (server.js). Vazio = mesma origem.
    var API_ANIME = (window.ANIME_API || '') + '/api/anime';
    var WIND_MANGADASH = {
        obr_id: 'mangadash:135-wind-breaker', obr_nome: 'Wind Breaker',
        obr_imagem: '/imagens/wind-mangadash.svg',
        obr_descricao: 'Haruka Sakura chega à Fuurin em busca dos mais fortes.',
        genero: { gen_id: 1, gen_nome: 'Ação' }, formato: { formt_id: 3 },
        mangadash: true, slug: '135-wind-breaker'
    };
    var TIMEOUT = 20000;
    var CHAVE_PROGRESSO = 'dragontoons:progresso';

    // Gêneros dos "Filtros avançados". Lista baseada em
    // https://meusanimes.blog/genero/ e mapeada para as tags da fonte.
    var GENEROS = [
        { id: 1, nome: 'Ação' },
        { id: 22, nome: 'Artes Marciais' },
        { id: 2, nome: 'Aventura' },
        { id: 3, nome: 'Comédia' },
        { id: 35, nome: 'Demônios' },
        { id: 4, nome: 'Drama' },
        { id: 36, nome: 'Ecchi' },
        { id: 26, nome: 'Escolar' },
        { id: 37, nome: 'Esporte' },
        { id: 5, nome: 'Fantasia' },
        { id: 42, nome: 'Ficção Científica' },
        { id: 44, nome: 'Harém' },
        { id: 14, nome: 'Histórico' },
        { id: 46, nome: 'Jogo' },
        { id: 50, nome: 'Magia' },
        { id: 43, nome: 'Guerra' },
        { id: 7, nome: 'Mistério' },
        { id: 8, nome: 'Romance' },
        { id: 17, nome: 'Seinen' },
        { id: 18, nome: 'Shoujo' },
        { id: 19, nome: 'Shounen' },
        { id: 10, nome: 'Slice of Life' },
        { id: 13, nome: 'Sobrenatural' },
        { id: 62, nome: 'Super Poderes' },
        { id: 63, nome: 'Suspense' },
        { id: 6, nome: 'Terror' },
        // Extras que a fonte tem e fazem falta na referencia
        { id: 21, nome: 'Isekai' },
        { id: 15, nome: 'Mecha' },
        { id: 20, nome: 'Josei' },
        { id: 16, nome: 'Psicológico' },
        { id: 12, nome: 'Thriller' },
        { id: 59, nome: 'Regressão' },
        { id: 58, nome: 'Reencarnação' },
        { id: 61, nome: 'Sistema' }
    ];

    // Tag que marca conteudo adulto na fonte
    var TAG_ADULTO = 29;

    function temTagAdulto(obra) {
        var tags = obra.tags || [];
        for (var i = 0; i < tags.length; i++) {
            var t = tags[i];
            var id = (t && typeof t === 'object') ? t.tag_id : t;
            if (Number(id) === TAG_ADULTO) return true;
        }
        return false;
    }

    // Linha "Tipo". 'formato' filtra por formt_id, 'genero' por gen_id,
    // 'anime' consulta o backend local, 'todos' usa o genero escolhido.
    var TIPOS = [
        { id: 0, slug: 'tudo', nome: 'Tudo', tipo: 'todos' },
        { id: 1, slug: 'manhwa', nome: 'Manhwa', tipo: 'formato', formatos: [1] },
        { id: 2, slug: 'manhua', nome: 'Manhua', tipo: 'formato', formatos: [2] },
        { id: 3, slug: 'manga', nome: 'Manga', tipo: 'formato', formatos: [3] },
        { id: 7, slug: 'anime', nome: 'Anime', tipo: 'anime' },
        { id: 4, slug: 'novel', nome: 'Novel', tipo: 'formato', formatos: [4] },
        { id: 5, slug: 'hentai', nome: 'Hentai 18+', tipo: 'genero', adulto: true }
    ];

    // Subtipos que aparecem ao escolher "Hentai 18+"
    var SUBFILTROS = [
        { id: 'manhwa', nome: 'Hentai Manhwa' },
        { id: 'manga', nome: 'Hentai Manga' }
    ];

    // Generos consultados por formato (o filtro de genero e' do servidor).
    // (genero 5 = Hentais, 7 = Yaoi e 16 = Yuri ficam de fora por padrao)
    var GENEROS_POR_FORMATO = {
        1: [1, 8, 18],   // Manhwa
        2: [1, 8, 18],   // Manhua
        3: [8, 1],       // Manga
        7: [1, 8, 18, 4, 6], // Anime
        4: [6, 1]        // Novel
    };

    // Generos nunca exibidos (conteudo adulto)
    var GENEROS_BLOQUEADOS = [5, 7, 16];

    /* ======================= Conta ======================= */

    var usuario = null;

    function apiConta(metodo, caminho, corpo) {
        var init = { method: metodo, headers: {}, credentials: 'same-origin' };
        if (corpo) {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(corpo);
        }
        return fetch(caminho, init).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (d) {
                return { status: r.status, dados: d };
            });
        });
    }

    function atualizarBotaoConta() {
        var texto = $('#btn-conta-texto');
        if (!texto) return;
        texto.textContent = usuario ? usuario.username : 'Entrar';
    }

    function abrirDialogoConta() {
        var dlg = $('#dlg-conta');
        if (!dlg) return;
        if (usuario) {
            $('#painel-conta').hidden = true;
            $('#painel-perfil').hidden = false;
            $('#perfil-usuario').textContent = usuario.username;
        } else {
            $('#painel-conta').hidden = false;
            $('#painel-perfil').hidden = true;
            $('#form-cadastro').hidden = true;
            $('#form-login').hidden = false;
        }
        if (typeof dlg.showModal === 'function') dlg.showModal();
    }

    function atualizarSessao() {
        return apiConta('GET', '/api/auth/eu').then(function (r) {
            usuario = r.dados && r.dados.user ? r.dados.user : null;
            atualizarBotaoConta();
            var form = $('#form-comentario');
            if (form) form.hidden = !usuario;
            var dica = $('#comentario-dica');
            if (dica) dica.textContent = usuario ? '' : 'Entre na sua conta para comentar';
            if (usuario) carregarHistorico(); else mostrarHistoricoVazio();
            return usuario;
        });
    }

    /* ======================= Comentarios ======================= */

    function carregarComentarios(workId) {
        var lista = $('#comentarios-lista');
        var statusEl = $('#comentarios-status');
        if (!lista || !workId) return;
        statusEl.textContent = 'Carregando…';
        fetch('/api/comments?work_id=' + encodeURIComponent(workId), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                lista.innerHTML = '';
                var comentarios = (d && d.comentarios) || [];
                statusEl.textContent = comentarios.length
                    ? comentarios.length + (comentarios.length === 1 ? ' comentário' : ' comentários')
                    : 'Seja o primeiro a comentar';
                comentarios.forEach(function (c) {
                    lista.appendChild(el('article', { class: 'comentario' }, [
                        el('div', { class: 'comentario-cabecalho' }, [
                            el('span', { class: 'comentario-autor', text: c.username }),
                            el('span', { class: 'comentario-data', text: formatarData(c.criado_em) })
                        ]),
                        el('p', { class: 'comentario-texto', text: c.conteudo })
                    ]));
                    if (usuario && c.user_id === usuario.id) {
                        lista.lastChild.appendChild(el('button', {
                            type: 'button',
                            class: 'comentario-remover',
                            text: 'apagar',
                            onclick: function () {
                                if (!window.confirm('Apagar este comentario?')) return;
                                apiConta('DELETE', '/api/comments/' + c.id).then(function () {
                                    carregarComentarios(workId);
                                });
                            }
                        }));
                    }
                });
            })
            .catch(function () {
                statusEl.textContent = 'Nao foi possivel carregar os comentarios';
            });
    }

    function formatarData(iso) {
        if (!iso) return '';
        var d = new Date(String(iso).replace(' ', 'T') + (String(iso).length <= 19 ? 'Z' : ''));
        if (isNaN(d.getTime())) return iso;
        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    /* ======================= Historico ======================= */

    function mostrarHistoricoVazio() {
        var bloco = $('#historico');
        if (bloco) bloco.hidden = true;
    }

    function carregarHistorico() {
        if (!usuario) return mostrarHistoricoVazio();
        var bloco = $('#historico');
        var lista = $('#historico-lista');
        var statusEl = $('#historico-status');
        if (!bloco) return;
        bloco.hidden = false;
        statusEl.textContent = 'Carregando…';
        fetch('/api/history', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                var itens = (d && d.itens) || [];
                lista.innerHTML = '';
                statusEl.textContent = itens.length
                    ? itens.length + (itens.length === 1 ? ' obra' : ' obras')
                    : 'Voce ainda nao leu nada por aqui';
                itens.forEach(function (it) {
                    var pct = it.total_paginas ? Math.min(100, Math.round((it.pagina / it.total_paginas) * 100)) : 0;
                    var item = el('button', {
                        type: 'button',
                        class: 'historico-item',
                        onclick: function () { continuarDoHistorico(it); }
                    }, [
                        it.capa ? el('img', { src: it.capa, alt: '', loading: 'lazy' }) : el('div', { class: 'historico-item-sem-capa' }),
                        el('div', { class: 'historico-item-body' }, [
                            el('h4', { text: it.titulo || it.work_id }),
                            el('p', { text: (it.capitulo || 'comecar') + (pct ? ' · ' + pct + '%' : '') }),
                            it.total_paginas ? el('div', { class: 'historico-progresso' }, [el('i', { style: 'width:' + pct + '%' })]) : null
                        ])
                    ]);
                    lista.appendChild(item);
                });
            })
            .catch(function () {
                statusEl.textContent = 'Nao foi possivel carregar o historico';
            });
    }

    function continuarDoHistorico(it) {
        // reconstroi a URL da obra a partir do historico
        var url = new URL(location.href);
        url.search = '';
        if (it.tipo === 'anime') {
            url.searchParams.set('anime', it.work_id);
        } else {
            url.searchParams.set('obra', it.work_id);
        }
        location.href = url.toString();
    }

    function registrarProgresso(info) {
        if (!usuario || !info || !info.work_id) return;
        apiConta('POST', '/api/history', info).then(function () {
            carregarHistorico();
        });
    }

    /* ======================= Loobyt (ex-NoxManga) ======================= */

    /** Busca no Loobyt, via o backend (a API exige assinatura). */
    function buscarLoobyt(termo, pagina) {
        var params = new URLSearchParams();
        if (termo) params.set('q', termo);
        params.set('pagina', String(pagina || 1));
        return fetch('/api/loobyt/busca?' + params.toString(), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                return {
                    obras: ((d && d.obras) || []).map(function (o) {
                        return {
                            obr_id: o.id,
                            obr_nome: o.titulo,
                            obr_imagem: o.capa,
                            genero: { gen_nome: o.tipo },
                            status: { stt_nome: o.status },
                            total_capitulos: o.capitulos,
                            loobyt: true,
                            slug: o.slug
                        };
                    })
                };
            })
            .catch(function () { return { obras: [] }; });
    }

    /* ======================= Utilidades ======================= */

    var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
    var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                if (k === 'class') node.className = attrs[k];
                else if (k === 'text') node.textContent = attrs[k];
                else if (k === 'html') node.innerHTML = attrs[k];
                else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
                else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
            });
        }
        (children || []).forEach(function (c) {
            if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return node;
    }

    function api(path) {
        var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT);
        return fetch(API + path, {
            signal: ctrl ? ctrl.signal : undefined,
            headers: { 'Accept': 'application/json' }
        }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).finally(function () { clearTimeout(timer); });
    }

    // Backend local de anime
    function apiAnime(path) {
        var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT);
        return fetch(API_ANIME + path, {
            signal: ctrl ? ctrl.signal : undefined,
            headers: { 'Accept': 'application/json' }
        }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).finally(function () { clearTimeout(timer); });
    }

    function salvarProgresso(dados) {
        try {
            var atual = JSON.parse(localStorage.getItem(CHAVE_PROGRESSO) || '{}');
            atual[dados.obraId] = dados;
            localStorage.setItem(CHAVE_PROGRESSO, JSON.stringify(atual));
        } catch (e) { /* modo privado / storage bloqueado */ }
    }

    function lerProgresso(obraId) {
        try {
            var atual = JSON.parse(localStorage.getItem(CHAVE_PROGRESSO) || '{}');
            return atual[obraId] || null;
        } catch (e) { return null; }
    }

    function formatarNumero(n) {
        return typeof n === 'number' ? n.toLocaleString('pt-BR') : (n || '0');
    }

    /* ======================= Estado ======================= */

    var totalResultados = 0;

    var estado = {
        visao: 'busca',
        modo: 'manga',
        consulta: '',
        tag: null,
        tipo: TIPOS[0],
        subfiltro: null,
        obra: null,
        capitulos: [],
        capitulo: null,
        indiceCapitulo: -1
    };

    /* ======================= Filtros ======================= */

    var CHAVE_ADULTO = 'dragontoons:adulto-confirmado';

    function adultoConfirmado() {
        try { return localStorage.getItem(CHAVE_ADULTO) === '1'; } catch (e) { return false; }
    }

    function marcarAdultoConfirmado() {
        try { localStorage.setItem(CHAVE_ADULTO, '1'); } catch (e) { /* storage bloqueado */ }
    }

    // Modo adulto: a paleta inteira do site vira vermelha
    // enquanto o filtro Hentai estiver ativo.
    function aplicarTema() {
        var ativo = !!(estado.tipo && estado.tipo.tipo === 'genero');
        document.documentElement.classList.toggle('tema-adulto', ativo);
    }

    function abrirAvisoAdulto(aposConfirmar) {
        var dlg = $('#dlg-adulto');
        if (!dlg || typeof dlg.showModal !== 'function') {
            // fallback sem suporte a <dialog>
            if (window.confirm('Este filtro mostra obras com conteudo adulto (18+). Continuar?')) {
                aposConfirmar(true);
            }
            return;
        }
        var ok = $('#dlg-ok');
        var cancelar = $('#dlg-cancelar');

        function fechar(resultado) {
            if (ok) ok.removeEventListener('click', aoOk);
            if (cancelar) cancelar.removeEventListener('click', aoCancelar);
            if (typeof dlg.close === 'function') dlg.close();
            aposConfirmar(resultado);
        }
        function aoOk() { fechar(true); }
        function aoCancelar() { fechar(false); }

        if (ok) ok.addEventListener('click', aoOk);
        if (cancelar) cancelar.addEventListener('click', aoCancelar);
        dlg.showModal();
    }

    function montarChips(container, itens, aoEscolher) {
        container.innerHTML = '';
        itens.forEach(function (item) {
            var chip = el('button', {
                type: 'button',
                class: 'chip' + (item.adulto ? ' chip-adulto' : ''),
                'aria-pressed': 'false',
                'data-id': item.id,
                text: item.nome,
                title: item.dica || '',
                onclick: function () { aoEscolher(item); }
            });
            container.appendChild(chip);
        });
    }

    function atualizarChips() {
        var tipo = estado.tipo;
        $$('#filtros-tipo .chip').forEach(function (c) {
            c.setAttribute('aria-pressed', String(Number(c.dataset.id) === tipo.id));
        });
        $$('#filtros-genero .chip').forEach(function (c) {
            c.setAttribute('aria-pressed', String(Number(c.dataset.id) === estado.tag));
        });
        $$('#filtros-sub .chip').forEach(function (c) {
            c.setAttribute('aria-pressed', String(c.dataset.id === estado.subfiltro));
        });
    }

    function mostrarSubfiltros(mostrar) {
        var linha = $('#linha-subfiltro');
        if (!linha) return;
        linha.hidden = !mostrar;
    }

    /* ======================= Busca ======================= */

    // Busca de anime: consulta o backend local (server.js)
    function buscarAnime(termo, acumular, fonteParam) {
        status(termo ? 'Buscando animes…' : 'Carregando animes…');

        var params = new URLSearchParams();
        if (termo) params.set('q', termo);
        params.set('fonte', 'animesdigital');
        var qs = params.toString();

        return apiAnime('/busca' + (qs ? '?' + qs : '')).then(function (dados) {
            var obras = ((dados && dados.obras) || []).map(function (a) {
                return {
                    obr_id: a.id,
                    obr_nome: a.titulo,
                    obr_imagem: a.capa,
                    total_capitulos: null,
                    genero: { gen_nome: a.fonteNome },
                    anime: a
                };
            });

            renderObras(obras, termo, acumular);
            totalResultados = (acumular ? totalResultados : 0) + obras.length;
            status(obras.length
                ? obras.length + (obras.length === 1 ? ' anime' : ' animes')
                : 'Nenhum anime encontrado');
        }).catch(function (erro) {
            console.error('[leitor] backend de anime indisponivel:', erro);
            $('#resultados').innerHTML = '';
            status('O módulo de anime precisa do servidor local rodando: node server.js', true);
        });
    }

    function mostrar(visao) {
        estado.visao = visao;
        ['busca', 'obra', 'capitulo'].forEach(function (v) {
            var secao = document.getElementById(v);
            var ativo = v === visao;
            secao.hidden = !ativo;
            secao.classList.toggle('is-active', ativo);
        });
        window.scrollTo({ top: 0, behavior: 'auto' });
    }

    function status(texto, isErro) {
        var node = $('#status-busca');
        if (!node) return;
        node.textContent = texto || '';
        node.classList.toggle('is-erro', !!isErro);
    }

    function buscar(pagina, acumular) {
        var termo = estado.consulta.trim();
        var limite = estado.subfiltro ? 50 : 24;
        var sel = estado.tipo;
        var generos, filtrarGenero, filtrarFormatos, tagsFiltro;
        // Conteudo adulto so aparece quando o filtro Hentai esta ativo
        var permitirAdulto = sel.tipo === 'genero';

        if (sel.tipo === 'anime') {
            return buscarAnime(termo, acumular, null);
        }

        if (sel.tipo === 'genero') {
            // Hentai: o subtipo decide a origem
            if (estado.subfiltro === 'anime') {
                estado.subfiltro = 'manhwa';
            }
            if (estado.subfiltro === 'manga') {
                // Hentai publicado como one-shot: genre 18 + tag "Adulto" (29)
                generos = [18];
                filtrarGenero = null;
                filtrarFormatos = null;
                tagsFiltro = '29';
            } else {
                generos = [sel.id];          // 5 = Hentais
                filtrarGenero = sel.id;
                filtrarFormatos = estado.subfiltro === 'manhwa' ? [1] : null;
            }
        } else if (sel.tipo === 'formato') {
            generos = GENEROS_POR_FORMATO[sel.id] || [1, 8, 18];
            filtrarGenero = null;
            filtrarFormatos = sel.formatos || [sel.id];
        } else {
            // "Tudo": catalogo geral (genero Livres) + o genero escolhido
            generos = [1];
            filtrarGenero = null;
            filtrarFormatos = null;
        }

        // Genero dos filtros avancados (tag da fonte)
        if (estado.tag && sel.tipo !== 'genero') {
            tagsFiltro = String(estado.tag);
        }

        function montarUrl(genId) {
            var consulta = new URLSearchParams();
            consulta.set('pagina', String(pagina || 1));
            consulta.set('limite', String(limite));
            consulta.set('gen_id', String(genId));
            // A API ignora "tags"; o parametro certo e' "tag_ids"
            if (tagsFiltro) consulta.set('tag_ids', tagsFiltro);
            if (termo) {
                consulta.set('q', termo);
            } else {
                // Sem termo: ordena por popularidade
                consulta.set('orderBy', 'visualizacoes_geral');
                consulta.set('orderDirection', 'DESC');
            }
            return '/obras/buscar?' + consulta.toString();
        }

        if (!acumular) status(termo ? 'Buscando…' : 'Carregando destaques…');

        function aceito(o) {
            var g = o.genero;
            var gId = (g && typeof g === 'object') ? g.gen_id : g;
            if (filtrarFormatos !== null) {
                var f = o.formato;
                var fId = (f && typeof f === 'object') ? f.formt_id : o.formt_id;
                if (filtrarFormatos.indexOf(Number(fId)) === -1) return false;
            }
            if (filtrarGenero !== null) {
                if (Number(gId) !== Number(filtrarGenero)) return false;
            } else if (GENEROS_BLOQUEADOS.indexOf(Number(gId)) !== -1) {
                return false;
            }
            // Fora do filtro Hentai, nada de conteudo adulto
            if (!permitirAdulto && temTagAdulto(o)) return false;
            return true;
        }

        // Um request por genero, mesclados com o Loobyt
        return Promise.all(
            generos.map(function (g) {
                return api(montarUrl(g)).catch(function () { return { obras: [] }; });
            }).concat([buscarLoobyt(termo, pagina)])
        ).then(function (respostas) {
            var todas = [];
            var vistos = {};
            respostas.forEach(function (r) {
                ((r && r.obras) || []).forEach(function (o) {
                    if (!vistos[o.obr_id]) { vistos[o.obr_id] = true; todas.push(o); }
                });
            });

            // A busca da fonte e' por palavra/prefixo: "Solo Leveling" nao casa,
            // mas "Leveling" casa. Se a busca completa nao retorna nada,
            // refaz palavra por palavra e mescla.
            if (!todas.length && termo && termo.split(/\s+/).length > 1) {
                var palavras = termo.split(/\s+/).filter(function (p) { return p.length > 2; });
                return Promise.all(palavras.map(function (p) {
                    return api(montarUrlCom(generos, p, pagina, limite)).catch(function () { return { obras: [] }; });
                })).then(function (parciais) {
                    var extra = [];
                    var vistos2 = {};
                    parciais.forEach(function (r) {
                        ((r && r.obras) || []).forEach(function (o) {
                            if (!vistos2[o.obr_id]) { vistos2[o.obr_id] = true; extra.push(o); }
                        });
                    });
                    return finalizar(extra);
                });
            }

            return finalizar(todas);

            function finalizar(brutas) {
                if ((pagina || 1) === 1 && (!termo || /wind|breaker/i.test(termo)) && (!estado.tag || estado.tag === 1)) {
                    brutas.unshift(WIND_MANGADASH);
                }
                var obras = brutas.filter(aceito);
                renderObras(obras, termo, acumular);
                estado.paginaAtual = pagina || 1;
                totalResultados = (acumular ? totalResultados : 0) + obras.length;

                var nomeFiltro = sel.tipo === 'todos' ? null : sel.nome;
                if (estado.subfiltro) {
                    var sub = SUBFILTROS.filter(function (s) { return s.id === estado.subfiltro; })[0];
                    if (sub) nomeFiltro = sub.nome;
                } else if (estado.tag && sel.tipo === 'todos') {
                    var gen = GENEROS.filter(function (g) { return g.id === estado.tag; })[0];
                    if (gen) nomeFiltro = gen.nome;
                }
                var n = totalResultados;

                if (termo) {
                    status(n
                        ? n + (n === 1 ? ' resultado para “' + termo + '”' : ' resultados para “' + termo + '”')
                        : 'Nenhum resultado para “' + termo + '”' + (nomeFiltro ? ' em ' + nomeFiltro : ''));
                } else if (nomeFiltro) {
                    status(n + ' obras em ' + nomeFiltro);
                } else {
                    status(n ? 'Destaques' : '');
                }

                montarMais(brutas.length, 99);
            }
        }).catch(function (erro) {
            console.error('[leitor] falha na busca:', erro);
            if (!acumular) {
                $('#resultados').innerHTML = '';
                status('Não foi possível falar com a fonte agora. Tente novamente em instantes.', true);
            }
        });

        function montarUrlCom(generos, texto, pag, lim) {
            var consulta = new URLSearchParams();
            consulta.set('pagina', String(pag || 1));
            consulta.set('limite', String(lim));
            consulta.set('gen_id', String(generos[0]));
            consulta.set('q', texto);
            return '/obras/buscar?' + consulta.toString();
        }
    }

    // "Carregar mais" + varredura automatica quando ha filtro de formato
    // (a pagina popular e' dominada por manhwa, entao outros formatos
    //  podem nao aparecer nas primeiras paginas)
    function montarMais(total, totalPaginas) {
        var botao = document.getElementById('btn-mais');
        if (botao) botao.remove();
        if (estado.varrendo) return;
        if (estado.paginaAtual >= totalPaginas) return;

        botao = el('button', {
            type: 'button',
            id: 'btn-mais',
            class: 'btn-secundario btn-mais',
            text: 'Carregar mais',
            onclick: function () {
                botao.disabled = true;
                botao.textContent = 'Carregando…';
                buscar(estado.paginaAtual + 1, true);
            }
        });
        $('#resultados').parentNode.appendChild(botao);
    }

    // Quando um formato esta ativo, varre varias paginas para achar resultados
    function buscarComVarredura() {
        estado.paginaAtual = 0;

        if (!estado.tipo || estado.tipo.tipo === 'todos') {
            estado.varrendo = false;
            buscar(1, false);
            return;
        }

        estado.varrendo = true;
        // Subtipos (ex.: Hentai Manga) tem poucos resultados: varre mais paginas
        var restantes = estado.subfiltro ? 8 : 2;

        function passo() {
            if (restantes <= 0) {
                estado.varrendo = false;
                return;
            }
            restantes--;
            return buscar(estado.paginaAtual + 1, estado.paginaAtual > 0).then(function () {
                if (restantes > 0) passo();
                else estado.varrendo = false;
            });
        }

        passo();
    }

    function renderObras(obras, termo, acumular) {
        var container = $('#resultados');

        if (!acumular) {
            container.innerHTML = '';
            if (!obras.length) {
                container.appendChild(el('p', {
                    class: 'reader-status',
                    text: termo ? 'Nenhuma obra encontrada para esse termo.' : 'Nada disponível no momento.'
                }));
                return;
            }
        }

        obras.forEach(function (obra) {
            var capa = el('img', {
                src: obra.obr_imagem,
                alt: 'Capa de ' + obra.obr_nome,
                loading: 'lazy',
                decoding: 'async',
                width: 300,
                height: 450
            });

            var meta = [obra.genero && obra.genero.gen_nome, obra.total_capitulos ? obra.total_capitulos + ' caps' : null]
                .filter(Boolean).join(' · ');

            var card = el('button', {
                type: 'button',
                class: 'obra-card',
                'data-id': obra.obr_id,
                onclick: function () { abrirObra(obra); }
            }, [
                capa,
                el('div', { class: 'obra-card-body' }, [
                    el('h3', { text: obra.obr_nome }),
                    el('p', { text: meta })
                ])
            ]);

            container.appendChild(card);
        });
    }

    /* ======================= Obra ======================= */

    function abrirObra(obra) {
        if (obra === WIND_MANGADASH.obr_id) obra = WIND_MANGADASH;
        if (obra && obra.mangadash) return abrirObraLoobyt(obra);
        if (obra && obra.anime) return abrirObraAnime(obra);
        if (obra && obra.loobyt) return abrirObraLoobyt(obra);
        var obraId = obra.obr_id;

        status('Carregando obra…');
        $('#status-obra').textContent = 'Carregando…';
        $('#capitulos').innerHTML = '';

        return api('/obras/' + encodeURIComponent(obraId)).then(function (obra) {
            estado.obra = obra;
            estado.capitulos = (obra.capitulos || []).slice().sort(function (a, b) {
                return (a.cap_numero || 0) - (b.cap_numero || 0);
            });

            $('#obra-capa').src = obra.obr_imagem || '';
            $('#obra-capa').alt = 'Capa de ' + obra.obr_nome;
            $('#obra-nome').textContent = obra.obr_nome;

            var meta = [];
            if (obra.status && obra.status.stt_nome) meta.push(obra.status.stt_nome);
            if (obra.genero && obra.genero.gen_nome) meta.push(obra.genero.gen_nome);
            if (obra.formato) {
                // "formato" pode chegar como string ou como objeto { formt_id, formt_nome }
                var formato = typeof obra.formato === 'string' ? obra.formato : (obra.formato.formt_nome || obra.formato.nome);
                if (formato) meta.push(formato);
            }
            if (obra.total_capitulos) meta.push(obra.total_capitulos + ' capítulos');
            $('#obra-meta').textContent = meta.join(' · ');

            $('#obra-descricao').textContent = obra.obr_descricao || '';

            var tags = $('#obra-tags');
            tags.innerHTML = '';
            (obra.tags || []).slice(0, 10).forEach(function (t) {
                var nome = t.tag_nome || t.nome || t;
                if (nome) tags.appendChild(el('span', { class: 'tag', text: nome }));
            });

            renderCapitulos();
            mostrar('obra');
            carregarComentarios(obra.obr_id);
            registrarProgresso({
                work_id: obra.obr_id,
                tipo: obra.anime ? 'anime' : 'manga',
                titulo: obra.obr_nome,
                capa: obra.anime ? obra.anime.capa : (obra.obr_imagem || null),
                slug: obra.anime ? obra.anime.slug : (obra.obr_slug || null),
                fonte: obra.anime ? obra.anime.fonte : null,
                status: 'lendo'
            });
            historico('/leitor.html?obra=' + encodeURIComponent(obraId));
        }).catch(function (erro) {
            console.error('[leitor] falha ao carregar obra:', erro);
            $('#status-obra').textContent = 'Não foi possível carregar esta obra agora.';
        });
    }

    /* ======================= Obra do Loobyt ======================= */

    function abrirObraLoobyt(obra) {
        status('Carregando obra…');
        $('#status-obra').textContent = 'Carregando…';
        $('#capitulos').innerHTML = '';

        return fetch('/api/' + (obra.mangadash ? 'mangadash' : 'loobyt') + '/capitulos?slug=' + encodeURIComponent(obra.slug), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                estado.obra = obra;
                estado.capitulos = ((d && d.capitulos) || []).map(function (c) {
                    return {
                        cap_id: c.id,
                        cap_nome: c.titulo || ('Capítulo ' + c.numero),
                        cap_numero: c.numero,
                        cap_paginas: c.paginas,
                        loobyt: !obra.mangadash,
                        mangadash: !!obra.mangadash,
                        url: c.url
                    };
                });

                $('#obra-capa').src = obra.obr_imagem || '';
                $('#obra-capa').alt = 'Capa de ' + obra.obr_nome;
                $('#obra-nome').textContent = obra.obr_nome;
                $('#obra-meta').textContent = [
                    obra.genero && obra.genero.gen_nome,
                    obra.status && obra.status.stt_nome,
                    estado.capitulos.length + ' capítulos'
                ].filter(Boolean).join(' · ');
                $('#obra-descricao').textContent = obra.obr_descricao || '';
                $('#obra-tags').innerHTML = '';

                renderCapitulos();
                mostrar('obra');
                carregarComentarios(obra.obr_id);
                registrarProgresso({
                    work_id: obra.obr_id,
                    tipo: 'manga',
                    titulo: obra.obr_nome,
                    capa: obra.obr_imagem || null,
                    slug: obra.slug,
                    fonte: obra.mangadash ? 'mangadash' : 'loobyt',
                    status: 'lendo'
                });
                historico('/leitor.html?obra=' + encodeURIComponent(obra.obr_id));
            })
            .catch(function (erro) {
                console.error('[leitor] falha ao carregar obra do loobyt:', erro);
                $('#status-obra').textContent = 'Não foi possível carregar esta obra agora.';
            });
    }

    function renderCapitulos() {
        var container = $('#capitulos');
        container.innerHTML = '';
        var anime = !!(estado.obra && estado.obra.anime);
        container.classList.toggle('episode-grid', anime);
        $('#obra').classList.toggle('anime-detail', anime);
        $('#lista-titulo').textContent = anime ? 'Todos os episódios' : 'Capítulos';
        $('#episode-controls').hidden = !anime;
        if (anime) return renderEpisodios();

        if (!estado.capitulos.length) {
            $('#status-obra').textContent = 'Nenhum capítulo disponível.';
            return;
        }

        var progresso = lerProgresso(estado.obra.obr_id);

        estado.capitulos.forEach(function (cap) {
            var numero = cap.cap_numero != null ? 'Capítulo ' + cap.cap_numero : (cap.cap_nome || 'Capítulo');
            var marca = cap.cap_liberado === false ? 'bloqueado' : '';
            var lido = progresso && progresso.capId === cap.cap_id;

            var item = el('button', {
                type: 'button',
                class: 'capitulo-item' + (lido ? ' is-lido' : ''),
                'data-id': cap.cap_id,
                onclick: function () { abrirCapitulo(cap); }
            }, [
                el('span', { class: 'cap-numero', text: numero }),
                el('span', { class: 'cap-marca', text: marca })
            ]);

            container.appendChild(item);
        });

        var msg = estado.capitulos.length + ' capítulos';
        if (progresso) msg += ' · você parou no ' + (progresso.capTitulo || 'capítulo ' + progresso.capNumero);
        $('#status-obra').textContent = msg;
    }

    function renderEpisodios() {
        var container = $('#capitulos');
        container.innerHTML = '';
        var termo = $('#episode-search').value.trim().toLowerCase();
        var lista = estado.capitulos.filter(function (c) {
            return !termo || String(c.cap_numero) === termo || (c.cap_nome || '').toLowerCase().includes(termo);
        }).slice();
        if ($('#episode-order').value === 'desc') lista.reverse();
        var obra = estado.obra.anime;
        lista.forEach(function (cap) {
            var visual = el('span', { class: 'episode-cover' }, [
                el('span', { class: 'episode-play', text: '▶', 'aria-hidden': 'true' }),
                el('span', { class: 'episode-number', text: 'EP ' + cap.cap_numero })
            ]);
            if (obra.capa) visual.prepend(el('img', { src: obra.capa, alt: '', loading: 'lazy', decoding: 'async' }));
            container.appendChild(el('button', { type: 'button', class: 'episode-card', onclick: function () { abrirCapitulo(cap); } }, [
                visual, el('span', { class: 'episode-title', text: cap.cap_nome || 'Episódio ' + cap.cap_numero }),
                el('span', { class: 'episode-series', text: obra.titulo }),
                el('span', { class: 'episode-watch', text: 'Assistir episódio →' })
            ]));
        });
        $('#status-obra').textContent = lista.length ? lista.length + ' episódios · Animes Digital' : 'Nenhum episódio encontrado.';
    }

    /* ======================= Capítulo ======================= */

    var observador = null;

    // Obra de anime: episodios vem do backend local
    function abrirObraAnime(obra) {
        var a = obra.anime;
        $('#episode-search').value = '';
        $('#episode-order').value = 'asc';
        estado.obra = obra;
        estado.modo = 'anime';

        $('#status-obra').textContent = 'Carregando episódios…';
        $('#capitulos').innerHTML = '';

        return apiAnime('/' + encodeURIComponent(a.fonte) + '/' + encodeURIComponent(a.slug) + '/episodios')
            .then(function (dados) {
                estado.capitulos = ((dados && dados.episodios) || []).map(function (e) {
                    return {
                        cap_id: a.fonte + ':' + (e.url || (a.slug + ':' + e.numero)),
                        cap_nome: e.titulo,
                        cap_numero: e.numero,
                        cap_url: e.url,
                        cap_player: e.player
                    };
                });

                $('#obra-capa').src = a.capa || '';
                $('#obra-capa').alt = 'Capa de ' + a.titulo;
                $('#obra-nome').textContent = a.titulo;
                $('#obra-meta').textContent = a.fonteNome + (estado.capitulos.length
                    ? ' · ' + estado.capitulos.length + ' episódios' : '');
                $('#obra-descricao').textContent = '';
                $('#obra-tags').innerHTML = '';

                renderCapitulos();
                mostrar('obra');
                carregarComentarios(a.id);
                registrarProgresso({
                    work_id: a.id,
                    tipo: 'anime',
                    titulo: a.titulo,
                    capa: a.capa,
                    slug: a.slug,
                    fonte: a.fonte,
                    status: 'lendo'
                });
                historico('/leitor.html?anime=' + encodeURIComponent(a.id));
            }).catch(function (erro) {
                console.error('[leitor] falha ao carregar episodios:', erro);
                $('#status-obra').textContent = 'Não foi possível carregar os episódios agora.';
            });
    }

    function abrirCapitulo(cap) {
        if (typeof cap === 'string' || typeof cap === 'number') {
            cap = estado.capitulos.find(function (c) { return String(c.cap_id) === String(cap); });
        }
        if (!cap) return Promise.resolve();
        if (cap && cap.cap_url) return abrirCapituloAnime(cap);
        if (cap && cap.mangadash) return abrirCapituloMangaDash(cap);
        if (cap && cap.loobyt) return abrirCapituloLoobyt(cap);
        var capituloId = cap.cap_id;
        var progresso = $('#capitulo-progresso');
        progresso.textContent = 'Carregando páginas…';
        $('#paginas').hidden = false;
        $('#player-anime').hidden = true;
        $('#paginas').innerHTML = '';
        $('#capitulo-titulo').textContent = 'Carregando…';

        return api('/capitulos/' + encodeURIComponent(capituloId)).then(function (cap) {
            estado.capitulo = cap;
            estado.indiceCapitulo = estado.capitulos.findIndex(function (c) { return c.cap_id === cap.cap_id; });

            var obra = cap.obra || estado.obra || {};
            $('#capitulo-titulo').textContent = (obra.obr_nome ? obra.obr_nome + ' — ' : '') + (cap.cap_nome || 'Capítulo');

            var link = $('#link-fonte');
            link.href = cap.cap_numero != null
                ? SITE + '/obra/' + encodeURIComponent(obra.obr_slug || '') + '/capitulo/' + cap.cap_numero
                : SITE + '/obra/' + encodeURIComponent(obra.obr_slug || '');

            renderPaginas(cap);
            mostrar('capitulo');
            historico('/leitor.html?obra=' + encodeURIComponent(obra.obr_id) + '&cap=' + encodeURIComponent(cap.cap_id));
        }).catch(function (erro) {
            console.error('[leitor] falha ao carregar capítulo:', erro);
            progresso.textContent = 'Não foi possível carregar este capítulo agora.';
        });
    }

    // Capitulo do Loobyt: as paginas vem do backend (imagens do CDN)
    function abrirCapituloLoobyt(cap) {
        estado.capitulo = cap;
        estado.indiceCapitulo = estado.capitulos.findIndex(function (c) { return c.cap_id === cap.cap_id; });

        var progresso = $('#capitulo-progresso');
        progresso.textContent = 'Carregando páginas…';
        $('#player-anime').hidden = true;
        $('#paginas').hidden = false;
        $('#paginas').innerHTML = '';

        var obra = estado.obra || {};
        $('#capitulo-titulo').textContent = (obra.obr_nome ? obra.obr_nome + ' — ' : '') + (cap.cap_nome || '');
        $('#link-fonte').href = 'https://loobyt.org/manga/' + encodeURIComponent(obra.slug || '') +
            '/capitulo-' + (cap.cap_numero || '');

        return fetch('/api/loobyt/paginas?cap=' + encodeURIComponent(cap.cap_id), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                var urls = (d && d.paginas) || [];
                var container = $('#paginas');
                container.innerHTML = '';
                progresso.textContent = urls.length
                    ? urls.length + (urls.length === 1 ? ' página' : ' páginas')
                    : 'Nenhuma página disponível';

                // mostra a secao antes de criar as imagens
                mostrar('capitulo');
                historico('/leitor.html?obra=' + encodeURIComponent(obra.obr_id) + '&cap=' + encodeURIComponent(cap.cap_id));

                // src direto + lazy nativo: nao depende de IntersectionObserver
                urls.forEach(function (url, i) {
                    container.appendChild(el('img', {
                        class: 'pagina',
                        src: url,
                        alt: 'Página ' + (i + 1),
                        loading: i < 4 ? 'eager' : 'lazy',
                        decoding: 'async'
                    }));
                });
            })
            .catch(function (erro) {
                console.error('[leitor] falha ao carregar páginas do loobyt:', erro);
                progresso.textContent = 'Não foi possível carregar as páginas agora.';
            });
    }

    var pdfAtivo = null;
    var pdfObserver = null;
    var pdfGeracao = 0;
    async function abrirCapituloMangaDash(cap) {
        var geracao = ++pdfGeracao;
        if (pdfObserver) pdfObserver.disconnect();
        if (pdfAtivo) { pdfAtivo.destroy(); pdfAtivo = null; }
        estado.capitulo = cap;
        estado.indiceCapitulo = estado.capitulos.findIndex(function (c) { return c.cap_id === cap.cap_id; });
        $('#player-anime').hidden = true;
        var container = $('#paginas');
        container.hidden = false;
        container.innerHTML = '';
        $('#capitulo-titulo').textContent = 'Wind Breaker — ' + cap.cap_nome;
        $('#link-fonte').href = cap.url;
        var progresso = $('#capitulo-progresso');
        progresso.textContent = 'Carregando páginas…';
        mostrar('capitulo');
        atualizarBotoes();
        historico('/leitor.html?obra=' + encodeURIComponent(WIND_MANGADASH.obr_id) + '&cap=' + encodeURIComponent(cap.cap_id));
        try {
            var pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
            if (geracao !== pdfGeracao) return;
            pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
            pdfAtivo = pdfjs.getDocument({ url: '/api/mangadash/pdf?cap=' + encodeURIComponent(cap.cap_id), isEvalSupported: false });
            var pdf = await pdfAtivo.promise;
            if (geracao !== pdfGeracao) return;
            progresso.textContent = pdf.numPages + ' páginas';
            var queue = Promise.resolve();
            pdfObserver = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (!entry.isIntersecting) return;
                    pdfObserver.unobserve(entry.target);
                    queue = queue.then(async function () {
                        if (geracao !== pdfGeracao) return;
                        var canvas = entry.target;
                        var page = await pdf.getPage(Number(canvas.dataset.page));
                        if (geracao !== pdfGeracao) return;
                        var base = page.getViewport({ scale: 1 });
                        var viewport = page.getViewport({ scale: Math.min(1200, container.clientWidth * (devicePixelRatio || 1)) / base.width });
                        canvas.width = viewport.width;
                        canvas.height = viewport.height;
                        await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
                        page.cleanup();
                    }).catch(function () { if (geracao === pdfGeracao) progresso.textContent = 'Falha ao carregar uma página. Tente novamente ou abra a fonte.'; });
                });
            }, { rootMargin: '800px' });
            for (var i = 1; i <= pdf.numPages; i++) {
                var canvas = el('canvas', { class: 'pagina pagina-pdf', 'data-page': i, 'aria-label': 'Página ' + i, role: 'img', width: 800, height: 1200 });
                container.appendChild(canvas);
                pdfObserver.observe(canvas);
            }
        } catch (error) {
            if (geracao === pdfGeracao) progresso.textContent = 'Não foi possível carregar o capítulo. Tente novamente ou abra a fonte.';
        }
    }

    // Capitulo de anime: busca o player na fonte e mostra em iframe
    function abrirCapituloAnime(cap) {
        estado.capitulo = cap;
        estado.indiceCapitulo = estado.capitulos.findIndex(function (c) { return c.cap_id === cap.cap_id; });

        var progresso = $('#capitulo-progresso');
        progresso.textContent = 'Carregando player…';
        $('#paginas').innerHTML = '';
        $('#paginas').hidden = true;

        var obra = estado.obra || {};
        $('#capitulo-titulo').textContent = (obra.obr_nome ? obra.obr_nome + ' — ' : '') + (cap.cap_nome || '');
        $('#link-fonte').href = cap.cap_url;

        var playerPronto = cap.cap_player;

        function montar(src) {
            var box = $('#player-anime');
            box.hidden = false;
            box.innerHTML = '';
            box.appendChild(el('iframe', {
                src: src,
                allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture',
                referrerpolicy: 'no-referrer',
                loading: 'lazy',
                title: 'Player de ' + (obra.obr_nome || 'anime')
            }));
            progresso.textContent = '';
        }

        var promessa = playerPronto
            ? Promise.resolve({ player: playerPronto })
            : apiAnime('/player?url=' + encodeURIComponent(cap.cap_url)).catch(function () { return { player: null }; });

        return promessa.then(function (dados) {
            if (dados && dados.player) {
                montar(dados.player);
            } else if (cap.cap_url) {
                // A fonte nao expoe player extraivel: embute a pagina do
                // episodio (ela traz o player proprio do site)
                montar(cap.cap_url);
                progresso.textContent = 'Player da fonte';
            } else {
                progresso.textContent = 'Player indisponivel. Use "Ver na fonte".';
            }
            mostrar('capitulo');
            atualizarBotoes();
            historico('/leitor.html?anime=' + encodeURIComponent(obra.anime ? obra.anime.id : '') +
                '&cap=' + encodeURIComponent(cap.cap_id));
        });
    }

    function renderPaginas(cap) {
        var container = $('#paginas');
        container.innerHTML = '';

        var paginas = cap.cap_paginas || [];
        var progresso = $('#capitulo-progresso');

        if (!paginas.length) {
            if (cap.cap_texto) {
                container.appendChild(el('p', { class: 'obra-descricao', text: cap.cap_texto }));
                progresso.textContent = 'Capítulo em texto';
            } else {
                progresso.textContent = 'Este capítulo não tem páginas disponíveis.';
            }
            return;
        }

        progresso.textContent = paginas.length + (paginas.length === 1 ? ' página' : ' páginas');

        if (observador) observador.disconnect();
        observador = new IntersectionObserver(function (entradas) {
            entradas.forEach(function (e) {
                if (!e.isIntersecting) return;
                var img = e.target;
                if (!img.dataset.src) return;
                img.src = img.dataset.src;
                img.classList.remove('pagina-placeholder');
                delete img.dataset.src;
                observador.unobserve(img);
            });
        }, { rootMargin: '900px 0px' });

        paginas.forEach(function (url, i) {
            var img = el('img', {
                class: 'pagina pagina-placeholder',
                'data-src': url,
                alt: 'Página ' + (i + 1) + ' de ' + paginas.length,
                loading: 'lazy',
                decoding: 'async'
            });
            img.addEventListener('load', function () { img.classList.remove('pagina-placeholder'); });
            container.appendChild(img);
            observador.observe(img);
        });
    }

    function marcarProgresso() {
        if (!estado.obra || !estado.capitulo) return;
        var cap = estado.capitulo;
        salvarProgresso({
            obraId: estado.obra.obr_id,
            capId: cap.cap_id,
            capNumero: cap.cap_numero,
            capTitulo: cap.cap_nome,
            ts: Date.now()
        });
    }

    /* ======================= Navegação ======================= */

    function historico(url) {
        try { history.pushState({}, '', url); } catch (e) { location.hash = ''; }
    }

    function capituloVizinho(delta) {
        var i = estado.indiceCapitulo + delta;
        if (i < 0 || i >= estado.capitulos.length) return null;
        return estado.capitulos[i];
    }

    function atualizarBotoes() {
        var anterior = $('#btn-anterior');
        var proximo = $('#btn-proximo');
        anterior.disabled = !capituloVizinho(-1);
        proximo.disabled = !capituloVizinho(1);
    }

    /* ======================= Eventos ======================= */

    function iniciar() {
        $('#episode-search').addEventListener('input', renderEpisodios);
        $('#episode-order').addEventListener('change', renderEpisodios);
        // Genero (filtros avancados): selecao unica, clique de novo desmarca
        montarChips($('#filtros-genero'), GENEROS, function (item) {
            estado.tag = estado.tag === item.id ? null : item.id;
            if (estado.tipo.tipo === 'genero') {
                // Hentai tem prioridade; nao mistura com o genero escolhido
                estado.tipo = TIPOS[0];
                estado.subfiltro = null;
                mostrarSubfiltros(false);
            }
            atualizarChips();
            historico('/leitor.html' + (estado.tag ? '?genero=' + estado.tag : ''));
            buscarComVarredura();
        });

        montarChips($('#filtros-tipo'), TIPOS, function (item) {
            if (item.adulto && !adultoConfirmado()) {
                abrirAvisoAdulto(function (ok) {
                    if (!ok) return;
                    marcarAdultoConfirmado();
                    estado.tipo = item;
                    estado.subfiltro = null;
                    mostrarSubfiltros(true);
                    aplicarTema();
                    atualizarChips();
                    historico('/leitor.html?tipo=' + item.slug);
                    buscarComVarredura();
                });
                return;
            }
            estado.tipo = item;
            estado.subfiltro = null;
            if (item.tipo === 'genero') {
                // Hentai tem prioridade: limpa o genero dos filtros avancados
                estado.tag = null;
            }
            mostrarSubfiltros(item.tipo === 'genero');
            aplicarTema();
            atualizarChips();
            historico('/leitor.html?tipo=' + item.slug);
            buscarComVarredura();
        });

        montarChips($('#filtros-sub'), SUBFILTROS, function (item) {
            estado.subfiltro = estado.subfiltro === item.id ? null : item.id;
            atualizarChips();
            buscarComVarredura();
        });

        $('#form-busca').addEventListener('submit', function (e) {
            e.preventDefault();
            estado.consulta = $('#campo-busca').value;
            buscarComVarredura();
        });

        // ---------- conta ----------
        var btnConta = $('#btn-conta');
        if (btnConta) {
            btnConta.addEventListener('click', abrirDialogoConta);
        }

        var formLogin = $('#form-login');
        if (formLogin) {
            formLogin.addEventListener('submit', function (e) {
                e.preventDefault();
                $('#login-erro').textContent = '';
                apiConta('POST', '/api/auth/login', {
                    identificador: $('#login-identificador').value,
                    senha: $('#login-senha').value
                }).then(function (r) {
                    if (r.status !== 200) {
                        $('#login-erro').textContent = (r.dados && r.dados.erro) || 'nao foi possivel entrar';
                        return;
                    }
                    $('#form-login').reset();
                    var dlg = $('#dlg-conta');
                    if (dlg && dlg.open) dlg.close();
                    atualizarSessao();
                });
            });
        }

        var formCad = $('#form-cadastro');
        if (formCad) {
            formCad.addEventListener('submit', function (e) {
                e.preventDefault();
                $('#cad-erro').textContent = '';
                apiConta('POST', '/api/auth/registrar', {
                    username: $('#cad-usuario').value,
                    email: $('#cad-email').value,
                    senha: $('#cad-senha').value
                }).then(function (r) {
                    if (r.status !== 200) {
                        $('#cad-erro').textContent = (r.dados && r.dados.erro) || 'nao foi possivel criar a conta';
                        return;
                    }
                    $('#form-cadastro').reset();
                    var dlg = $('#dlg-conta');
                    if (dlg && dlg.open) dlg.close();
                    atualizarSessao();
                });
            });
        }

        var btnIrCad = $('#btn-ir-cadastro');
        if (btnIrCad) {
            btnIrCad.addEventListener('click', function () {
                $('#form-login').hidden = true;
                $('#form-cadastro').hidden = false;
            });
        }
        var btnIrLogin = $('#btn-ir-login');
        if (btnIrLogin) {
            btnIrLogin.addEventListener('click', function () {
                $('#form-cadastro').hidden = true;
                $('#form-login').hidden = false;
            });
        }

        var btnLogout = $('#btn-logout');
        if (btnLogout) {
            btnLogout.addEventListener('click', function () {
                apiConta('POST', '/api/auth/logout').then(function () {
                    var dlg = $('#dlg-conta');
                    if (dlg && dlg.open) dlg.close();
                    atualizarSessao();
                });
            });
        }

        // ---------- comentario ----------
        var formCom = $('#form-comentario');
        if (formCom) {
            formCom.addEventListener('submit', function (e) {
                e.preventDefault();
                var texto = $('#campo-comentario').value.trim();
                if (!texto || !estado.obra) return;
                apiConta('POST', '/api/comments', {
                    work_id: estado.obra.obr_id,
                    conteudo: texto
                }).then(function (r) {
                    if (r.status !== 200) {
                        $('#comentarios-status').textContent = (r.dados && r.dados.erro) || 'nao foi possivel comentar';
                        return;
                    }
                    $('#campo-comentario').value = '';
                    carregarComentarios(estado.obra.obr_id);
                });
            });
        }

        $('#btn-proximo').addEventListener('click', function () {
            var cap = capituloVizinho(1);
            if (cap) abrirCapitulo(cap.cap_id);
        });

        $('#btn-anterior').addEventListener('click', function () {
            var cap = capituloVizinho(-1);
            if (cap) abrirCapitulo(cap.cap_id);
        });

        $('#btn-modo').addEventListener('click', function () {
            var ativo = document.body.classList.toggle('leitor-compacto');
            this.setAttribute('aria-pressed', String(ativo));
            this.textContent = ativo ? 'Tamanho real' : 'Ajustar à tela';
        });

        $$('[data-voltar]').forEach(function (botao) {
            botao.addEventListener('click', function () {
                var destino = botao.dataset.voltar;
                mostrar(destino);
                historico(destino === 'busca' ? '/leitor.html' : '/leitor.html?' + (estado.obra.anime ? 'anime=' : 'obra=') + encodeURIComponent(estado.obra.obr_id));
            });
        });

        window.addEventListener('scroll', function () {
            if (estado.visao === 'capitulo') marcarProgresso();
        }, { passive: true });

        window.addEventListener('popstate', function () { aplicarUrl(); });

        aplicarTema();
        atualizarChips();
        atualizarSessao();
        aplicarUrl();
    }

    function aplicarUrl() {
        var params = new URLSearchParams(location.search);
        var obra = params.get('obra');
        var cap = params.get('cap');
        var slugTipo = params.get('tipo');

        var animeId = params.get('anime');
        if (animeId) {
            var slug = animeId.split(':').slice(1).join(':');
            if (!/^animesdigital:[a-z0-9-]+$/.test(animeId)) {
                status('Esta fonte foi removida. Busque o anime no Animes Digital.');
                mostrar('busca');
                return;
            }
            var titulo = slug.replace(/-/g, ' ');
            return apiAnime('/busca?q=' + encodeURIComponent(titulo) + '&fonte=animesdigital').then(function (d) {
                var anime = d.obras.find(function (a) { return a.id === animeId; }) || { id: animeId, fonte: 'animesdigital', fonteNome: 'Animes Digital', slug: slug, titulo: titulo };
                return abrirObraAnime({ obr_id: anime.id, anime: anime });
            }).then(function () { if (cap) return abrirCapitulo(cap); }).catch(function () { status('Não foi possível abrir este anime agora.'); });
        }

        if (cap) {
            abrirObra(obra).then(function () {
                abrirCapitulo(cap);
                atualizarBotoes();
            });
            return;
        }

        if (obra) {
            abrirObra(obra).then(atualizarBotoes);
            return;
        }

        // Filtro de tipo vindo da tela inicial
        if (slugTipo) {
            var escolhido = TIPOS.filter(function (t) { return t.slug === slugTipo; })[0];
            if (escolhido) {
                if (escolhido.adulto && !adultoConfirmado()) {
                    estado.tipo = TIPOS[0];
                    mostrarSubfiltros(false);
                    aplicarTema();
                    abrirAvisoAdulto(function (ok) {
                        if (!ok) { atualizarChips(); buscar(1); return; }
                        marcarAdultoConfirmado();
                        estado.tipo = escolhido;
                        mostrarSubfiltros(true);
                        aplicarTema();
                        atualizarChips();
                        buscar(1);
                    });
                } else {
                    estado.tipo = escolhido;
                    mostrarSubfiltros(escolhido.tipo === 'genero');
                    aplicarTema();
                }
            }
        }

        // Genero dos filtros avancados
        var genero = params.get('genero');
        if (genero) {
            estado.tag = Number(genero);
        }

        var consulta = params.get('busca');
        if (consulta) {
            estado.consulta = consulta;
            $('#campo-busca').value = consulta;
        }
        atualizarChips();
        mostrar('busca');
        buscar(1);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
