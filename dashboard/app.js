/* Offline dashboard: all protocol facts are embedded by main.ts in data.js. */
(function () {
  'use strict';

  // Read embedded data and initialize the editable model and page state.
  var D = window.RADAR;
  var app = document.getElementById('app');

  if (!D) {
    app.textContent = 'Radar data is missing. Run main.ts to build data.js.';
    return;
  }

  var tune = {
    exponent: D.model.exponent,
    weight: D.model.growth_weight,
    floor: D.model.maturity_floor
  };
  var state = {
    q: '',
    category: 'all',
    chain: 'all',
    watch: false,
    sort: 'rank',
    dir: 1,
    detail: null,
    live: false
  };

  // Format values for the dashboard's compact numeric columns.
  var fmt = function (n) {
    return n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  };
  var pct = function (n) {
    return n == null ? 'n/a' : (n > 0 ? '+' : '') + Number(n).toFixed(1) + '%';
  };
  var age = function (n) {
    return n == null ? 'unknown' : n < 365 ? Math.floor(n / 30) + ' mo' : (n / 365.2425).toFixed(1) + ' yr';
  };

  // Create DOM nodes while keeping all displayed data as text.
  function node(tag, attrs, children) {
    var x = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') {
        x.className = v;
      } else if (k === 'text') {
        x.textContent = v;
      } else if (k.slice(0, 2) === 'on') {
        x.addEventListener(k.slice(2), v);
      } else if (v !== null && v !== undefined) {
        x.setAttribute(k, String(v));
      }
    });
    (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c == null) return;
      x.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return x;
  }

  // Apply the same snapshot-only scoring formula as lib/model.ts.
  function model(p) {
    var m = D.model;
    var g = Math.min(m.growth_cap, Math.max(m.growth_floor, p.change_7d == null ? 0 : p.change_7d));
    var gm = 1 + (g >= 0 ? g / 100 * tune.weight : g / 100 * m.loss_weight);
    var a = p.age_days == null ? m.unknown_age_days : p.age_days;
    var y = Math.min(a / 365.2425, m.maturity_years);
    var mm = tune.floor + (m.maturity_ceiling - tune.floor) * Math.sqrt(y / m.maturity_years);
    var bm = 1 + m.breadth_step * Math.min(Math.max((p.chains || []).length - 1, 0), m.breadth_cap);
    var tv = m.calibration * Math.pow(p.tvl_usd, tune.exponent);

    return {
      value: Math.max(1, Math.round(tv * gm * mm * bm)),
      tvl: tv,
      growth: gm,
      maturity: mm,
      breadth: bm,
      g: g
    };
  }

  // Recalculate snapshot ranks whenever sandbox assumptions change.
  function rows() {
    return D.rows.map(function (p) {
      var x = model(p);
      return Object.assign({}, p, { implied_value_usd: x.value, _m: x });
    }).sort(function (a, b) {
      return b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug);
    }).map(function (p, i) {
      return Object.assign(p, { rank: i + 1 });
    });
  }

  // Keep filter state in the URL so a board view can be shared or refreshed.
  function encHash() {
    var u = new URLSearchParams();
    if (state.q) u.set('q', state.q);
    if (state.category !== 'all') u.set('category', state.category);
    if (state.chain !== 'all') u.set('chain', state.chain);
    if (state.watch) u.set('watchlist', '1');
    history.replaceState(null, '', '#/?' + u.toString());
  }

  // Restore board filters, live mode, or a selected detail from the hash.
  function readHash() {
    var h = location.hash;
    state.live = false;
    if (h.indexOf('#/detail/') === 0) {
      state.detail = decodeURIComponent(h.slice(9));
      return;
    }
    if (h.indexOf('#/?') === 0) {
      var u = new URLSearchParams(h.slice(3));
      state.q = u.get('q') || '';
      state.category = u.get('category') || 'all';
      state.chain = u.get('chain') || 'all';
      state.watch = u.get('watchlist') === '1';
      state.detail = null;
    } else if (h === '#/live') {
      state.live = true;
      state.detail = null;
    } else if (h === '#/') {
      state.detail = null;
    } else if (!h) {
      state.detail = null;
    }
  }

  // Select a protocol and navigate to its detail panel.
  function setDetail(slug) {
    state.detail = slug;
    state.live = false;
    location.hash = '#/detail/' + encodeURIComponent(slug);
    render();
  }

  // Toggle the chosen sort direction, with familiar defaults for each column.
  function sortBy(k) {
    if (state.sort === k) {
      state.dir *= -1;
    } else {
      state.sort = k;
      state.dir = k === 'name' ? 1 : -1;
    }
    render();
  }

  // Build sortable table headings.
  function tableHeader(k, t) {
    var b = node('button', {
      type: 'button',
      text: t + (state.sort === k ? (state.dir > 0 ? ' ↑' : ' ↓') : '')
    });
    b.onclick = function () {
      sortBy(k);
    };
    return node('th', {}, b);
  }

  // Render the dashboard masthead and snapshot status.
  function appHeader() {
    return node('header', { class: 'mast' }, [
      node('div', { class: 'brand' }, [
        node('span', { class: 'sigil', text: '◎' }),
        node('div', { class: 'wordmark' }, [
          'TOKEN RADAR',
          node('small', { text: 'LAUNCH INTELLIGENCE / SEALED SNAPSHOT' })
        ])
      ]),
      node('div', { class: 'meta' }, [
        node('span', { text: 'AS OF ' + D.as_of }),
        node('span', { text: D.model_version.toUpperCase() }),
        node('b', { text: '● OFFLINE' })
      ])
    ]);
  }

  // Filter, sort, and render the ranked protocol table.
  function buildBoard(list) {
    var cats = [...new Set(D.rows.map(function (x) { return x.category || 'Unclassified'; }))].sort();
    var chains = [...new Set(D.rows.flatMap(function (x) { return x.chains || []; }))].sort();
    var q = state.q.trim().toLowerCase();
    list = list.filter(function (p) {
      return (state.category === 'all' || (p.category || 'Unclassified') === state.category) &&
        (state.chain === 'all' || (p.chains || []).includes(state.chain)) &&
        (!state.watch || D.watchlist_size && watchSet.has(p.slug)) &&
        (!q || (p.name + ' ' + p.slug + ' ' + (p.category || '') + ' ' + (p.chains || []).join(' ')).toLowerCase().includes(q));
    });
    var sorted = list.slice().sort(function (a, b) {
      var k = state.sort;
      var aa = k === 'rank' ? a.rank : k === 'name' ? a.name.toLowerCase() : k === 'tvl' ? a.tvl_usd : k === 'growth' ? (a.change_7d ?? -Infinity) : k === 'age' ? (a.age_days ?? Infinity) : a.implied_value_usd;
      var bb = k === 'rank' ? b.rank : k === 'name' ? b.name.toLowerCase() : k === 'tvl' ? b.tvl_usd : k === 'growth' ? (b.change_7d ?? -Infinity) : k === 'age' ? (b.age_days ?? Infinity) : b.implied_value_usd;
      return (aa < bb ? -1 : aa > bb ? 1 : 0) * state.dir || a.slug.localeCompare(b.slug);
    });

    var search = node('input', {
      id: 'search',
      type: 'search',
      placeholder: 'Name or slug',
      value: state.q,
      'aria-label': 'Search name or slug'
    });
    search.oninput = function () {
      state.q = search.value;
      var pos = search.selectionStart;
      encHash();
      render();
      var next = document.getElementById('search');
      next.focus();
      next.setSelectionRange(pos, pos);
    };

    var cat = node('select', { id: 'category' }, [
      node('option', { value: 'all', text: 'All categories' }),
      ...cats.map(function (c) {
        return node('option', { value: c, text: c, selected: c === state.category ? 'selected' : null });
      })
    ]);
    cat.onchange = function () {
      state.category = cat.value;
      encHash();
      render();
    };

    var ch = node('select', { id: 'chain' }, [
      node('option', { value: 'all', text: 'All chains' }),
      ...chains.map(function (c) {
        return node('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null });
      })
    ]);
    ch.onchange = function () {
      state.chain = ch.value;
      encHash();
      render();
    };

    var check = node('input', { type: 'checkbox', checked: state.watch ? 'checked' : null });
    check.onchange = function () {
      state.watch = check.checked;
      encHash();
      render();
    };

    var toolbar = node('div', { class: 'toolbar' }, [
      field('Search', search),
      field('Category', cat),
      field('Chain', ch),
      node('label', { class: 'watch' }, [check, 'Watchlist only']),
      node('span', { class: 'count', text: sorted.length + ' of ' + D.board_size + ' protocols' })
    ]);

    var body = node('tbody');
    sorted.forEach(function (p) {
      var tr = node('tr', { class: state.detail === p.slug ? 'selected' : '' }, [
        node('td', { class: 'num rank', text: String(p.rank).padStart(3, '0') }),
        node('td', {}, [
          node('span', { class: 'protocol', text: p.name }),
          node('span', { class: 'slug', text: p.slug })
        ]),
        node('td', { class: 'num', text: fmt(p.tvl_usd) }),
        node('td', { class: 'num ' + (p.change_7d == null ? 'muted' : p.change_7d >= 0 ? 'positive' : 'negative'), text: pct(p.change_7d) }),
        node('td', { class: 'num', text: age(p.age_days) }),
        node('td', { class: 'num value', text: fmt(p.implied_value_usd) })
      ]);
      tr.onclick = function () {
        setDetail(p.slug);
      };
      body.appendChild(tr);
    });

    var table = node('div', { class: 'tablebox' }, node('table', {}, [
      node('thead', {}, node('tr', {}, [
        tableHeader('rank', 'Rank'),
        tableHeader('name', 'Protocol'),
        tableHeader('tvl', 'TVL'),
        tableHeader('growth', '7D Δ'),
        tableHeader('age', 'Age'),
        tableHeader('value', 'Implied value')
      ])),
      body
    ]));
    return [toolbar, table, sorted];
  }

  // Set watchlist membership from the exact published slug list.
  var watchSet = new Set();

  // Render the selected protocol's score details and farm plan.
  function detailView(p) {
    if (!p) {
      return node('section', { class: 'detail' }, node('p', { text: 'No matching protocol. Choose a row to inspect its score and farm plan.' }));
    }
    var x = model(p);
    var m = D.model;
    return node('section', { id: 'detail', class: 'detail' }, [
      node('div', { class: 'detail-top' }, [
        node('div', {}, [
          node('div', { class: 'kicker', text: 'PROTOCOL FILE / RANK ' + p.rank + ' OF ' + D.board_size }),
          node('h2', { text: p.name }),
          node('span', { class: 'slug', text: p.slug + ' · ' + (p.category || 'Unclassified') + ' · ' + ((p.chains || []).join(', ') || 'chain unreported') })
        ]),
        node('button', {
          class: 'close',
          type: 'button',
          text: 'Close detail',
          onclick: function () {
            state.detail = null;
            location.hash = '/';
            render();
          }
        })
      ]),
      node('div', { class: 'facts' }, [
        fact('TVL', fmt(p.tvl_usd)),
        fact('7D change', pct(p.change_7d)),
        fact('Tracked age', age(p.age_days)),
        fact('Chains', String((p.chains || []).length)),
        fact('Category', p.category || 'Unclassified'),
        fact('Implied', fmt(x.value))
      ]),
      node('div', { class: 'kicker', text: 'MODEL BREAKDOWN / ' + D.model_version.toUpperCase() }),
      node('div', { class: 'breakdown' }, [
        fact('TVL term', fmt(x.tvl) + ' · ' + tune.exponent.toFixed(2) + ' power'),
        fact('Growth input', pct(x.g) + ' → ×' + x.growth.toFixed(3)),
        fact('Maturity', age(p.age_days) + ' → ×' + x.maturity.toFixed(3)),
        fact('Breadth', String((p.chains || []).length) + ' chains → ×' + x.breadth.toFixed(3)),
        fact('Calibration', m.calibration.toPrecision(4))
      ]),
      node('p', {
        class: 'muted',
        text: 'Calculation: max(1, round(C × TVL^' + tune.exponent.toFixed(2) + ' × ' + x.growth.toFixed(4) + ' × ' + x.maturity.toFixed(4) + ' × ' + x.breadth.toFixed(4) + ')). Same snapshot-only function for every protocol.'
      }),
      node('div', { class: 'kicker', text: 'FARM PLAN / 6 ACTIONS WITH COST + TIME' }),
      node('ol', { class: 'steps' }, p.farm_steps.map(function (s) {
        var i = s.lastIndexOf(' Cost: ');
        var txt = i < 0 ? s : s.slice(0, i);
        var tail = i < 0 ? '' : s.slice(i + 7);
        return node('li', {}, [document.createTextNode(txt), node('small', { text: tail })]);
      }))
    ]);
  }

  // Small reusable fact and labeled-control builders.
  function fact(label, value) {
    return node('div', { class: 'fact' }, [
      node('span', { text: label }),
      node('b', { text: value })
    ]);
  }

  function field(label, input) {
    var id = 'f' + label.replace(/\W/g, '');
    input.id = id;
    return node('div', { class: 'field' }, [
      node('label', { for: id, text: label }),
      input
    ]);
  }

  // Render live protocols separately from the ranked pre-token board.
  function livePanel() {
    var body = node('tbody');
    D.live.forEach(function (p) {
      var cells = [
        node('td', {}, node('span', { class: 'chip live-tag', text: 'LIVE' })),
        node('td', {}, [
          node('span', { class: 'protocol', text: p.name }),
          node('span', { class: 'slug', text: (p.category || 'Unclassified') + ' · ' + (p.chains || []).join(', ') })
        ]),
        node('td', { class: 'num', text: fmt(p.tvl_usd) }),
        node('td', { class: 'num', text: pct(p.change_7d) }),
        node('td', { class: 'num', text: fmt(p.mcap_usd) })
      ];
      body.appendChild(node('tr', {}, cells));
    });
    var head = node('thead', {}, node('tr', {}, ['Status', 'Protocol', 'TVL', '7D change', 'Market cap'].map(function (x) {
      return node('th', { text: x });
    })));
    var table = node('table', {}, [head, body]);
    var box = node('div', { class: 'livebox' }, table);
    return node('section', { class: 'section' }, [
      node('div', { class: 'section-head' }, [
        node('div', {}, [
          node('div', { class: 'kicker', text: 'MARKET TAPE / EXCLUDED FROM RANKING' }),
          node('h2', { text: 'Live token protocols' })
        ]),
        node('p', { text: 'Observed market cap · ' + D.live.length + ' records' })
      ]),
      box
    ]);
  }

  // Explain the scoring model and expose its local sandbox controls.
  function modelPanel() {
    return node('section', { class: 'section' }, [
      node('div', { class: 'section-head' }, [
        node('div', {}, [
          node('div', { class: 'kicker', text: 'SCORING NOTES / RADAR-2' }),
          node('h2', { text: 'A transparent estimate, tuned in-page' })
        ]),
        node('p', { text: 'Snapshot only · no network calls' })
      ]),
      node('div', { class: 'model' }, [
        node('div', { class: 'model-copy' }, [
          node('div', { class: 'formula', text: 'implied = max(1, round(C × TVL^e × growth × maturity × breadth))' }),
          node('p', {}, [node('strong', { text: 'Calibration C: ' }), '250,000,000 ÷ (1,000,000,000^0.85 × 0.775). The 0.775 term is the one-year maturity factor; neutral growth and one chain then make $1bn TVL imply about $250m.']),
          node('p', {}, [node('strong', { text: 'Growth: ' }), 'change_7d clamped to −60%…+120%; positive changes receive weight 0.60 per 100%, losses 0.75. Downside has a larger weight because liquidity confidence can contract faster than a rally builds it. Missing growth is neutral.']),
          node('p', {}, [node('strong', { text: 'Maturity: ' }), '0.55 + 0.45 × √(min(age years, 4) / 4). The square root rewards early operating history and quickly saturates; missing age assumes one year.']),
          node('p', {}, [node('strong', { text: 'Breadth: ' }), '1 + 0.05 × min(max(chain count − 1, 0), 6). A modest distribution premium, capped at seven chains. TVL exponent 0.85 reduces concentration in the largest protocols.'])
        ]),
        node('div', { class: 'sandbox' }, [
          node('div', { class: 'kicker', text: 'LOCAL MODEL SANDBOX' }),
          node('p', { class: 'muted', text: 'Adjust assumptions to recalculate and reorder this same snapshot. No values are sent anywhere.' }),
          slider('TVL exponent', 'exponent', .65, .98, .01),
          slider('Growth weight', 'weight', 0, 1.2, .05),
          slider('Maturity floor', 'floor', .3, .8, .01),
          node('div', { class: 'sandbox-note', text: 'Sandbox values affect the board and detail estimate only in this page; the saved board keeps the published radar-2 constants.' })
        ])
      ])
    ]);
  }

  // Update one sandbox assumption and rerender after the slider is committed.
  function slider(label, key, min, max, step) {
    var input = node('input', { type: 'range', min: min, max: max, step: step, value: tune[key] });
    var out = node('output', { text: Number(tune[key]).toFixed(2) });
    input.oninput = function () {
      tune[key] = Number(input.value);
      out.textContent = tune[key].toFixed(2);
    };
    input.onchange = function () {
      render();
    };
    return node('div', { class: 'slider' }, [node('label', { text: label }), out, input]);
  }

  // Compose the active page from the current hash and model state.
  function render() {
    readHash();
    var all = rows();
    app.textContent = '';
    var shell = node('div', { class: 'shell' });
    shell.appendChild(appHeader());
    var hero = node('section', { class: 'hero' }, [
      node('div', {}, [
        node('div', { class: 'eyebrow', text: 'ON-CHAIN ACTIVITY / TOKEN POSSIBILITY' }),
        node('h1', { text: 'Find the signal before the ticker.' }),
        node('p', { text: 'A ranked view of protocols whose snapshot records no token. Implied value is a model claim from TVL, seven-day change, operating age and chain breadth—not a token price forecast.' })
      ]),
      node('div', { class: 'stats' }, [
        fact('Watchlist floor', D.watchlist_size),
        fact('Ranked radar', D.board_size),
        fact('Below floor', D.early_size),
        fact('Live set aside', D.live_size)
      ])
    ]);
    shell.appendChild(hero);

    if (!state.live) {
      var parts = buildBoard(all);
      shell.appendChild(node('section', { id: 'board' }, [
        node('div', { class: 'section-head' }, [
          node('div', {}, [
            node('div', { class: 'kicker', text: 'PRE-TOKEN RADAR / ' + D.as_of }),
            node('h2', { text: 'Implied value ranking' })
          ]),
          node('p', { text: 'Select a row for full calculation and action plan' })
        ]),
        parts[0],
        parts[1]
      ]));
      if (state.detail) {
        var found = all.find(function (p) { return p.slug === state.detail; });
        shell.appendChild(detailView(found));
        setTimeout(function () {
          document.getElementById('detail')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }, 0);
      }
      shell.appendChild(livePanel());
      shell.appendChild(modelPanel());
    } else {
      shell.appendChild(livePanel());
      var back = node('button', {
        class: 'close',
        text: '← Back to radar',
        onclick: function () {
          state.live = false;
          location.hash = '/';
          render();
        }
      });
      shell.appendChild(back);
    }

    shell.appendChild(node('footer', { class: 'footer' }, [
      node('span', { text: 'DATASET ' + D.source }),
      node('span', { text: 'DefiLlama snapshot · ' + D.as_of + ' · no external assets' })
    ]));
    app.appendChild(shell);
  }

  // Initialize the exact watchlist set and rerender on hash navigation.
  D.rows.forEach(function (p) {
    if (p.slug) {
      // Rows retain their source slugs for ranking and detail lookup.
    }
  });
  // The watchlist's exact members are carried by the row set; main.ts also exposes them as slugs below.
  if (Array.isArray(D.watchlist)) watchSet = new Set(D.watchlist);
  window.addEventListener('hashchange', render);
  render();
})();
