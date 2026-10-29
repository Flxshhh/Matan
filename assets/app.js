/* Конспекты: навигация, просмотр тем (PDF.js), поиск.
   Маршруты (hash):
     #/                         — все предметы
     #/<предмет>                — список лекций
     #/<предмет>/<лекция>       — темы лекции
     #/<предмет>/<лекция>/<тема>?p=<стр>&q=<запрос>
     #/search?q=<запрос>        — результаты поиска */
(() => {
  'use strict';

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const $ = (sel, el = document) => el.querySelector(sel);
  const main = $('#main');
  const sidebar = $('#sidebar');
  let catalog = null;
  let searchIndex = null; // грузится лениво при первом поиске

  // ---------- Утилиты ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => s.toLowerCase().replace(/ё/g, 'е');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* приватный режим */ } },
  };
  const doneKey = (s, l, sec) => `${s}/${l}/${sec}`;
  let done = new Set(store.get('done', []));
  const isDone = (s, l, sec) => done.has(doneKey(s, l, sec));
  function toggleDone(s, l, sec) {
    const k = doneKey(s, l, sec);
    done.has(k) ? done.delete(k) : done.add(k);
    store.set('done', [...done]);
  }

  function find(sId, lId, secId) {
    const subject = catalog.subjects.find((s) => s.id === sId);
    const lecture = subject && lId ? subject.lectures.find((l) => l.id === lId) : null;
    const section = lecture && secId ? lecture.sections.find((x) => x.id === secId) : null;
    return { subject, lecture, section };
  }
  const lecLabel = (l) => (l.number != null ? `Лекция ${l.number}` : l.id);
  const pageWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'страница' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'страницы' : 'страниц');

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, qs = ''] = raw.split('?');
    return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(qs) };
  }

  // ---------- Сайдбар ----------
  function renderSidebar(cur) {
    const html = catalog.subjects.map((s) => `
      <li class="subject"><details ${cur.s === s.id || catalog.subjects.length === 1 ? 'open' : ''}>
        <summary>${esc(s.short)}</summary>
        <ul>${s.lectures.map((l) => `
          <li><details ${cur.s === s.id && cur.l === l.id ? 'open' : ''}>
            <summary title="${esc(l.title)}"><span class="lec-num">${l.number ?? ''}.</span>${esc(l.title)}</summary>
            <ul>${l.sections.map((x) => `
              <li><a href="#/${s.id}/${l.id}/${x.id}" class="${cur.s === s.id && cur.l === l.id && cur.sec === x.id ? 'current' : ''} ${isDone(s.id, l.id, x.id) ? 'done' : ''}">${esc(x.title)}</a></li>`).join('')}
            </ul></details></li>`).join('')}
        </ul></details></li>`).join('');
    sidebar.innerHTML = `<ul class="tree">${html}</ul>`;
    const current = $('.current', sidebar);
    if (current) current.scrollIntoView({ block: 'nearest' });
  }

  // ---------- Страницы ----------
  function viewHome() {
    document.title = 'Конспекты';
    main.innerHTML = `
      <div>
        <h1>Конспекты</h1>
        <p class="lead">Выбери предмет, лекцию и тему — или ищи сразу по всем конспектам.</p>
        <div class="cards">${catalog.subjects.map((s) => {
          const total = s.lectures.reduce((a, l) => a + l.sections.length, 0);
          const d = s.lectures.reduce((a, l) => a + l.sections.filter((x) => isDone(s.id, l.id, x.id)).length, 0);
          return `<a class="card" href="#/${s.id}">
            <h3>${esc(s.title)}</h3><p>${esc(s.description)}</p>
            <div class="meta">${s.lectures.length} лекций · ${total} тем · изучено ${d}</div>
            <div class="progress"><i style="width:${total ? (100 * d) / total : 0}%"></i></div></a>`;
        }).join('')}</div>
      </div>`;
  }

  function viewSubject(s) {
    document.title = s.title;
    main.innerHTML = `
      <div>
        <div class="crumbs"><a href="#/">Предметы</a></div>
        <h1>${esc(s.title)}</h1>
        <p class="lead">${esc(s.description)}</p>
        <ul class="lec-list">${s.lectures.map((l) => `
          <li class="lec-item">
            <h3><a href="#/${s.id}/${l.id}"><span class="num">${l.number ?? ''}</span>${esc(l.title)}</a></h3>
            <ol class="topic-list">${l.sections.map((x) => `
              <li class="${isDone(s.id, l.id, x.id) ? 'done' : ''}"><a href="#/${s.id}/${l.id}/${x.id}">${esc(x.title)}</a></li>`).join('')}
            </ol></li>`).join('')}
        </ul>
      </div>`;
  }

  function viewLecture(s, l) {
    document.title = `${l.title} — ${s.short}`;
    main.innerHTML = `
      <div>
        <div class="crumbs"><a href="#/">Предметы</a> / <a href="#/${s.id}">${esc(s.short)}</a></div>
        <div class="topic-head">
          <div><h1>${esc(l.title)}</h1><p class="lead">${lecLabel(l)} · ${l.sections.length} тем · ${l.pageCount} стр.</p></div>
          <div class="topic-tools"><a class="btn" href="${esc(l.file)}" target="_blank" rel="noopener">PDF целиком ↗</a></div>
        </div>
        <div class="cards">${l.sections.map((x, i) => `
          <a class="card" href="#/${s.id}/${l.id}/${x.id}">
            <h3>${i + 1}. ${esc(x.title)} ${isDone(s.id, l.id, x.id) ? '<span style="color:var(--ok)">✓</span>' : ''}</h3>
            ${x.subsections.length ? `<p>${x.subsections.map((t) => esc(t.title)).join(' · ')}</p>` : ''}
            <div class="meta">стр. ${x.pages[0]}${x.pages[1] > x.pages[0] ? '–' + x.pages[1] : ''}</div>
          </a>`).join('')}</div>
      </div>`;
  }

  // Соседние темы — через границу лекций, чтобы можно было читать подряд
  function neighbours(s, l, x) {
    const flat = s.lectures.flatMap((lec) => lec.sections.map((sec) => ({ lec, sec })));
    const i = flat.findIndex((f) => f.lec === l && f.sec === x);
    return { prev: flat[i - 1], next: flat[i + 1] };
  }

  function viewSection(s, l, x, params) {
    document.title = `${x.title} — ${s.short}`;
    const [from, to] = x.pages;
    const { prev, next } = neighbours(s, l, x);
    const q = params.get('q') || '';
    const link = (f, cls, label) => f ? `<a class="${cls}" href="#/${s.id}/${f.lec.id}/${f.sec.id}"><small>${label}${f.lec !== l ? ' · ' + esc(lecLabel(f.lec)) : ''}</small>${esc(f.sec.title)}</a>` : '';
    const isOn = isDone(s.id, l.id, x.id);
    main.innerHTML = `
      <div>
        <div class="crumbs"><a href="#/">Предметы</a> / <a href="#/${s.id}">${esc(s.short)}</a> / <a href="#/${s.id}/${l.id}">${esc(lecLabel(l))}. ${esc(l.title)}</a></div>
        <div class="topic-head">
          <h1>${esc(x.title)}</h1>
          <div class="topic-tools">
            <button class="btn ${isOn ? 'on' : ''}" id="doneBtn">${isOn ? '✓ Изучено' : 'Отметить изученным'}</button>
            <button class="btn ${document.documentElement.classList.contains('invert-pages') ? 'on' : ''}" id="invertBtn" title="Инвертировать цвета страниц для тёмной темы">Тёмные страницы</button>
            <a class="btn" href="${esc(l.file)}#page=${from}" target="_blank" rel="noopener">PDF ↗</a>
          </div>
        </div>
        <div class="muted" style="font-size:13px">стр. ${from}${to > from ? '–' + to : ''} · ${to - from + 1} ${pageWord(to - from + 1)}</div>
        ${x.subsections.length ? `<div class="chips">${x.subsections.map((t) => `<button class="chip" data-page="${t.page}">${esc(t.title)}</button>`).join('')}</div>` : ''}
        <div class="pages" id="pages"></div>
        <nav class="pager">${link(prev, 'prev', '← Назад')}${link(next, 'next', 'Дальше →')}</nav>
      </div>`;

    $('#doneBtn').onclick = () => { toggleDone(s.id, l.id, x.id); route(); };
    $('#invertBtn').onclick = () => {
      const on = document.documentElement.classList.toggle('invert-pages');
      $('#invertBtn').classList.toggle('on', on);
      store.set('invertPages', on);
    };
    main.querySelectorAll('.chip').forEach((c) => (c.onclick = () => scrollToPage(+c.dataset.page)));

    renderPages(l.file, from, to, q).then(() => {
      const p = +params.get('p');
      if (p >= from && p <= to) scrollToPage(p);
    });
  }

  function scrollToPage(p) {
    const el = document.querySelector(`.page[data-page="${p}"]`);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - 70, behavior: 'smooth' });
  }

  // ---------- PDF ----------
  const docs = new Map();
  const getDoc = (file) => {
    if (!docs.has(file)) docs.set(file, pdfjsLib.getDocument(file).promise);
    return docs.get(file);
  };
  let renderToken = 0;
  let observer = null;

  async function renderPages(file, from, to, query) {
    const token = ++renderToken;
    const box = $('#pages');
    let doc;
    try { doc = await getDoc(file); } catch (e) {
      box.innerHTML = `<p class="muted">Не удалось загрузить PDF (${esc(e.message)}). Сайт нужно открывать через веб-сервер, а не как файл.</p>`;
      return;
    }
    if (token !== renderToken) return;
    const first = await doc.getPage(from);
    const vp0 = first.getViewport({ scale: 1 });
    box.innerHTML = '';
    for (let p = from; p <= to; p++) {
      const div = document.createElement('div');
      div.className = 'page loading';
      div.dataset.page = p;
      div.style.aspectRatio = `${vp0.width} / ${vp0.height}`;
      box.appendChild(div);
    }
    if (observer) observer.disconnect();
    // рисуем только страницы рядом с экраном
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting || e.target.dataset.rendered) continue;
        e.target.dataset.rendered = '1';
        drawPage(doc, e.target, query, token);
      }
    }, { rootMargin: '1200px 0px' });
    box.querySelectorAll('.page').forEach((d) => observer.observe(d));
  }

  async function drawPage(doc, div, query, token) {
    const page = await doc.getPage(+div.dataset.page);
    if (token !== renderToken) return;
    const cssWidth = div.clientWidth;
    const scale = cssWidth / page.getViewport({ scale: 1 }).width;
    const viewport = page.getViewport({ scale });
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    await page.render({
      canvasContext: canvas.getContext('2d'),
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    }).promise;
    if (token !== renderToken) return;
    div.classList.remove('loading');
    div.innerHTML = `<span class="pno">${div.dataset.page}</span>`;
    div.prepend(canvas);
    div.dataset.width = cssWidth;

    // текстовый слой: выделение текста + подсветка найденного
    const layer = document.createElement('div');
    layer.className = 'textLayer';
    layer.style.setProperty('--scale-factor', scale);
    div.appendChild(layer);
    const textDivs = [];
    await pdfjsLib.renderTextLayer({
      textContentSource: page.streamTextContent(), container: layer, viewport, textDivs,
    }).promise;
    if (query) highlight(textDivs, terms(query));
  }

  function highlight(spans, ts) {
    if (!ts.length) return;
    const re = new RegExp(ts.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/е/g, '[её]')).join('|'), 'gi');
    for (const span of spans) {
      const text = span.textContent;
      if (!re.test(text)) continue;
      re.lastIndex = 0;
      span.innerHTML = esc(text).replace(re, (m) => `<mark>${m}</mark>`);
    }
  }

  // при заметном изменении ширины перерисовываем страницы
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const pg = $('.page[data-width]');
      if (pg && Math.abs(pg.clientWidth - +pg.dataset.width) > 40) route();
    }, 250);
  });

  // ---------- Поиск ----------
  const terms = (q) => norm(q).split(/\s+/).filter((t) => t.length > 1);

  async function loadIndex() {
    if (!searchIndex) {
      const raw = await fetch('data/search.json').then((r) => r.json());
      searchIndex = raw.map((e) => ({ ...e, n: norm(e.t) }));
    }
    return searchIndex;
  }

  function count(hay, t) {
    let n = 0, i = hay.indexOf(t);
    while (i !== -1) { n++; i = hay.indexOf(t, i + t.length); }
    return n;
  }

  // Результат = тема (секция). Совпадения по страницам внутри темы суммируются.
  async function search(q) {
    const ts = terms(q);
    if (!ts.length) return [];
    const idx = await loadIndex();
    const bySec = new Map();
    for (const e of idx) {
      const { lecture: l, section: x, subject: s } = find(e.s, e.l, e.sec);
      if (!x) continue;
      const titleHay = norm(`${x.title} ${x.subsections.map((t) => t.title).join(' ')}`);
      let score = 0;
      let all = true;
      for (const t of ts) {
        const c = count(e.n, t);
        const inTitle = titleHay.includes(t);
        if (!c && !inTitle) { all = false; break; }
        score += c + (inTitle ? 15 : 0);
      }
      if (!all) continue;
      const key = `${e.s}/${e.l}/${e.sec}`;
      const r = bySec.get(key) || { s, l, x, score: 0, best: null, bestScore: -1, pages: [] };
      const pageScore = ts.reduce((a, t) => a + count(e.n, t), 0);
      r.score += score;
      if (pageScore > 0) r.pages.push(e.p);
      if (pageScore > r.bestScore) { r.bestScore = pageScore; r.best = e; }
      bySec.set(key, r);
    }
    return [...bySec.values()].sort((a, b) => b.score - a.score);
  }

  function snippet(e, ts, len = 180) {
    const text = e.t;
    const n = e.n;
    let pos = -1;
    for (const t of ts) { const i = n.indexOf(t); if (i !== -1 && (pos === -1 || i < pos)) pos = i; }
    if (pos === -1) pos = 0;
    const start = Math.max(0, pos - 60);
    let s = (start > 0 ? '…' : '') + text.slice(start, start + len) + (start + len < text.length ? '…' : '');
    s = esc(s);
    const re = new RegExp(ts.map((t) => esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/е/g, '[её]')).join('|'), 'gi');
    return s.replace(re, (m) => `<mark>${m}</mark>`);
  }

  const resultHref = (r, q) => `#/${r.s.id}/${r.l.id}/${r.x.id}?${new URLSearchParams({ ...(r.best && r.bestScore > 0 ? { p: r.best.p } : {}), q })}`;

  async function viewSearch(q) {
    document.title = `Поиск: ${q}`;
    $('#searchInput').value = q;
    main.innerHTML = `<div><h1>Поиск</h1><p class="lead">Ищу «${esc(q)}»…</p></div>`;
    const res = await search(q);
    const ts = terms(q);
    main.innerHTML = `
      <div>
        <h1>Поиск: «${esc(q)}»</h1>
        <p class="lead">${res.length ? `Найдено тем: ${res.length}` : 'Ничего не найдено. Попробуй короче — например, начало слова: «непрерыв».'}</p>
        <ul class="results">${res.map((r) => `
          <li><a class="result" href="${resultHref(r, q)}">
            <div class="where">${esc(r.s.short)} · ${esc(lecLabel(r.l))}. ${esc(r.l.title)}${r.pages.length ? ` · стр. ${r.pages.join(', ')}` : ''}</div>
            <div class="title">${esc(r.x.title)}</div>
            ${r.best ? `<div class="snip">${snippet(r.best, ts)}</div>` : ''}
          </a></li>`).join('')}
        </ul>
      </div>`;
  }

  // выпадающие подсказки в шапке
  const input = $('#searchInput');
  const pop = $('#searchPop');
  let popTimer, active = -1;
  input.addEventListener('input', () => {
    clearTimeout(popTimer);
    popTimer = setTimeout(async () => {
      const q = input.value.trim();
      if (terms(q).length === 0) { pop.hidden = true; return; }
      const res = (await search(q)).slice(0, 7);
      const ts = terms(q);
      active = -1;
      pop.innerHTML = res.map((r) => `
        <a href="${resultHref(r, q)}"><div class="where muted" style="font-size:12px">${esc(r.s.short)} · ${esc(lecLabel(r.l))}</div>
        <div><b>${esc(r.x.title)}</b></div>${r.best ? `<div class="muted" style="font-size:13px">${snippet(r.best, ts, 110)}</div>` : ''}</a>`).join('')
        + `<a class="all" href="#/search?q=${encodeURIComponent(q)}">${res.length ? 'Все результаты →' : 'Ничего не найдено'}</a>`;
      pop.hidden = false;
    }, 120);
  });
  input.addEventListener('keydown', (e) => {
    const items = [...pop.querySelectorAll('a')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((a, i) => a.classList.toggle('active', i === active));
    } else if (e.key === 'Enter') {
      const q = input.value.trim();
      if (active >= 0 && items[active]) location.hash = items[active].getAttribute('href');
      else if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
      pop.hidden = true;
      input.blur();
    } else if (e.key === 'Escape') { pop.hidden = true; input.blur(); }
  });
  input.addEventListener('focus', () => { if (pop.innerHTML && input.value.trim()) pop.hidden = false; loadIndex(); });
  document.addEventListener('click', (e) => { if (!$('#search').contains(e.target)) pop.hidden = true; });
  pop.addEventListener('click', () => { pop.hidden = true; });
  document.addEventListener('keydown', (e) => {
    if ((e.key === '/' || (e.key === 'k' && (e.ctrlKey || e.metaKey))) && document.activeElement !== input) {
      e.preventDefault(); input.focus(); input.select();
    }
  });

  // ---------- Тема, меню ----------
  $('#themeBtn').onclick = () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    store.set('theme', root.dataset.theme);
    try { localStorage.setItem('theme', root.dataset.theme); } catch (e) { /* ignore */ }
  };
  if (store.get('invertPages', false)) document.documentElement.classList.add('invert-pages');
  $('#menuBtn').onclick = () => document.body.classList.toggle('nav-open');
  $('#scrim').onclick = () => document.body.classList.remove('nav-open');

  // ---------- Роутер ----------
  let lastKey = '';
  function route() {
    document.body.classList.remove('nav-open');
    pop.hidden = true;
    const { parts, params } = parseHash();
    if (parts[0] === 'search') {
      renderSidebar({});
      return viewSearch(params.get('q') || '');
    }
    const [sId, lId, secId] = parts;
    const { subject, lecture, section } = sId ? find(sId, lId, secId) : {};
    renderSidebar({ s: sId, l: lId, sec: secId });
    const key = parts.join('/');
    if (key !== lastKey) window.scrollTo(0, 0);
    lastKey = key;
    if (!sId) return viewHome();
    if (!subject) return (main.innerHTML = '<div><h1>Не найдено</h1><a href="#/">На главную</a></div>');
    if (!lId) return viewSubject(subject);
    if (!lecture) return (main.innerHTML = `<div><h1>Лекция не найдена</h1><a href="#/${sId}">К предмету</a></div>`);
    if (!secId) return viewLecture(subject, lecture);
    if (!section) return viewLecture(subject, lecture);
    viewSection(subject, lecture, section, params);
  }

  fetch('data/catalog.json')
    .then((r) => r.json())
    .then((c) => { catalog = c; window.addEventListener('hashchange', route); route(); })
    .catch((e) => { main.innerHTML = `<p class="muted">Не удалось загрузить каталог: ${esc(e.message)}. Открой сайт через веб-сервер (см. README).</p>`; });
})();
