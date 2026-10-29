/* Конспекты: навигация, просмотр тем (PDF.js), поиск.
   Маршруты (hash):
     #/                         — последний открытый предмет
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
  const plural = (n, [one, few, many]) =>
    n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many;
  const chevron = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
  const DEFAULT_COLOR = '#4a7cf0';

  // вкладки-«таблетки» с предметами, у каждого свой цвет
  const subjectPills = (cur) => `
    <nav class="pills" aria-label="Предметы">${catalog.subjects.map((s) => `
      <a class="pill ${cur && cur.id === s.id ? 'active' : ''}" style="--c:${esc(s.color || DEFAULT_COLOR)}" href="#/${s.id}">${esc(s.title)}</a>`).join('')}
    </nav>`;

  const sectionHead = (title, badge) => `
    <div class="shead"><h1>${title}</h1>${badge ? `<span class="badge">${badge}</span>` : ''}</div>`;

  // большая белая карточка: заголовок, описание, «Читать ›» и мета справа
  const card = ({ href, title, desc, meta, done }) => `
    <a class="lcard ${done ? 'is-done' : ''}" href="${href}">
      <h3>${title}</h3>
      ${desc ? `<p>${desc}</p>` : ''}
      <div class="lcard-foot"><span class="read">Читать ${chevron}</span><span class="lcard-meta">${meta || ''}</span></div>
    </a>`;

  function viewHome() {
    const s = catalog.subjects.find((x) => x.id === store.get('lastSubject')) || catalog.subjects[0];
    if (s) viewSubject(s); else main.innerHTML = '<div><h1>Пока пусто</h1></div>';
  }

  function viewSubject(s) {
    document.title = s.title;
    store.set('lastSubject', s.id);
    main.innerHTML = `
      <div>
        ${subjectPills(s)}
        ${sectionHead(esc(s.title), `${s.lectures.length} ${plural(s.lectures.length, ['лекция', 'лекции', 'лекций'])}`)}
        ${s.description ? `<p class="lead">${esc(s.description)}</p>` : ''}
        <div class="lcards">${s.lectures.map((l) => {
          const d = l.sections.filter((x) => isDone(s.id, l.id, x.id)).length;
          const n = l.sections.length;
          return card({
            href: `#/${s.id}/${l.id}`,
            title: `${l.number != null ? `<span class="num">${l.number}.</span> ` : ''}${esc(l.title)}`,
            desc: l.sections.map((x) => esc(x.title.replace(/\.$/, ''))).join(' · '),
            meta: d ? `<span class="ok">✓ ${d}/${n}</span>` : `${n} ${plural(n, ['тема', 'темы', 'тем'])}`,
            done: d === n && n > 0,
          });
        }).join('')}</div>
      </div>`;
  }

  function viewLecture(s, l) {
    document.title = `${l.title} — ${s.short}`;
    main.innerHTML = `
      <div>
        <div class="crumbs"><a href="#/${s.id}">${esc(s.title)}</a> <span>›</span> ${esc(lecLabel(l))}</div>
        ${sectionHead(esc(l.title), `${l.sections.length} ${plural(l.sections.length, ['тема', 'темы', 'тем'])}`)}
        <div class="topic-tools" style="margin-bottom:22px">
          <a class="btn primary" href="#/${s.id}/${l.id}/all">Читать целиком</a>
          <a class="btn" href="${esc(l.file)}" target="_blank" rel="noopener" download>Скачать PDF</a>
        </div>
        <div class="lcards">${l.sections.map((x, i) => card({
          href: `#/${s.id}/${l.id}/${x.id}`,
          title: `<span class="num">${i + 1}.</span> ${esc(x.title)}`,
          desc: x.subsections.map((t) => esc(t.title.replace(/[.:]$/, ''))).join(' · '),
          meta: `${isDone(s.id, l.id, x.id) ? '<span class="ok">✓</span> ' : ''}стр. ${x.pages[0]}${x.pages[1] > x.pages[0] ? '–' + x.pages[1] : ''}`,
          done: isDone(s.id, l.id, x.id),
        })).join('')}</div>
      </div>`;
  }

  // Соседние темы — через границу лекций, чтобы можно было читать подряд
  function neighbours(s, l, x) {
    const flat = s.lectures.flatMap((lec) => lec.sections.map((sec) => ({ lec, sec })));
    const i = flat.findIndex((f) => f.lec === l && f.sec === x);
    return { prev: flat[i - 1], next: flat[i + 1] };
  }

  // Вся лекция одним «документом»: темы становятся кнопками-переходами
  const wholeLecture = (l) => ({
    id: 'all', title: l.title, whole: true, pages: [1, l.pageCount],
    subsections: l.sections.map((x) => ({ title: x.title, page: x.pages[0] })),
  });

  function viewSection(s, l, x, params) {
    document.title = `${x.title} — ${s.short}`;
    const [from, to] = x.pages;
    const { prev, next } = x.whole ? {} : neighbours(s, l, x);
    const q = params.get('q') || '';
    const link = (f, cls, label) => f ? `<a class="${cls}" href="#/${s.id}/${f.lec.id}/${f.sec.id}"><small>${label}${f.lec !== l ? ' · ' + esc(lecLabel(f.lec)) : ''}</small>${esc(f.sec.title)}</a>` : '';
    const isOn = !x.whole && isDone(s.id, l.id, x.id);
    main.innerHTML = `
      <div>
        <div class="crumbs"><a href="#/${s.id}">${esc(s.title)}</a> <span>›</span> <a href="#/${s.id}/${l.id}">${esc(lecLabel(l))}</a>${x.whole ? '' : ` <span>›</span> ${esc(x.title)}`}</div>
        <div class="topic-head">
          <div class="shead"><h1>${x.whole ? `${esc(lecLabel(l))}. ` : ''}${esc(x.title)}</h1></div>
          <div class="topic-tools">
            ${x.whole ? `<a class="btn" href="#/${s.id}/${l.id}">По темам</a>` : `<button class="btn ${isOn ? 'on' : ''}" id="doneBtn">${isOn ? '✓ Изучено' : 'Отметить изученным'}</button>`}
            <a class="btn" href="${esc(l.file)}#page=${from}" target="_blank" rel="noopener">PDF ↗</a>
          </div>
        </div>
        <div class="page-range">стр. ${from}${to > from ? '–' + to : ''} · ${to - from + 1} ${pageWord(to - from + 1)}</div>
        ${x.subsections.length ? `<div class="chips">${x.subsections.map((t) => `<button class="chip" data-page="${t.page}">${esc(t.title)}</button>`).join('')}</div>` : ''}
        <div class="viewer-bar">
          <button class="btn sq" data-zoom="out" title="Уменьшить (−)" aria-label="Уменьшить">−</button>
          <button class="btn zoom-val" data-zoom="fit" title="По ширине (0)" id="zoomVal">100%</button>
          <button class="btn sq" data-zoom="in" title="Увеличить (+)" aria-label="Увеличить">+</button>
          <div class="pnav">
            <button class="btn sq" id="prevPage" title="Предыдущая страница (←)" aria-label="Предыдущая страница">${chevronLeft}</button>
            <span class="page-ind" id="pageInd"></span>
            <button class="btn sq primary" id="nextPage" title="Следующая страница (→)" aria-label="Следующая страница">${chevron}</button>
          </div>
        </div>
        <div class="viewer" id="viewer"></div>
        <div class="dots" id="dots"></div>
        <nav class="pager">${link(prev, 'prev', '← Предыдущая тема')}${link(next, 'next', 'Следующая тема →')}</nav>
      </div>`;

    if (!x.whole) $('#doneBtn').onclick = () => { toggleDone(s.id, l.id, x.id); route(); };
    main.querySelectorAll('.chip').forEach((c) => (c.onclick = () => scrollToPage(+c.dataset.page)));
    main.querySelectorAll('[data-zoom]').forEach((b) => (b.onclick = () => {
      const z = b.dataset.zoom;
      setZoom(z === 'fit' ? 1 : zoom * (z === 'in' ? 1.25 : 0.8));
    }));
    // после последней страницы «вперёд» ведёт в следующую тему, до первой — в конец предыдущей
    const topicHref = (f, atEnd) => f ? `#/${s.id}/${f.lec.id}/${f.sec.id}${atEnd ? `?p=${f.sec.pages[1]}` : ''}` : null;
    flip = { nextTopic: topicHref(next, false), prevTopic: topicHref(prev, true), nextTitle: next && next.sec.title };
    $('#prevPage').onclick = () => flipPage(-1);
    $('#nextPage').onclick = () => flipPage(1);
    applyZoomWidth();

    renderPages(l.file, from, to, q, l.pageCount).then(() => {
      const p = +params.get('p');
      if (p >= from && p <= to) scrollToPage(p, false);
    });
  }

  // ---------- Листание страниц вбок ----------
  let flip = {};
  let curIdx = 0;
  const slides = () => document.querySelectorAll('#viewer .slide');

  function goToSlide(i, smooth = true) {
    const viewer = $('#viewer');
    const n = slides().length;
    if (!viewer || !n) return;
    curIdx = Math.max(0, Math.min(n - 1, i));
    viewer.scrollTo({ left: curIdx * viewer.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
    // если страницу прокрутили вниз — новую показываем с начала
    const barH = (($('.viewer-bar') || {}).offsetHeight || 0) + ($('.topbar').offsetHeight || 0);
    const top = viewer.getBoundingClientRect().top;
    if (top < barH) window.scrollTo({ top: top + scrollY - barH, behavior: smooth ? 'smooth' : 'auto' });
    updatePageInd();
  }

  function flipPage(dir) {
    const n = slides().length;
    if (dir > 0 && curIdx >= n - 1) { if (flip.nextTopic) location.hash = flip.nextTopic; return; }
    if (dir < 0 && curIdx <= 0) { if (flip.prevTopic) location.hash = flip.prevTopic; return; }
    goToSlide(curIdx + dir);
  }

  function scrollToPage(p, smooth = true) {
    const all = [...slides()];
    const i = all.findIndex((sl) => +sl.firstChild.dataset.page === p);
    if (i !== -1) goToSlide(i, smooth);
  }

  const chevronLeft = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>';

  // ---------- Масштаб ----------
  // zoom — ширина страниц относительно колонки. Картинка страницы всегда
  // перерисовывается под реальный размер на экране (с учётом devicePixelRatio
  // и pinch-зума телефона), поэтому при увеличении текст остаётся чётким.
  const ZOOM_MIN = 0.5, ZOOM_MAX = 5;
  let zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +store.get('zoom', 1) || 1));
  let zoomTimer;

  function applyZoomWidth() {
    const viewer = $('#viewer');
    if (viewer) viewer.style.setProperty('--zoom', zoom);
    const val = $('#zoomVal');
    if (val) val.textContent = `${Math.round(zoom * 100)}%`;
  }

  function setZoom(z) {
    z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    if (Math.abs(z - 1) < 0.04) z = 1;
    const viewer = $('#viewer');
    if (!viewer || z === zoom) return;
    // запоминаем, какая точка текущей страницы в центре экрана, чтобы после зума остаться там же
    const slide = slides()[curIdx];
    const anchor = slide && slide.firstChild;
    const cy = innerHeight / 2;
    const frac = anchor ? (cy - anchor.getBoundingClientRect().top) / anchor.offsetHeight : 0;
    const sw = slide ? slide.clientWidth : 0;
    const xFrac = slide ? (slide.scrollLeft + sw / 2) / slide.scrollWidth : 0;

    zoom = z;
    store.set('zoom', zoom);
    applyZoomWidth();

    if (anchor) window.scrollTo(0, anchor.getBoundingClientRect().top + scrollY + frac * anchor.offsetHeight - cy);
    if (slide) slide.scrollLeft = xFrac * slide.scrollWidth - sw / 2;
    viewer.scrollLeft = curIdx * viewer.clientWidth;
    // пока пользователь крутит — страницы просто растягиваются, чёткость догоняет следом
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(refreshPages, 200);
  }

  // Ctrl + колесо / щипок на тачпаде — зум страниц, а не всего сайта
  document.addEventListener('wheel', (e) => {
    if (!e.ctrlKey || !e.target.closest || !e.target.closest('#viewer')) return;
    e.preventDefault();
    setZoom(zoom * Math.exp(-e.deltaY * 0.01));
  }, { passive: false });

  document.addEventListener('keydown', (e) => {
    if (!$('#viewer') || /INPUT|TEXTAREA/.test(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') setZoom(zoom * 1.25);
    else if (e.key === '-') setZoom(zoom * 0.8);
    else if (e.key === '0') setZoom(1);
    else if (e.key === 'ArrowRight') { e.preventDefault(); flipPage(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); flipPage(-1); }
  });

  // ---------- PDF ----------
  const docs = new Map();
  const getDoc = (file) => {
    if (!docs.has(file)) docs.set(file, pdfjsLib.getDocument(file).promise);
    return docs.get(file);
  };
  let renderToken = 0;
  let observer = null;
  let current = null; // { doc, query, token } текущего просмотра
  const NEAR = 1500;  // px: страницы ближе — держим отрисованными, дальше — освобождаем память
  // iOS не даёт canvas больше ~16.7 Мп, да и память не резиновая
  const MAX_PIXELS = 14e6;

  async function renderPages(file, from, to, query, total) {
    const token = ++renderToken;
    const box = $('#viewer');
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
      const slide = document.createElement('div');
      slide.className = 'slide';
      const div = document.createElement('div');
      div.className = 'page loading';
      div.dataset.page = p;
      div.style.aspectRatio = `${vp0.width} / ${vp0.height}`;
      slide.appendChild(div);
      box.appendChild(slide);
    }
    const n = to - from + 1;
    $('#dots').innerHTML = n > 1 && n <= 30 ? Array.from({ length: n }, (_, i) => `<button data-i="${i}" aria-label="Страница ${i + 1}"></button>`).join('') : '';
    $('#dots').querySelectorAll('button').forEach((b) => (b.onclick = () => goToSlide(+b.dataset.i)));
    curIdx = 0;
    current = { doc, query, token, total, from };
    box.onscroll = () => {
      // свайп: текущий слайд = ближайший к левому краю
      const i = Math.round(box.scrollLeft / box.clientWidth);
      if (i !== curIdx) { curIdx = i; updatePageInd(); }
    };
    if (observer) observer.disconnect();
    // рисуем только страницы рядом с экраном, далёкие — выгружаем
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { if (needsDraw(e.target)) drawPage(e.target); }
        else if (e.target.dataset.rendered) unloadPage(e.target);
      }
    }, { root: box, rootMargin: '0px 150%' }); // соседние страницы готовим заранее
    box.querySelectorAll('.page').forEach((d) => observer.observe(d));
    updatePageInd();
  }

  // во сколько раз больше пикселей нужно, чем CSS-размер: экран + pinch-зум телефона
  function pixelRatio() {
    const pinch = window.visualViewport ? visualViewport.scale : 1;
    return Math.min((window.devicePixelRatio || 1) * Math.max(1, pinch), 8);
  }

  function needsDraw(div) {
    if (!div.dataset.rendered) return true;
    if (!div.dataset.width) return false; // ещё рисуется — проверим по окончании
    if (Math.abs(div.clientWidth - +div.dataset.width) > 2) return true;
    // перерисовываем, только если чёткость заметно отстаёт (или сильно избыточна)
    const want = Math.min(pixelRatio(), +div.dataset.maxRatio || Infinity);
    const have = +div.dataset.ratio;
    return want > have * 1.15 || want < have / 2;
  }

  function unloadPage(div) {
    const c = div.querySelector('canvas');
    if (c) { c.width = 0; c.height = 0; } // Safari освобождает память только так
    div.innerHTML = '';
    div.classList.add('loading');
    delete div.dataset.rendered;
  }

  function isNear(div) {
    const viewer = $('#viewer');
    const r = div.parentNode.getBoundingClientRect();
    const v = viewer.getBoundingClientRect();
    return r.right > v.left - 1.5 * v.width && r.left < v.right + 1.5 * v.width;
  }

  function refreshPages() {
    document.querySelectorAll('.page').forEach((d) => {
      if (!isNear(d)) { if (d.dataset.rendered) unloadPage(d); }
      else if (needsDraw(d)) drawPage(d);
    });
  }

  async function drawPage(div) {
    const { doc, query, token } = current;
    const drawId = (div._drawId || 0) + 1;
    div._drawId = drawId;
    div.dataset.rendered = '1';
    const page = await doc.getPage(+div.dataset.page);
    if (token !== renderToken || div._drawId !== drawId) return;
    if (!div.isConnected) return;
    const cssWidth = div.clientWidth;
    const scale = cssWidth / page.getViewport({ scale: 1 }).width;
    const viewport = page.getViewport({ scale });
    const maxRatio = Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height));
    const ratio = Math.min(pixelRatio(), maxRatio);
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    try {
      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null,
      }).promise;
    } catch (e) { return; }
    if (token !== renderToken || div._drawId !== drawId) { canvas.width = 0; return; }
    // меняем картинку только когда новая готова — без мигания
    const old = div.querySelector('canvas');
    if (old) { old.width = 0; old.height = 0; }
    div.classList.remove('loading');
    div.innerHTML = `<span class="pno">${div.dataset.page}</span>`;
    div.prepend(canvas);
    div.dataset.width = cssWidth;
    div.dataset.ratio = ratio;
    div.dataset.maxRatio = maxRatio;

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
    // пока рисовали, масштаб могли поменять — догоняем
    if (div._drawId === drawId && needsDraw(div)) drawPage(div);
  }

  // «2 / 4» в панели, точки под страницей, подпись кнопки на последней странице
  function updatePageInd() {
    const ind = $('#pageInd');
    const all = slides();
    if (!ind || !current || !all.length) return;
    const n = all.length;
    const pdfPage = all[curIdx].firstChild.dataset.page;
    ind.textContent = `${curIdx + 1} / ${n}`;
    ind.title = `стр. ${pdfPage} из ${current.total} в PDF`;
    document.querySelectorAll('#dots button').forEach((b, i) => b.classList.toggle('active', i === curIdx));
    const last = curIdx >= n - 1;
    const nextBtn = $('#nextPage');
    nextBtn.title = last ? (flip.nextTitle ? `Следующая тема: ${flip.nextTitle}` : 'Это последняя тема') : 'Следующая страница (→)';
    const toTopic = last && !!flip.nextTopic;
    nextBtn.classList.toggle('sq', !toTopic);
    nextBtn.innerHTML = toTopic ? `<span class="hide-sm">Следующая тема</span><span class="show-sm">Тема</span> ${chevron}` : chevron;
    nextBtn.disabled = last && !flip.nextTopic;
    $('#prevPage').disabled = curIdx === 0 && !flip.prevTopic;
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

  // поменялась ширина окна, масштаб браузера или pinch-зум на телефоне —
  // догоняем чёткость (перерисовываются только страницы рядом с экраном)
  let resizeTimer;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const viewer = $('#viewer');
      if (!viewer) return;
      viewer.scrollLeft = curIdx * viewer.clientWidth; // ширина поменялась — остаёмся на той же странице
      refreshPages();
    }, 300);
  };
  window.addEventListener('resize', onResize);
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', onResize);
    visualViewport.addEventListener('scroll', onResize); // при зуме пальцами двигаемся по странице
  }

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
  const root = document.documentElement;
  const effectiveTheme = () => root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const syncThemeBtns = () => document.querySelectorAll('[data-set-theme]').forEach((b) =>
    b.classList.toggle('active', b.dataset.setTheme === effectiveTheme()));
  document.querySelectorAll('[data-set-theme]').forEach((b) => (b.onclick = () => {
    root.dataset.theme = b.dataset.setTheme;
    try { localStorage.setItem('theme', root.dataset.theme); } catch (e) { /* ignore */ }
    syncThemeBtns();
  }));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeBtns);
  syncThemeBtns();

  // кнопка «наверх»
  const upBtn = $('#upBtn');
  upBtn.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  window.addEventListener('scroll', () => upBtn.classList.toggle('show', scrollY > 600), { passive: true });

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
    const accentOf = subject || catalog.subjects.find((x) => x.id === store.get('lastSubject')) || catalog.subjects[0];
    root.style.setProperty('--accent', (accentOf && accentOf.color) || DEFAULT_COLOR);
    const key = parts.join('/');
    if (key !== lastKey) window.scrollTo(0, 0);
    lastKey = key;
    if (!sId) return viewHome();
    if (!subject) return (main.innerHTML = '<div><h1>Не найдено</h1><a href="#/">На главную</a></div>');
    if (!lId) return viewSubject(subject);
    if (!lecture) return (main.innerHTML = `<div><h1>Лекция не найдена</h1><a href="#/${sId}">К предмету</a></div>`);
    if (!secId) return viewLecture(subject, lecture);
    if (secId === 'all') return viewSection(subject, lecture, wholeLecture(lecture), params);
    if (!section) return viewLecture(subject, lecture);
    viewSection(subject, lecture, section, params);
  }

  fetch('data/catalog.json')
    .then((r) => r.json())
    .then((c) => { catalog = c; window.addEventListener('hashchange', route); route(); })
    .catch((e) => { main.innerHTML = `<p class="muted">Не удалось загрузить каталог: ${esc(e.message)}. Открой сайт через веб-сервер (см. README).</p>`; });
})();
