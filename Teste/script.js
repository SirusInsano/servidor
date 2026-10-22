/* =========================================================
   DragonToons — scripts do site
   ========================================================= */
(function () {
    'use strict';

    /* ---------- Menu de navegação (mobile) ---------- */
    var toggle = document.querySelector('.nav-toggle');
    var nav = document.getElementById('nav-principal');

    if (toggle && nav) {
        var label = toggle.querySelector('.sr-only');

        var setOpen = function (open) {
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            nav.classList.toggle('is-open', open);
            if (label) {
                label.textContent = open ? 'Fechar menu de navegação' : 'Abrir menu de navegação';
            }
        };

        toggle.addEventListener('click', function () {
            setOpen(toggle.getAttribute('aria-expanded') !== 'true');
        });

        // Fecha ao clicar em um link do menu
        nav.addEventListener('click', function (event) {
            if (event.target.closest('a')) {
                setOpen(false);
            }
        });

        // Fecha com a tecla Esc
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
                setOpen(false);
                toggle.focus();
            }
        });

        // Ao voltar para o layout de desktop, garante estado limpo
        var desktop = window.matchMedia('(min-width: 901px)');
        var onChange = function (event) {
            if (event.matches) {
                setOpen(false);
            }
        };

        if (typeof desktop.addEventListener === 'function') {
            desktop.addEventListener('change', onChange);
        } else if (typeof desktop.addListener === 'function') {
            desktop.addListener(onChange);
        }
    }

    /* ---------- Ano do rodapé sempre atualizado ---------- */
    var year = document.getElementById('ano');
    if (year) {
        year.textContent = String(new Date().getFullYear());
    }

    /* ---------- Busca da tela inicial ---------- */
    // Os mesmos tipos do leitor, em slugs para mandar pela URL.
    var TIPOS = [
        { slug: 'tudo', nome: 'Todos' },
        { slug: 'manhwa', nome: 'Manhwa' },
        { slug: 'manhua', nome: 'Manhua' },
        { slug: 'manga', nome: 'Mangá' },
        { slug: 'anime', nome: 'Anime' },
        { slug: 'novel', nome: 'Novel' },
        { slug: 'hentai', nome: 'Hentai 18+' }
    ];

    var container = document.getElementById('inicio-tipos');
    var form = document.getElementById('form-inicio');
    var campo = document.getElementById('campo-inicio');
    var tipoAtivo = 'tudo';

    function irParaLeitor(termo, tipo) {
        var params = new URLSearchParams();
        if (termo) params.set('busca', termo);
        if (tipo && tipo !== 'tudo') params.set('tipo', tipo);
        var query = params.toString();
        window.location.href = 'leitor.html' + (query ? '?' + query : '');
    }

    if (container && form && campo) {
        TIPOS.forEach(function (tipo) {
            var chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip' + (tipo.slug === 'hentai' ? ' chip-adulto' : '');
            chip.textContent = tipo.nome;
            chip.setAttribute('aria-pressed', String(tipo.slug === tipoAtivo));
            chip.dataset.slug = tipo.slug;
            chip.addEventListener('click', function () {
                if (tipo.slug === 'hentai') {
                    // O leitor cuida da confirmacao de idade
                    irParaLeitor(campo.value.trim(), tipo.slug);
                    return;
                }
                tipoAtivo = tipo.slug;
                Array.prototype.forEach.call(container.querySelectorAll('.chip'), function (c) {
                    c.setAttribute('aria-pressed', String(c.dataset.slug === tipoAtivo));
                });
                irParaLeitor(campo.value.trim(), tipoAtivo);
            });
            container.appendChild(chip);
        });

        form.addEventListener('submit', function (event) {
            event.preventDefault();
            irParaLeitor(campo.value.trim(), tipoAtivo);
        });
    }
})();
