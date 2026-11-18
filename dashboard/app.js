(function () {
  'use strict';

  var D = window.RADAR;
  if (!D) return;

  var root = document.getElementById('app');
  var state = {
    q: '', cat: 'all', chain: 'all', watch: false,
    sort: 'implied', weight: 0.45, floor: 0.70,
  };
  var rows = D.rows;
  var cats = Array.from(new Set(rows.map(r => r.category || 'Unknown'))).sort();
  var chains = Array.from(new Set(rows.flatMap(r => r.chains))).sort();
  var watch = new Set(D.watchlist || []);

  // Shared formatting and model preview helpers.
  function esc(value) {
    return String(value == null ? '—' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(value) {
    if (value == null) return '—';
    if (value >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B';
    if (value >= 1e6) return '$' + (value / 1e6).toFixed(1) + 'M';
    if (value >= 1e3) return '$' + Math.round(value / 1e3) + 'K';
    return '$' + Math.round(value);
  }

  function chainSummary(chains) {
    var shown = chains.slice(0, 3);
    if (chains.length > 3) shown.push('+' + (chains.length - 3));
    return shown.join(', ');
  }

  function calc(row) {
    var growth = 1 + state.weight * Math.tanh(Math.max(-80, Math.min(200, row.change_7d || 0)) / 30);
    var age = row.age_days == null ? 365 : row.age_days;
    var maturity = Math.max(state.floor, Math.min(1,
      state.floor + (1 - state.floor) * Math.log(1 + age) / Math.log(1461)));
    return Math.max(1, Math.round(row.tvl_usd * row.multiple * growth * maturity));
  }

  // Filter and sort the ranked board.
  function options(items, value) {
    return '<option value="all">All</option>' + items.map(item =>
      '<option ' + (value === item ? 'selected' : '') + '>' + esc(item) + '</option>'
    ).join('');
  }

  function visible() {
    return rows.filter(row =>
      (!state.q || (row.name + ' ' + row.slug).toLowerCase().includes(state.q.toLowerCase())) &&
      (state.cat === 'all' || (row.category || 'Unknown') === state.cat) &&
      (state.chain === 'all' || row.chains.includes(state.chain)) &&
      (!state.watch || watch.has(row.slug))
    ).sort(function (a, b) {
      var score = state.sort === 'implied' ? calc(a) - calc(b) :
        state.sort === 'tvl' ? a.tvl_usd - b.tvl_usd :
          state.sort === 'change' ? (a.change_7d || 0) - (b.change_7d || 0) :
            (a.age_days || 0) - (b.age_days || 0);
      return -score || a.slug.localeCompare(b.slug);
    });
  }

  // Dashboard sections: explainer, stats, controls, ranked board, live table and sandbox.
  function render() {
    var search = document.getElementById('q');
    var restoreSearch = !!search && document.activeElement === search;
    var caret = restoreSearch ? search.selectionEnd : 0;
    var shown = visible();
    var median = D.model.global_median;

    var explainer = `
      <section class="card">
        <h2>How to read this radar</h2>
        <p>Implied value = TVL × category comparable multiple × growth factor × maturity factor. Category multiples use token mcap/TVL medians, shrunk toward the global median (${median.toFixed(3)}). Growth uses 1 + 0.45 × tanh(change ÷ 30); maturity rises with age toward 1. Calibration: $1B TVL Lending, flat growth, age 481 days → about $164M.</p>
        <p>“Records no token” describes DefiLlama’s record; it is never proof that a protocol has no token.</p>
      </section>`;
    var stats = `
      <section class="card stats">
        <div class="stat"><span class="muted">Board rows</span><b>${rows.length}</b></div>
        <div class="stat"><span class="muted">Watchlist covered</span><b>${D.watchlist_size}/${D.watchlist_size}</b></div>
        <div class="stat"><span class="muted">Median comparable</span><b>${median.toFixed(3)}×</b></div>
        <div class="stat"><span class="muted">As of</span><b>${esc(D.as_of)}</b></div>
      </section>`;
    var controls = `
      <section class="card controls">
        <label>Search<input id="q" value="${esc(state.q)}" placeholder="Name or slug"></label>
        <label>Category<select id="cat">${options(cats, state.cat)}</select></label>
        <label>Chain<select id="chain">${options(chains, state.chain)}</select></label>
        <label>Sort<select id="sort">
          <option value="implied" ${state.sort === 'implied' ? 'selected' : ''}>Implied value</option>
          <option value="tvl" ${state.sort === 'tvl' ? 'selected' : ''}>TVL</option>
          <option value="change" ${state.sort === 'change' ? 'selected' : ''}>7-day change</option>
          <option value="age" ${state.sort === 'age' ? 'selected' : ''}>Age</option>
        </select></label>
        <label><span>Watchlist only</span><input id="watch" type="checkbox" ${state.watch ? 'checked' : ''}></label>
        <span class="muted">${shown.length} rows</span>
      </section>`;
    var board = `
      <section class="card">
        <h2>Ranked board</h2>
        <div class="scroll"><table>
          <thead><tr><th>Rank</th><th>Protocol</th><th>Category</th><th>Chains</th><th>TVL</th><th>7d</th><th>Age</th><th>Implied</th><th>Multiple</th></tr></thead>
          <tbody>${shown.map(row => `
            <tr data-slug="${esc(row.slug)}"><td>${row.rank}</td><td>${esc(row.name)}</td><td>${esc(row.category)}</td>
            <td>${esc(chainSummary(row.chains))}</td><td>${money(row.tvl_usd)}</td>
            <td>${row.change_7d == null ? '—' : row.change_7d.toFixed(1) + '%'}</td>
            <td>${row.age_days == null ? 'unknown' : row.age_days + 'd'}</td>
            <td class="amber">${money(calc(row))}</td><td>${row.multiple.toFixed(3)}×</td></tr>`).join('')}
          </tbody>
        </table></div>
      </section>`;
    var live = `
      <section class="card">
        <h2>Already trading</h2>
        <p>Market capitalization from the snapshot; these rows are not model-ranked.</p>
        <div class="scroll"><table class="live">
          <thead><tr><th>Protocol</th><th>Category</th><th>Chains</th><th>TVL</th><th>Market value</th></tr></thead>
          <tbody>${D.live.map(row => `
            <tr><td>${esc(row.name)}</td><td>${esc(row.category)}</td><td>${esc(chainSummary(row.chains))}</td>
            <td>${money(row.tvl_usd)}</td><td>${money(row.mcap_usd)}</td></tr>`).join('')}
          </tbody>
        </table></div>
      </section>`;
    var sandbox = `
      <section class="card">
        <h2>Model sandbox · what-if preview</h2>
        <p>Preview recalculates displayed implied values. It does not change board.json.</p>
        <div class="sandbox">
          <label>Growth weight: <output id="wo">${state.weight.toFixed(2)}</output><input id="weight" type="range" min="0" max="0.8" step="0.01" value="${state.weight}"></label>
          <label>Maturity floor: <output id="fo">${state.floor.toFixed(2)}</output><input id="floor" type="range" min="0.5" max="0.9" step="0.01" value="${state.floor}"></label>
        </div>
      </section>`;

    root.innerHTML = `
      <header><div><div class="eyebrow">TOKEN RADAR / ${esc(D.model_version)}</div>
        <h1>Pre-token value radar</h1><p>Snapshot ${esc(D.as_of)} · snapshot-derived estimates</p></div>
        <div class="tag">RECORDS NO TOKEN · NOT PROOF OF NO TOKEN</div></header>
      ${explainer}${stats}${controls}${board}${live}${sandbox}
      ${location.hash.indexOf('#/detail/') === 0 ? detail(decodeURIComponent(location.hash.slice(9))) : ''}`;
    bind();
    if (restoreSearch) {
      var nextSearch = document.getElementById('q');
      nextSearch.focus();
      nextSearch.setSelectionRange(caret, caret);
    }
  }

  // Detail section: implied value, real factors with normalized bars, and farm steps.
  function detail(slug) {
    var row = rows.find(item => item.slug === slug);
    if (!row) return '';
    var factors = [
      ['Comparable multiple', row.multiple, row.multiple / 1.5],
      ['Growth factor', row.growth_multiplier, Math.max(0, Math.min(1, (row.growth_multiplier - 0.55) / 0.90))],
      ['Maturity factor', row.maturity_multiplier, Math.max(0, Math.min(1, (row.maturity_multiplier - 0.70) / 0.30))],
    ];
    return `
      <aside class="detail">
        <button id="close">Close</button><h2>${esc(row.name)}</h2>
        <p class="amber"><strong>Implied value ${money(row.implied_value_usd)}</strong></p>
        <p>${esc(row.category)} · ${esc(row.chains.join(', '))}</p>
        <p>TVL ${money(row.tvl_usd)} · Age ${row.age_days == null ? 'unknown' : row.age_days + ' days'}</p>
        <h3>Factor breakdown</h3>
        ${factors.map(factor => `
          <p>${esc(factor[0])} <b>${Number(factor[1]).toFixed(3)}</b></p>
          <div class="bar"><i style="width:${Math.max(0, Math.min(100, factor[2] * 100))}%"></i></div>`).join('')}
        <h3>Six step farm plan</h3>
        <ol>${row.farm_steps.map(step => `<li class="step">${esc(step)}</li>`).join('')}</ol>
      </aside>`;
  }

  // Event bindings and hash routing.
  function bind() {
    document.getElementById('q').oninput = event => { state.q = event.target.value; render(); };
    document.getElementById('cat').onchange = event => {
      state.cat = event.target.value;
      location.hash = state.cat === 'all' ? '#/' : '#/?category=' + encodeURIComponent(state.cat);
      render();
    };
    document.getElementById('chain').onchange = event => { state.chain = event.target.value; render(); };
    document.getElementById('sort').onchange = event => { state.sort = event.target.value; render(); };
    document.getElementById('watch').onchange = event => { state.watch = event.target.checked; render(); };
    document.getElementById('weight').oninput = event => { state.weight = +event.target.value; render(); };
    document.getElementById('floor').oninput = event => { state.floor = +event.target.value; render(); };
    Array.from(document.querySelectorAll('tbody tr[data-slug]')).forEach(row => {
      row.onclick = () => { location.hash = '#/detail/' + encodeURIComponent(row.dataset.slug); };
    });
    var close = document.getElementById('close');
    if (close) close.onclick = () => { location.hash = '#/'; };
  }

  function route() {
    var hash = location.hash;
    if (hash.indexOf('#/?category=') === 0) state.cat = decodeURIComponent(hash.slice(12));
    else if (hash === '#/' || hash === '#') state.cat = 'all';
    render();
  }

  window.addEventListener('hashchange', route);
  route();
})();
