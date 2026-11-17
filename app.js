const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const view = $('#view');
const state = {
    index: null,
    notesById: new Map(),
    cache: new Map(),
    sort: localStorage.getItem('wg.sort') || 'updated',
    limit: 40,
    lastRead: readLastRead(),
    mermaid: null,
    diagramSeq: 0,
    route: null,
    key: null,
    imgUrls: new Map(),
};

function readLastRead() {
    try {
        return JSON.parse(localStorage.getItem('wg.lastRead') || 'null');
    } catch {
        return null;
    }
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[c]);
}

function formatChars(n) {
    return n >= 10000 ? `${(n / 10000).toFixed(1)} 万字` : `${n} 字`;
}

function noteHref(id, anchor) {
    return `#/n/${encodeURIComponent(id)}${anchor ? `/${encodeURIComponent(anchor)}` : ''}`;
}

function catHref(cat) {
    return `#/c/${encodeURIComponent(cat)}`;
}

function groupHref(cat, group) {
    return `#/c/${encodeURIComponent(cat)}/${encodeURIComponent(group)}`;
}

/* ---------------- routing ---------------- */
function parseRoute() {
    const raw = location.hash.replace(/^#\/?/, '');
    if (!raw) return {name: 'home'};
    const parts = raw.split('/').map((p) => decodeURIComponent(p));
    const [head, a, b] = parts;
    if (head === 'n' && a) return {name: 'note', id: a, anchor: b || ''};
    if (head === 'c' && a) return {name: 'category', cat: a, group: b || ''};
    if (head === 'd' && a) return {name: 'domain', domain: a};
    if (head === 'search' && a) return {name: 'search', query: a};
    if (head === 'recent') return {name: 'recent'};
    return {name: 'home'};
}

async function route() {
    const r = parseRoute();
    if (state.route?.name === 'note' && (r.name !== 'note' || r.id !== state.route.id)) releaseImages();
    state.route = r;
    state.limit = 40;
    closeSidebar();
    if (r.name === 'note') await renderNote(r.id, r.anchor);
    else if (r.name === 'category') renderCategory(r.cat, r.group);
    else if (r.name === 'domain') renderDomain(r.domain);
    else if (r.name === 'search') renderSearchPage(r.query);
    else if (r.name === 'recent') renderRecent();
    else renderHome();
    updateSidebarActive();
    $('#progress').hidden = r.name !== 'note';
    if (r.name !== 'note') window.scrollTo({top: 0, behavior: 'instant'});
}

/* ---------------- data ---------------- */
async function loadIndex() {
    const {key, index} = await WGCrypto.unlock();
    state.key = key;
    state.index = index;
    for (const n of state.index.notes) state.notesById.set(n.id, n);
    buildSidebar();
    buildSearchDocs();
}

async function loadNote(id) {
    if (state.cache.has(id)) return state.cache.get(id);
    const file = state.index.noteFiles?.[id];
    if (!file) throw new Error('笔记加载失败');
    const res = await fetch(`data/${file}`);
    if (!res.ok) throw new Error('笔记加载失败');
    const data = await WGCrypto.decryptJson(state.key, await res.arrayBuffer());
    state.cache.set(id, data);
    return data;
}

function groupNotes(catId, groupKey) {
    const cat = state.index.categories.find((c) => c.id === catId);
    if (!cat) return [];
    const groups = groupKey ? cat.groups.filter((g) => g.id === groupKey) : cat.groups;
    return groups.flatMap((g) => g.notes.map((id) => state.notesById.get(id)).filter(Boolean));
}

function sortNotes(notes) {
    const list = [...notes];
    if (state.sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
    else if (state.sort === 'chars') list.sort((a, b) => b.chars - a.chars);
    else list.sort((a, b) => (b.updated || '').localeCompare(a.updated || '') || a.title.localeCompare(b.title, 'zh'));
    return list;
}

/* ---------------- sidebar ---------------- */
function buildSidebar() {
    const {stats, categories, domains, notes} = state.index;
    $('[data-count="all"]').textContent = notes.length;
    $('[data-count="recent"]').textContent = Math.min(20, notes.length);
    $('#sidebarStats').textContent = `${stats.notes} 篇 · ${(stats.chars / 10000).toFixed(1)} 万字`;

    $('#domainList').innerHTML = domains.map((d) =>
        `<button type="button" class="domain-chip" data-domain="${escapeHtml(d.id)}" aria-pressed="false">${escapeHtml(d.id)}<span class="mono-label" style="margin-left:6px">${d.count}</span></button>`
    ).join('');
    $('#domainList').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-domain]');
        if (!btn) return;
        const domain = btn.dataset.domain;
        location.hash = state.route?.name === 'domain' && state.route.domain === domain ? '#/' : `#/d/${encodeURIComponent(domain)}`;
    });

    $('#categoryTree').innerHTML = categories.map((cat) => `
    <div class="cat" data-cat="${escapeHtml(cat.id)}" data-open="false">
      <div class="cat-row">
        <button type="button" class="cat-expander" aria-expanded="false" aria-label="展开 ${escapeHtml(cat.label)}">
          <svg class="chev" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="m4 2 4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <a class="cat-link" href="${catHref(cat.id)}">${escapeHtml(cat.label)}</a>
        <span class="cat-count">${cat.count}</span>
      </div>
      <div class="cat-groups">
        ${cat.groups.map((g) => `<a class="group-link" data-group="${escapeHtml(g.id)}" href="${groupHref(cat.id, g.id)}"><span>${escapeHtml(g.label)}</span><span class="g-count">${g.notes.length}</span></a>`).join('')}
      </div>
    </div>`).join('');

    $('#categoryTree').addEventListener('click', (e) => {
        const expander = e.target.closest('.cat-expander');
        if (!expander) return;
        const cat = expander.closest('.cat');
        const open = cat.dataset.open !== 'true';
        cat.dataset.open = String(open);
        expander.setAttribute('aria-expanded', String(open));
        expander.setAttribute('aria-label', `${open ? '收起' : '展开'} ${$('.cat-link', cat).textContent}`);
    });
}

function updateSidebarActive() {
    const r = state.route;
    $$('.nav-item').forEach((a) => {
        const active = (a.dataset.nav === 'home' && ['home', 'category', 'domain', 'search'].includes(r.name)) || (a.dataset.nav === 'recent' && r.name === 'recent');
        if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    $$('.domain-chip').forEach((chip) => chip.setAttribute('aria-pressed', String(r.name === 'domain' && chip.dataset.domain === r.domain)));
    $$('.cat').forEach((cat) => {
        const active = r.name === 'category' && cat.dataset.cat === r.cat;
        cat.dataset.active = String(active);
        if (active) {
            cat.dataset.open = 'true';
            $('.cat-expander', cat).setAttribute('aria-expanded', 'true');
        }
        $$('.group-link', cat).forEach((link) => {
            if (active && link.dataset.group === r.group) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
    });
}

function openSidebar() {
    $('#sidebar').dataset.open = 'true';
    $('#scrim').hidden = false;
    $('#menuBtn').setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
    $('#sidebar').dataset.open = 'false';
    $('#scrim').hidden = true;
    $('#menuBtn').setAttribute('aria-expanded', 'false');
}

/* ---------------- shared pieces ---------------- */
function badgesHtml(badges) {
    if (!badges?.length) return '';
    return `<span class="badges">${badges.map((b) => `<span class="badge" style="--badge-color:${escapeHtml(b.color)}">${b.label ? `<span class="badge-label">${escapeHtml(b.label)}</span>` : ''}<span class="badge-value">${escapeHtml(b.value)}</span></span>`).join('')}</span>`;
}

function noteRow(note, extra = '') {
    const cat = state.index.categories.find((c) => c.id === note.cat);
    return `<a class="note-row" href="${noteHref(note.id)}">
    <div class="note-row-head">
      <h3 class="note-row-title">${escapeHtml(note.title)}</h3>
      <span class="note-row-group">${escapeHtml(cat?.label ?? note.cat)}${note.groupLabel && note.group !== '_root' ? ` / ${escapeHtml(note.groupLabel)}` : ''}</span>
    </div>
    ${note.summary ? `<p class="note-row-summary">${escapeHtml(note.summary)}</p>` : ''}
    <div class="note-row-foot">
      ${badgesHtml(note.badges)}
      <span class="note-meta">${formatChars(note.chars)}<span class="dot">·</span>${note.minutes} 分钟<span class="dot">·</span>${escapeHtml(note.updated || '')}</span>
      ${extra}
    </div>
  </a>`;
}

function statsHtml() {
    const s = state.index.stats;
    return `<div class="stats">
    <div class="stat"><p class="mono-label">笔记</p><p class="stat-value">${s.notes}<em>篇</em></p></div>
    <div class="stat"><p class="mono-label">分类</p><p class="stat-value">${s.categories}<em>个</em></p></div>
    <div class="stat"><p class="mono-label">总字数</p><p class="stat-value">${(s.chars / 10000).toFixed(1)}<em>万</em></p></div>
    <div class="stat"><p class="mono-label">图表</p><p class="stat-value">${s.diagrams}<em>张</em></p></div>
    <div class="stat"><p class="mono-label">最近更新</p><p class="stat-value" style="font-size:calc(19px * var(--site-type,1))">${escapeHtml(s.latest)}</p></div>
  </div>`;
}

function resumeHtml() {
    const last = state.lastRead;
    if (!last || !state.notesById.has(last.id)) return '';
    const note = state.notesById.get(last.id);
    return `<a class="resume" href="${noteHref(note.id)}">
    <div class="resume-body">
      <p class="mono-label" style="color:var(--accent)">继续阅读</p>
      <p class="resume-title">${escapeHtml(note.title)}</p>
      <p class="resume-meta">${escapeHtml(note.groupLabel === '综合' ? state.index.categories.find((c) => c.id === note.cat)?.label ?? '' : note.groupLabel)} · ${note.minutes} 分钟</p>
    </div>
    <span class="resume-go">继续 →</span>
  </a>`;
}

function toolbarHtml(title, count, {chips = ''} = {}) {
    return `<div class="toolbar">
    <h2 class="toolbar-title">${escapeHtml(title)}</h2>
    <span class="toolbar-count">${count} 篇</span>
    ${chips}
    <span class="toolbar-spacer"></span>
    <label class="mono-label" for="sortSelect">排序</label>
    <select class="select" id="sortSelect">
      <option value="updated"${state.sort === 'updated' ? ' selected' : ''}>最近更新</option>
      <option value="title"${state.sort === 'title' ? ' selected' : ''}>标题</option>
      <option value="chars"${state.sort === 'chars' ? ' selected' : ''}>篇幅</option>
    </select>
  </div>`;
}

function bindSort(rerender) {
    const select = $('#sortSelect');
    if (!select) return;
    select.addEventListener('change', () => {
        state.sort = select.value;
        localStorage.setItem('wg.sort', state.sort);
        rerender();
    });
}

function listHtml(notes) {
    if (!notes.length) return `<div class="empty"><p class="mono-label">暂无笔记</p><p>换个分类或关键词试试。</p></div>`;
    const shown = notes.slice(0, state.limit);
    const more = notes.length > state.limit
        ? `<button type="button" class="domain-chip" id="loadMore" style="margin:24px auto;display:block;padding:8px 24px">加载更多（剩余 ${notes.length - state.limit} 篇）</button>`
        : '';
    return `<div class="note-list">${shown.map((n) => noteRow(n)).join('')}</div>${more}`;
}

function bindMore(notes, container) {
    const btn = $('#loadMore');
    if (!btn) return;
    btn.addEventListener('click', () => {
        state.limit += 40;
        container.innerHTML = listHtml(notes);
        bindMore(notes, container);
    });
}

function setCrumbs(items) {
    $('#crumbs').innerHTML = items.map((item, i) => {
        const sep = i ? '<span class="sep">/</span>' : '';
        return item.href
            ? `${sep}<a href="${item.href}">${escapeHtml(item.label)}</a>`
            : `${sep}<span class="current">${escapeHtml(item.label)}</span>`;
    }).join('');
}

/* ---------------- list views ---------------- */
function renderHome() {
    const notes = sortNotes(state.index.notes);
    setCrumbs([{label: '全部笔记'}]);
    view.innerHTML = `
    <div class="page-head">
      <p class="mono-label">Watergrass Notes / 知识库</p>
      <h1 class="page-title">全部笔记</h1>
      <p class="page-sub">千里水草的全科学习笔记，「问题 → 笔记」的八段式写法。按分类浏览，或搜索标题、章节与速查口诀。</p>
    </div>
    ${statsHtml()}
    ${resumeHtml()}
    ${toolbarHtml('笔记列表', notes.length)}
    <div id="listContainer">${listHtml(notes)}</div>`;
    bindSort(renderHome);
    bindMore(notes, $('#listContainer'));
}

function renderRecent() {
    const notes = [...state.index.notes].sort((a, b) => (b.updated || '').localeCompare(a.updated || '')).slice(0, 20);
    setCrumbs([{label: '最近更新'}]);
    view.innerHTML = `
    <div class="page-head">
      <p class="mono-label">Recent / 最近改动</p>
      <h1 class="page-title">最近更新</h1>
      <p class="page-sub">按仓库最后提交日期排序的 20 篇笔记。</p>
    </div>
    <div class="note-list">${notes.map((n) => noteRow(n)).join('')}</div>`;
}

function renderCategory(catId, groupKey) {
    const cat = state.index.categories.find((c) => c.id === catId);
    if (!cat) {
        renderHome();
        return;
    }
    const group = cat.groups.find((g) => g.id === groupKey);
    const notes = sortNotes(groupNotes(catId, groupKey));
    setCrumbs([{label: '全部笔记', href: '#/'}, {
        label: cat.label,
        href: catHref(cat.id)
    }, ...(group ? [{label: group.label}] : [])]);
    const chips = cat.groups.length > 1
        ? `<div class="domain-list" style="width:100%;padding:0">${cat.groups.map((g) => `<button type="button" class="domain-chip" data-group-chip="${escapeHtml(g.id)}" aria-pressed="${g.id === groupKey}">${escapeHtml(g.label)} ${g.notes.length}</button>`).join('')}</div>`
        : '';
    view.innerHTML = `
    <div class="page-head">
      <p class="mono-label">${escapeHtml(cat.id)}</p>
      <h1 class="page-title">${escapeHtml(group ? group.label : cat.label)}</h1>
      <p class="page-sub">${group ? `${escapeHtml(cat.label)} · ${notes.length} 篇笔记` : `${cat.groups.length} 个分组 · ${cat.count} 篇笔记`}</p>
    </div>
    ${toolbarHtml(group ? group.label : '全部', notes.length, {chips})}
    <div id="listContainer">${listHtml(notes)}</div>`;
    bindSort(() => renderCategory(catId, groupKey));
    bindMore(notes, $('#listContainer'));
    $$('[data-group-chip]').forEach((chip) => chip.addEventListener('click', () => {
        location.hash = chip.dataset.groupChip === groupKey ? catHref(cat.id) : groupHref(cat.id, chip.dataset.groupChip);
    }));
}

function renderDomain(domain) {
    const notes = sortNotes(state.index.notes.filter((n) => n.domain === domain));
    setCrumbs([{label: '全部笔记', href: '#/'}, {label: domain}]);
    view.innerHTML = `
    <div class="page-head">
      <p class="mono-label">领域 / Domain</p>
      <h1 class="page-title">${escapeHtml(domain)}</h1>
      <p class="page-sub">该领域下的 ${notes.length} 篇笔记。</p>
    </div>
    ${toolbarHtml(domain, notes.length)}
    <div id="listContainer">${listHtml(notes)}</div>`;
    bindSort(() => renderDomain(domain));
    bindMore(notes, $('#listContainer'));
}

/* ---------------- search ---------------- */
let searchDocs = [];

function buildSearchDocs() {
    searchDocs = [];
    for (const note of state.index.notes) {
        const cat = state.index.categories.find((c) => c.id === note.cat);
        const catLabel = cat?.label ?? note.cat;
        searchDocs.push({
            kind: '笔记', noteId: note.id, anchor: '', title: note.title,
            sub: `${catLabel}${note.group !== '_root' ? ` / ${note.groupLabel}` : ''}`,
            haystack: `${note.title} ${note.groupLabel} ${catLabel} ${note.badges.map((b) => `${b.label} ${b.value}`).join(' ')} ${note.summary}`.toLowerCase(),
            titleLc: note.title.toLowerCase(), weight: 3,
        });
        for (const h of note.headings) {
            if (!h.text || h.text === '目录') continue;
            searchDocs.push({
                kind: '章节', noteId: note.id, anchor: h.id, title: h.text, sub: note.title,
                haystack: h.text.toLowerCase(), titleLc: h.text.toLowerCase(), weight: 2,
            });
        }
        const cheatAnchor = note.headings.find((h) => h.text.includes('速查口诀'))?.id || '';
        for (const line of note.cheatsheet) {
            searchDocs.push({
                kind: '口诀', noteId: note.id, anchor: cheatAnchor, title: line, sub: `${note.title} · 速查口诀`,
                haystack: line.toLowerCase(), titleLc: line.toLowerCase(), weight: 1,
            });
        }
    }
}

function search(query, cap = 40) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const scored = [];
    for (const doc of searchDocs) {
        if (!terms.every((t) => doc.haystack.includes(t))) continue;
        let score = doc.weight * 10;
        if (terms.every((t) => doc.titleLc.includes(t))) score += 40;
        if (doc.titleLc.startsWith(terms[0])) score += 30;
        if (doc.kind === '笔记' && terms.every((t) => doc.titleLc.includes(t))) score += 25;
        score -= Math.min(20, doc.title.length / 8);
        scored.push({doc, score});
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, cap).map((s) => s.doc);
}

function highlight(text, query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const safe = escapeHtml(text);
    if (!terms.length) return safe;
    const pattern = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return safe.replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>');
}

function renderSearchPage(query) {
    const results = search(query, 80);
    setCrumbs([{label: '全部笔记', href: '#/'}, {label: `搜索：${query}`}]);
    view.innerHTML = `
    <div class="page-head">
      <p class="mono-label">Search / 检索结果</p>
      <h1 class="page-title">「${escapeHtml(query)}」</h1>
      <p class="page-sub">命中 ${results.length} 条标题、章节与口诀。</p>
    </div>
    ${results.length ? `<div class="note-list">${results.map((doc) => `
      <a class="note-row" href="${noteHref(doc.noteId, doc.anchor)}">
        <div class="note-row-head">
          <h3 class="note-row-title">${highlight(doc.title, query)}</h3>
          <span class="note-row-group">${escapeHtml(doc.kind)}</span>
        </div>
        <p class="note-row-summary">${escapeHtml(doc.sub)}</p>
      </a>`).join('')}</div>`
        : `<div class="empty"><p class="mono-label">没有命中</p><p>试试更短的关键词，例如「MVCC」「跳表」「口诀」。</p></div>`}`;
}

/* ---------------- palette ---------------- */
const palette = $('#palette');
const paletteInput = $('#paletteInput');
const paletteResults = $('#paletteResults');
let paletteItems = [];
let paletteActive = 0;
let lastFocus = null;

function openPalette() {
    lastFocus = document.activeElement;
    palette.hidden = false;
    paletteInput.value = '';
    renderPalette('');
    paletteInput.focus();
}

function closePalette() {
    palette.hidden = true;
    if (lastFocus?.isConnected) lastFocus.focus();
}

function renderPalette(query) {
    if (!query.trim()) {
        const recent = state.lastRead && state.notesById.has(state.lastRead.id) ? [state.notesById.get(state.lastRead.id)] : [];
        const picks = [...recent, ...[...state.index.notes].sort((a, b) => (b.updated || '').localeCompare(a.updated || '')).slice(0, recent.length ? 7 : 8)];
        paletteItems = picks.map((n) => ({
            kind: '笔记',
            noteId: n.id,
            anchor: '',
            title: n.title,
            sub: n.summary || n.groupLabel
        }));
        paletteResults.innerHTML = `<p class="palette-group mono-label">${recent.length ? '继续阅读与最近更新' : '最近更新'}</p>` +
            paletteItems.map((doc, i) => resultHtml(doc, i, '')).join('');
        $('#paletteCount').textContent = `${paletteItems.length} 条`;
    } else {
        paletteItems = search(query, 40);
        paletteResults.innerHTML = paletteItems.length
            ? paletteItems.map((doc, i) => resultHtml(doc, i, query)).join('')
            : `<p class="palette-empty">没有命中「${escapeHtml(query)}」<br><span class="mono-label" style="display:block;margin-top:8px">试试标题、章节名或口诀关键词</span></p>`;
        $('#paletteCount').textContent = `${paletteItems.length} 条`;
    }
    paletteActive = 0;
    markActive();
}

function resultHtml(doc, i, query) {
    return `<button type="button" class="result" role="option" data-index="${i}" aria-selected="false">
    <span class="result-body">
      <span class="result-title">${highlight(doc.title, query)}</span>
      <span class="result-sub">${escapeHtml(doc.sub)}</span>
    </span>
    <span class="result-kind">${escapeHtml(doc.kind)}</span>
  </button>`;
}

function markActive() {
    $$('.result', paletteResults).forEach((el) => {
        const active = Number(el.dataset.index) === paletteActive;
        el.dataset.active = String(active);
        el.setAttribute('aria-selected', String(active));
        if (active) el.scrollIntoView({block: 'nearest'});
    });
}

function openResult(index) {
    const doc = paletteItems[index];
    if (!doc) return;
    closePalette();
    const target = noteHref(doc.noteId, doc.anchor);
    if (location.hash === target) route();
    else location.hash = target;
}

paletteInput.addEventListener('input', () => renderPalette(paletteInput.value));
paletteInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        paletteActive = Math.min(paletteItems.length - 1, paletteActive + 1);
        markActive();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        paletteActive = Math.max(0, paletteActive - 1);
        markActive();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        openResult(paletteActive);
    }
});
paletteResults.addEventListener('click', (e) => {
    const btn = e.target.closest('.result');
    if (btn) openResult(Number(btn.dataset.index));
});
palette.addEventListener('mousedown', (e) => {
    if (e.target === palette) closePalette();
});
$('#searchTrigger').addEventListener('click', openPalette);
$('#topbarSearch').addEventListener('click', openPalette);

document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        palette.hidden ? openPalette() : closePalette();
        return;
    }
    if (e.key === 'Escape') {
        if (!palette.hidden) {
            closePalette();
            return;
        }
        if (!$('#lightbox').hidden) {
            closeLightbox();
            return;
        }
        closeSidebar();
        return;
    }
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && palette.hidden && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        e.preventDefault();
        openPalette();
    }
});

/* ---------------- reader ---------------- */
async function renderNote(id, anchor) {
    const meta = state.notesById.get(id);
    if (!meta) {
        renderHome();
        return;
    }
    const cat = state.index.categories.find((c) => c.id === meta.cat);
    setCrumbs([
        {label: '全部笔记', href: '#/'},
        {label: cat?.label ?? meta.cat, href: catHref(meta.cat)},
        ...(meta.group !== '_root' ? [{label: meta.groupLabel, href: groupHref(meta.cat, meta.group)}] : []),
        {label: meta.title},
    ]);
    view.innerHTML = `<div class="loading"><span class="spinner" aria-hidden="true"></span><p class="mono-label">正在载入笔记</p></div>`;

    let data;
    try {
        data = await loadNote(id);
    } catch {
        view.innerHTML = `<div class="empty"><p class="mono-label">加载失败</p><p>无法读取这篇笔记，请刷新重试。</p></div>`;
        return;
    }
    if (state.route?.name !== 'note' || state.route.id !== id) return;

    const siblings = groupNotes(meta.cat, meta.group === '_root' ? '' : meta.group);
    const order = (siblings.length > 1 ? siblings : groupNotes(meta.cat, '')).map((n) => n.id);
    const pos = order.indexOf(id);
    const prev = pos > 0 ? state.notesById.get(order[pos - 1]) : null;
    const next = pos >= 0 && pos < order.length - 1 ? state.notesById.get(order[pos + 1]) : null;
    const toc = meta.headings.filter((h) => (h.level === 2 || h.level === 3) && h.text !== '目录');

    view.innerHTML = `<div class="reader">
    <div class="reader-main">
      <div class="reader-meta">
        <span class="mono-label">${escapeHtml(meta.updated || '')}</span>
        <span class="note-meta">${formatChars(meta.chars)}<span class="dot">·</span>${meta.minutes} 分钟读完</span>
        <span class="toolbar-spacer"></span>
        <button type="button" class="toc-toggle" id="tocToggle" aria-expanded="false" aria-controls="tocMobile">目录 ${toc.length}</button>
      </div>
      <nav class="toc toc-mobile" id="tocMobile" hidden aria-label="本页目录">
        <p class="mono-label toc-title">目录</p>
        ${tocListHtml(toc)}
      </nav>
      <article class="article" id="article">${data.html}</article>
      <div class="reader-footer">
        ${prev ? `<a class="pager" data-dir="prev" href="${noteHref(prev.id)}"><span class="mono-label">← 上一篇</span><span class="pager-title">${escapeHtml(prev.title)}</span></a>` : '<span></span>'}
        ${next ? `<a class="pager" data-dir="next" href="${noteHref(next.id)}"><span class="mono-label">下一篇 →</span><span class="pager-title">${escapeHtml(next.title)}</span></a>` : '<span></span>'}
      </div>
    </div>
    <nav class="toc" id="toc" aria-label="本页目录">
      <p class="mono-label toc-title">目录</p>
      ${tocListHtml(toc)}
    </nav>
  </div>`;

    localStorage.setItem('wg.lastRead', JSON.stringify({id, title: meta.title, at: Date.now()}));
    state.lastRead = {id, title: meta.title};

    bindArticle($('#article'), data);
    const toggle = $('#tocToggle');
    toggle?.addEventListener('click', () => {
        const mobile = $('#tocMobile');
        mobile.hidden = !mobile.hidden;
        toggle.setAttribute('aria-expanded', String(!mobile.hidden));
    });
    setupScrollSpy(toc);
    if (data.diagrams?.length) renderDiagrams(data.diagrams);

    window.scrollTo({top: 0, behavior: 'instant'});
    if (anchor) {
        const target = document.getElementById(anchor);
        if (target) requestAnimationFrame(() => target.scrollIntoView({block: 'start', behavior: 'instant'}));
    }
}

function tocListHtml(toc) {
    if (!toc.length) return '<p class="toc-empty">这篇笔记没有分节标题。</p>';
    return `<ul class="toc-list">${toc.map((h) => `<li><a href="#${h.id}" data-level="${h.level}" data-anchor-link="${h.id}">${escapeHtml(h.text)}</a></li>`).join('')}</ul>`;
}

function releaseImages() {
    for (const url of state.imgUrls.values()) URL.revokeObjectURL(url);
    state.imgUrls.clear();
}

function hydrateImages(article) {
    const targets = $$('img[data-img]', article);
    if (!targets.length) return;
    const load = async (img) => {
        const hash = img.dataset.img;
        try {
            let url = state.imgUrls.get(hash);
            if (!url) {
                const res = await fetch(`assets/img/${hash}.bin`);
                if (!res.ok) throw new Error(String(res.status));
                const bytes = await WGCrypto.decryptBytes(state.key, await res.arrayBuffer());
                url = URL.createObjectURL(new Blob([bytes], {type: state.index.images?.[hash] || 'image/webp'}));
                state.imgUrls.set(hash, url);
            }
            img.src = url;
        } catch {
            img.replaceWith(Object.assign(document.createElement('span'), {
                className: 'img-missing',
                textContent: '图片解密失败',
            }));
        }
    };
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            load(entry.target);
        }
    }, {rootMargin: '300px 0px'});
    for (const img of targets) {
        if (state.imgUrls.has(img.dataset.img)) img.src = state.imgUrls.get(img.dataset.img);
        else observer.observe(img);
    }
}

function bindArticle(article, data) {
    hydrateImages(article);
    article.addEventListener('click', (e) => {
        const copy = e.target.closest('[data-copy]');
        if (copy) {
            const code = $('pre code', copy.closest('.codeblock'));
            navigator.clipboard?.writeText(code.textContent).then(() => {
                copy.textContent = '已复制';
                copy.dataset.done = 'true';
                setTimeout(() => {
                    copy.textContent = '复制';
                    delete copy.dataset.done;
                }, 1600);
            }).catch(() => {
                copy.textContent = '复制失败';
            });
            return;
        }
        const img = e.target.closest('img');
        if (img) {
            openLightbox(img.src, img.alt);
            return;
        }
        const anchor = e.target.closest('a[data-anchor], a[href^="#h-"]');
        if (anchor) {
            e.preventDefault();
            const target = document.getElementById(anchor.getAttribute('href').slice(1));
            if (target) target.scrollIntoView({
                block: 'start',
                behavior: prefersReducedMotion() ? 'instant' : 'smooth'
            });
        }
    });
}

function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function setupScrollSpy(toc) {
    const article = $('#article');
    const links = $$('#toc a[data-anchor-link]');
    const mobileLinks = $$('#tocMobile a[data-anchor-link]');
    const heads = toc.map((h) => document.getElementById(h.id)).filter(Boolean);
    let ticking = false;
    const update = () => {
        ticking = false;
        if (!article || state.route?.name !== 'note') return;
        const rect = article.getBoundingClientRect();
        const total = rect.height - window.innerHeight;
        const progress = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 1;
        $('#progressBar').style.width = `${progress * 100}%`;
        let current = heads[0]?.id;
        for (const head of heads) {
            if (head.getBoundingClientRect().top <= 120) current = head.id;
            else break;
        }
        for (const link of [...links, ...mobileLinks]) {
            if (link.dataset.anchorLink === current) link.setAttribute('aria-current', 'true');
            else link.removeAttribute('aria-current');
        }
    };
    const onScroll = () => {
        if (!ticking) {
            ticking = true;
            requestAnimationFrame(update);
        }
    };
    window.addEventListener('scroll', onScroll, {passive: true});
    window.addEventListener('resize', onScroll);
    state.cleanupSpy = () => {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
    };
    update();
}

async function renderDiagrams(codes) {
    const blocks = $$('.diagram');
    if (!blocks.length) return;
    blocks.forEach((b) => b.dataset.state = 'pending');
    try {
        if (!state.mermaid) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'vendor/mermaid.min.js';
                script.onload = resolve;
                script.onerror = () => reject(new Error('mermaid 加载失败'));
                document.head.appendChild(script);
            });
            state.mermaid = window.mermaid;
            state.mermaid.initialize({
                startOnLoad: false,
                securityLevel: 'strict',
                theme: 'base',
                fontFamily: getComputedStyle(document.body).fontFamily,
                themeVariables: {
                    darkMode: true,
                    background: '#1c1c1c',
                    primaryColor: '#232323',
                    primaryTextColor: '#fafafa',
                    primaryBorderColor: '#3ecf8e',
                    lineColor: '#898989',
                    secondaryColor: '#2a2a2a',
                    tertiaryColor: '#202020',
                    mainBkg: '#232323',
                    nodeBorder: '#3ecf8e',
                    clusterBkg: '#1f1f1f',
                    clusterBorder: '#2e2e2e',
                    edgeLabelBackground: '#171717',
                    textColor: '#fafafa',
                    fontSize: '14px',
                },
            });
        }
        for (const block of blocks) {
            const code = codes[Number(block.dataset.diagram)];
            const canvas = $('.diagram-canvas', block);
            if (!code || !canvas) continue;
            try {
                const {svg} = await state.mermaid.render(`mmd-${state.diagramSeq++}`, code);
                canvas.innerHTML = svg;
                block.dataset.state = 'done';
            } catch {
                block.dataset.state = 'error';
            }
        }
    } catch {
        blocks.forEach((b) => b.dataset.state = 'error');
    }
}

/* ---------------- lightbox ---------------- */
function openLightbox(src, alt) {
    $('#lightboxImg').src = src;
    $('#lightboxImg').alt = alt || '笔记配图';
    $('#lightbox').hidden = false;
    $('#lightboxClose').focus();
}

function closeLightbox() {
    $('#lightbox').hidden = true;
    $('#lightboxImg').src = '';
}

$('#lightbox').addEventListener('click', (e) => {
    if (e.target !== $('#lightboxImg')) closeLightbox();
});
$('#lightboxClose').addEventListener('click', closeLightbox);
$('#lightboxImg').addEventListener('click', closeLightbox);

/* ---------------- shell events ---------------- */
$('#menuBtn').addEventListener('click', () => {
    $('#sidebar').dataset.open === 'true' ? closeSidebar() : openSidebar();
});
$('#scrim').addEventListener('click', closeSidebar);
$('#sidebar').addEventListener('click', (e) => {
    if (e.target.closest('a')) closeSidebar();
});
window.addEventListener('hashchange', () => {
    state.cleanupSpy?.();
    route();
});

if (!/Mac|iPhone|iPad/.test(navigator.platform)) $('#searchKbd').textContent = 'Ctrl K';

/* ---------------- boot ---------------- */
loadIndex()
    .then(route)
    .catch((err) => {
        view.innerHTML = `<div class="empty"><p class="mono-label">知识库加载失败</p><p>${escapeHtml(err.message)}</p><p>请确认通过本地预览或已发布站点访问，而不是直接打开文件。</p></div>`;
    });