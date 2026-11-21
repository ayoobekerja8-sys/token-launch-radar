(function () {
  'use strict';

  var DATA = window.RADAR || {};
  var ROWS = Array.isArray(DATA.rows) ? DATA.rows : [];
  var WATCH = Array.isArray(DATA.watchlist) ? DATA.watchlist : [];
  var MODEL = DATA.model || {};
  var GLOBAL = typeof MODEL.global_median === 'number' ? MODEL.global_median : 0.246;
  var WATCH_SET = new Set(WATCH);
  var LIVE = Array.isArray(DATA.live) ? DATA.live : [];

  var els = {
    board: document.getElementById('rows'),
    empty: document.getElementById('empty'),
    count: document.getElementById('row-count'),
    search: document.getElementById('search'),
    category: document.getElementById('category'),
    chain: document.getElementById('chain'),
    sort: document.getElementById('sort'),
    watch: document.getElementById('watch-only'),
    stats: document.getElementById('stats'),
    subtitle: document.getElementById('subtitle'),
    version: document.getElementById('model-version'),
    colophon: document.getElementById('colophon'),
    panel: document.getElementById('detail'),
    scrim: document.getElementById('scrim')
  };

  var state = {
    q: '',
    category: '',
    chain: '',
    sort: 'implied',
    watchOnly: false,
    detail: null
  };

  function round(n, digits) {
    var f = Math.pow(10, digits);
    return Math.round(n * f) / f;
  }

  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }

  function pct(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return v.toFixed(1) + '%';
  }

  function age(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return Math.round(v) + 'd';
  }

  function mult(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return v.toFixed(3) + '×';
  }

  function chainList(list) {
    if (!Array.isArray(list) || list.length === 0) return '—';
    if (list.length <= 3) return list.join(', ');
    return list.slice(0, 3).join(', ') + ', +' + (list.length - 3);
  }

  function categoryOf(row) {
    return row.category || 'Uncategorised';
  }

  function sortedUnique(values) {
    return Array.from(new Set(values)).sort(function (a, b) {
      return a.localeCompare(b);
    });
  }

  /* ---------- header, stats, filters ---------- */

  function renderHead() {
    if (els.version) els.version.textContent = DATA.model_version || 'radar-3';
    if (els.subtitle) {
      els.subtitle.textContent =
        'Snapshot ' + (DATA.as_of || '—') + ' · snapshot-derived estimates';
    }
  }

  function counts() {
    var covered = 0;
    for (var i = 0; i < WATCH.length; i += 1) {
      for (var j = 0; j < ROWS.length; j += 1) {
        if (ROWS[j].slug === WATCH[i]) {
          covered += 1;
          break;
        }
      }
    }
    return covered;
  }

  function renderStats() {
    if (!els.stats) return;
    var covered = counts();
    var figures = [
      { label: 'Board rows', value: String(ROWS.length), accent: false, unit: DATA.early_size ? DATA.early_size + ' early stage' : '' },
      { label: 'Watchlist covered', value: covered + '/' + WATCH.length, accent: true, unit: 'every protocol on the list' },
      { label: 'Median comparable', value: GLOBAL.toFixed(3) + '×', accent: false, unit: 'market cap ÷ TVL, shrunk' },
      { label: 'As of', value: DATA.as_of || '—', accent: false, unit: 'dated snapshot' }
    ];
    els.stats.textContent = '';
    figures.forEach(function (fig) {
      var box = document.createElement('div');
      box.className = 'stat';
      var label = document.createElement('p');
      label.className = 'stat-label';
      label.textContent = fig.label;
      var value = document.createElement('p');
      value.className = 'stat-value' + (fig.accent ? ' accent' : '');
      value.textContent = fig.value;
      var unit = document.createElement('p');
      unit.className = 'stat-unit';
      unit.textContent = fig.unit;
      box.appendChild(label);
      box.appendChild(value);
      box.appendChild(unit);
      els.stats.appendChild(box);
    });
  }

  function fillSelect(select, values, allLabel) {
    if (!select) return;
    select.textContent = '';
    var all = document.createElement('option');
    all.value = '';
    all.textContent = allLabel;
    select.appendChild(all);
    values.forEach(function (value) {
      var option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
  }

  function renderFilters() {
    var categories = sortedUnique(ROWS.map(categoryOf));
    var chains = sortedUnique(
      ROWS.reduce(function (acc, row) {
        return acc.concat(Array.isArray(row.chains) ? row.chains : []);
      }, [])
    );
    fillSelect(els.category, categories, 'All categories');
    fillSelect(els.chain, chains, 'All chains');
  }

  /* ---------- filtering and sorting ---------- */

  function matches(row) {
    if (state.watchOnly && !WATCH_SET.has(row.slug)) return false;
    if (state.category && categoryOf(row) !== state.category) return false;
    if (state.chain && (row.chains || []).indexOf(state.chain) === -1) return false;
    if (state.q) {
      var needle = state.q.toLowerCase();
      var name = String(row.name || '').toLowerCase();
      var slug = String(row.slug || '').toLowerCase();
      if (name.indexOf(needle) === -1 && slug.indexOf(needle) === -1) return false;
    }
    return true;
  }

  function valueFor(row) {
    switch (state.sort) {
      case 'tvl':
        return row.tvl_usd;
      case 'change':
        return row.change_7d;
      case 'age':
        return row.age_days;
      case 'multiple':
        return row.multiple;
      default:
        return row.implied_value_usd;
    }
  }

  function compare(a, b) {
    var av = valueFor(a);
    var bv = valueFor(b);
    var aMissing = av === null || av === undefined || !isFinite(av);
    var bMissing = bv === null || bv === undefined || !isFinite(bv);
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    if (!aMissing && av !== bv) return bv - av;
    if (a.implied_value_usd !== b.implied_value_usd) {
      return b.implied_value_usd - a.implied_value_usd;
    }
    return a.rank - b.rank;
  }

  function visibleRows() {
    return ROWS.filter(matches).sort(compare);
  }

  /* ---------- table ---------- */

  function cell(text, className, tag) {
    var td = document.createElement(tag || 'td');
    if (className) td.className = className;
    td.textContent = text;
    return td;
  }

  function buildRow(row) {
    var tr = document.createElement('tr');
    tr.className = 'row';
    tr.tabIndex = 0;
    tr.setAttribute('role', 'button');
    tr.setAttribute('aria-label', 'Show details for ' + row.name);
    tr.dataset.slug = row.slug;

    tr.appendChild(cell(String(row.rank), 'rank mono'));

    var nameCell = document.createElement('td');
    nameCell.className = 'name';
    nameCell.textContent = row.name;
    var slug = document.createElement('span');
    slug.className = 'slug';
    slug.textContent = row.slug;
    nameCell.appendChild(slug);
    tr.appendChild(nameCell);

    tr.appendChild(cell(categoryOf(row), 'cat'));
    tr.appendChild(cell(chainList(row.chains), 'chains'));
    tr.appendChild(cell(money(row.tvl_usd), 'num mono'));

    var changeCell = cell(pct(row.change_7d), 'num mono dim');
    if (typeof row.change_7d === 'number') {
      changeCell.className = 'num mono ' + (row.change_7d >= 0 ? 'pos' : 'neg');
    }
    tr.appendChild(changeCell);

    tr.appendChild(cell(age(row.age_days), 'num mono dim'));
    tr.appendChild(cell(money(row.implied_value_usd), 'num implied'));
    tr.appendChild(cell(mult(row.multiple), 'num multiple'));

    tr.addEventListener('click', function () {
      openDetail(row.slug, true);
    });
    tr.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openDetail(row.slug, true);
      }
    });

    return tr;
  }

  function renderBoard() {
    var rows = visibleRows();
    if (!els.board) return;
    els.board.textContent = '';
    var frag = document.createDocumentFragment();
    rows.forEach(function (row) {
      frag.appendChild(buildRow(row));
    });
    els.board.appendChild(frag);
    if (els.count) {
      els.count.textContent = rows.length + (rows.length === 1 ? ' row' : ' rows');
    }
    if (els.empty) els.empty.hidden = rows.length !== 0;
  }

  /* ---------- detail panel ---------- */

  function findRow(slug) {
    for (var i = 0; i < ROWS.length; i += 1) {
      if (ROWS[i].slug === slug) return ROWS[i];
    }
    return null;
  }

  function factorBlock(name, value, note, kind, scale) {
    var wrap = document.createElement('div');
    wrap.className = 'factor';

    var top = document.createElement('div');
    top.className = 'factor-top';
    var label = document.createElement('span');
    label.className = 'factor-name';
    label.textContent = name;
    var val = document.createElement('span');
    val.className = 'factor-value';
    val.textContent = value.toFixed(3);
    top.appendChild(label);
    top.appendChild(val);

    var bar = document.createElement('div');
    bar.className = 'factor-bar';
    var fill = document.createElement('div');
    fill.className = 'factor-fill' + (kind ? ' ' + kind : '');
    var width = Math.max(2, Math.min(100, (value / scale) * 100));
    fill.style.width = width + '%';
    bar.appendChild(fill);

    var noteEl = document.createElement('p');
    noteEl.className = 'factor-note';
    noteEl.textContent = note;

    wrap.appendChild(top);
    wrap.appendChild(bar);
    wrap.appendChild(noteEl);
    return wrap;
  }

  function renderDetail(row) {
    var panel = els.panel;
    if (!panel) return;
    panel.textContent = '';

    var head = document.createElement('div');
    head.className = 'panel-head';
    var title = document.createElement('h2');
    title.id = 'detail-name';
    title.textContent = row.name;
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.textContent = 'Close';
    close.addEventListener('click', function () {
      closeDetail();
    });
    head.appendChild(title);
    head.appendChild(close);
    panel.appendChild(head);

    var implied = document.createElement('p');
    implied.className = 'panel-implied';
    var impliedLabel = document.createElement('span');
    impliedLabel.className = 'panel-implied-label';
    impliedLabel.textContent = 'Implied value';
    implied.appendChild(impliedLabel);
    implied.appendChild(document.createTextNode(money(row.implied_value_usd)));
    var badge = document.createElement('span');
    badge.className = 'panel-rank';
    badge.textContent = 'rank ' + row.rank;
    implied.appendChild(badge);
    panel.appendChild(implied);

    var meta = document.createElement('p');
    meta.className = 'panel-meta';
    meta.textContent = categoryOf(row) + ' · ' + (row.chains || []).join(', ');
    panel.appendChild(meta);

    var facts = document.createElement('p');
    facts.className = 'panel-meta';
    facts.textContent = money(row.tvl_usd) + ' TVL · Age ' + age(row.age_days);
    if (typeof row.age_days === 'number') {
      facts.textContent = money(row.tvl_usd) + ' TVL · Age ' + Math.round(row.age_days) + ' days';
    }
    if (typeof row.change_7d === 'number') {
      facts.textContent += ' · ' + pct(row.change_7d) + ' over 7 days';
    }
    panel.appendChild(facts);

    var factorTitle = document.createElement('h3');
    factorTitle.textContent = 'Factor breakdown';
    panel.appendChild(factorTitle);

    panel.appendChild(
      factorBlock('Comparable multiple', row.multiple, 'Category median, shrunk toward ' + GLOBAL.toFixed(3) + '×', 'comparable', 0.6)
    );
    panel.appendChild(
      factorBlock('Growth factor', row.growth_multiplier, '1 + 0.45 × tanh(' + pct(row.change_7d) + ' ÷ 30)', 'growth', 1.5)
    );
    panel.appendChild(
      factorBlock('Maturity factor', row.maturity_multiplier, 'Rises with age toward 1', 'maturity', 1)
    );

    var stepsTitle = document.createElement('h3');
    stepsTitle.textContent = 'Six step farm plan';
    panel.appendChild(stepsTitle);

    var list = document.createElement('ol');
    list.className = 'steps';
    (row.farm_steps || []).forEach(function (step) {
      var li = document.createElement('li');
      li.textContent = step;
      list.appendChild(li);
    });
    panel.appendChild(list);

    var foot = document.createElement('p');
    foot.className = 'panel-foot';
    foot.textContent =
      'DefiLlama records no token for this protocol. That is a record, not proof: a token may exist outside it. Implied value is the radar’s own estimate.';
    panel.appendChild(foot);
  }

  function openDetail(slug, updateUrl) {
    var row = findRow(slug);
    if (!row) return;
    state.detail = slug;
    renderDetail(row);
    els.panel.hidden = false;
    els.scrim.hidden = false;
    document.body.classList.add('has-detail');
    if (updateUrl) syncUrl();
    var closeBtn = els.panel.querySelector('.close');
    if (closeBtn) closeBtn.focus();
  }

  function closeDetail() {
    state.detail = null;
    els.panel.hidden = true;
    els.scrim.hidden = true;
    document.body.classList.remove('has-detail');
    syncUrl();
  }

  /* ---------- URL ---------- */

  function syncUrl() {
    if (typeof window.history === 'undefined' || !window.history.replaceState) return;
    var params = [];
    function add(key, value) {
      if (value) params.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    }
    add('q', state.q);
    add('category', state.category);
    add('chain', state.chain);
    if (state.sort !== 'implied') add('sort', state.sort);
    if (state.watchOnly) add('watch', '1');
    add('detail', state.detail);
    var query = params.length ? '?' + params.join('&') : '';
    try {
      window.history.replaceState(null, '', window.location.pathname + query + window.location.hash);
    } catch (err) {
      /* a file:// document may refuse history rewrites; the view still works */
    }
  }

  function readUrl() {
    var params = new URLSearchParams(window.location.search);
    state.q = params.get('q') || '';
    state.category = params.get('category') || '';
    state.chain = params.get('chain') || '';
    var sort = params.get('sort');
    if (sort) state.sort = sort;
    state.watchOnly = params.get('watch') === '1';
    state.detail = params.get('detail') || null;
  }

  function applyStateToControls() {
    if (els.search) els.search.value = state.q;
    if (els.category) els.category.value = state.category;
    if (els.chain) els.chain.value = state.chain;
    if (els.sort) els.sort.value = state.sort;
    if (els.watch) els.watch.checked = state.watchOnly;
  }

  /* ---------- colophon ---------- */

  function renderColophon() {
    if (!els.colophon) return;
    var parts = [];
    if (DATA.board_size) parts.push(DATA.board_size + ' board rows ranked by implied value.');
    if (DATA.early_size) parts.push(DATA.early_size + ' are early-stage protocols below the watchlist floor.');
    if (LIVE.length) parts.push(LIVE.length + ' already-trading protocols are set aside from the board.');
    if (DATA.floor_usd) parts.push('Watchlist floor ' + money(DATA.floor_usd) + ' TVL.');
    parts.push('Source: ' + (DATA.source || 'DefiLlama snapshot') + '.');
    parts.push('Model ' + (DATA.model_version || 'radar-3') + ': every figure is the radar’s estimate, not advice.');
    els.colophon.textContent = parts.join(' ');
  }

  /* ---------- wiring ---------- */

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        fn.apply(null, args);
      }, wait);
    };
  }

  function bind() {
    if (els.search) {
      els.search.addEventListener(
        'input',
        debounce(function () {
          state.q = els.search.value.trim();
          renderBoard();
          syncUrl();
        }, 120)
      );
    }
    if (els.category) {
      els.category.addEventListener('change', function () {
        state.category = els.category.value;
        renderBoard();
        syncUrl();
      });
    }
    if (els.chain) {
      els.chain.addEventListener('change', function () {
        state.chain = els.chain.value;
        renderBoard();
        syncUrl();
      });
    }
    if (els.sort) {
      els.sort.addEventListener('change', function () {
        state.sort = els.sort.value;
        renderBoard();
        syncUrl();
      });
    }
    if (els.watch) {
      els.watch.addEventListener('change', function () {
        state.watchOnly = els.watch.checked;
        renderBoard();
        syncUrl();
      });
    }
    if (els.scrim) {
      els.scrim.addEventListener('click', closeDetail);
    }
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && state.detail) closeDetail();
    });
  }

  function init() {
    readUrl();
    renderHead();
    renderFilters();
    applyStateToControls();
    renderStats();
    renderBoard();
    renderColophon();
    bind();
    if (state.detail) {
      openDetail(state.detail, false);
    }
  }

  init();
})();
