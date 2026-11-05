/* 화면 — 판정은 sim.js 가 한다. 여기서는 읽고, 그리고, 고른 값을 넘길 뿐이다. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { data: null, adj: [], sel: null };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  /* ---------- 읽기 ---------- */
  var SHEETS = { roadmap: ['로드맵', 'roadmap'], rules: ['부하기준', '부하 기준', 'rules'], capacity: ['가용인력', '가용 인력', 'capacity'] };
  function findSheet(wb, names) {
    var n = wb.SheetNames.filter(function (s) { return names.some(function (k) { return s.replace(/\s/g, '').toLowerCase() === k.replace(/\s/g, '').toLowerCase(); }); })[0];
    return n ? XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '', raw: true }) : null;
  }
  function readFile(f) {
    var rd = new FileReader();
    rd.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
        var raw = { roadmap: findSheet(wb, SHEETS.roadmap), rules: findSheet(wb, SHEETS.rules), capacity: findSheet(wb, SHEETS.capacity) };
        var miss = Object.keys(raw).filter(function (k) { return !raw[k]; }).map(function (k) { return SHEETS[k][0]; });
        if (!raw.roadmap) {                                   // 시트 이름이 다르면 첫 시트를 로드맵으로 본다
          raw.roadmap = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true });
        }
        load(raw, f.name, miss);
      } catch (err) { $('data-status').innerHTML = '<div class="warn">파일을 읽지 못했습니다: ' + esc(err.message) + '</div>'; }
    };
    rd.readAsArrayBuffer(f);
  }
  function load(raw, name, miss) {
    state.data = Sim.normalize(raw); state.adj = []; state.sel = null;
    var d = state.data, projects = uniq(d.roadmap.map(function (r) { return r.project; }));
    var h = '<div class="stats">' +
      stat('파일', esc(name)) + stat('기종', projects.length) + stat('일정 줄', d.roadmap.length) +
      stat('부하기준', d.rules.length) + stat('부문', d.capacity.length) + '</div>';
    if (miss && miss.length) h += '<div class="warn">시트가 없습니다: ' + miss.map(esc).join(', ') + ' — 양식을 내려받아 시트 이름을 맞춰 주세요.</div>';
    if (d.issues.length) h += '<div class="warn"><b>확인할 것 ' + d.issues.length + '건</b><ul>' + d.issues.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>';
    else h += '<div class="ok">경고 없이 읽었습니다.</div>';
    $('data-status').innerHTML = h;
    if (!d.roadmap.length) return;
    var lo = d.roadmap.reduce(function (a, r) { return r.start < a ? r.start : a; }, d.roadmap[0].start);
    var hi = d.roadmap.reduce(function (a, r) { return r.end > a ? r.end : a; }, d.roadmap[0].end);
    $('from').value = Sim.fmt(lo); $('to').value = Sim.fmt(hi);
    $('s-load').hidden = false; $('s-what').hidden = false;
    fillSelects(); renderAll();
  }
  function stat(k, v) { return '<div class="stat"><b>' + v + '</b>' + k + '</div>'; }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  /* ---------- 그리기 ---------- */
  function range() { return { from: $('from').value, to: $('to').value }; }
  function renderAll() { renderLoad(); renderCompare(); }

  function renderLoad() {
    var res = Sim.compute(state.data, range());
    state.res = res;
    var sm = Sim.summary(res);
    $('summary').innerHTML = '<div class="stats">' + sm.map(function (s) {
      return '<div class="stat ' + (s.overWeeks ? 'bad' : '') + '"><b>' + esc(s.dept) + '</b>최대 ' + s.peak + '명 / 가용 ' + (s.cap == null ? '—' : s.cap) +
        '<br>부족 ' + s.overWeeks + '주 · 누적 ' + s.shortage + '인주</div>';
    }).join('') + '</div>';
    $('heat').innerHTML = heat(res, function (d, i) { return 'data-d="' + esc(d) + '" data-i="' + i + '"'; });
    if (state.sel) showWhy(state.sel.d, state.sel.i); else $('why').innerHTML = '';
    var sel = $('dept').value || res.depts[0];
    $('chart').innerHTML = lineChart(res.weeks, [{ name: '필요', vals: res.load[sel] || [], cls: 'l-need' }], res.cap[sel], sel);
    $('gantt').innerHTML = gantt(state.data.roadmap, null, res.weeks);
  }
  function heat(res, attr) {
    var h = '<table><thead><tr><th>부문 \\ 주</th>' + res.weeks.map(function (w) { return '<th class="wk">' + Sim.fmt(w).slice(5) + '</th>'; }).join('') + '</tr></thead><tbody>';
    res.depts.forEach(function (d) {
      h += '<tr><th>' + esc(d) + ' <small>' + (res.cap[d] == null ? '' : '가용 ' + res.cap[d]) + '</small></th>';
      res.load[d].forEach(function (v, i) {
        var st = Sim.status(v, res.cap[d]);
        h += '<td class="cell st-' + st + '" ' + (attr ? attr(d, i) : '') + ' title="' + esc(d + ' ' + Sim.fmt(res.weeks[i]) + ' — ' + v + '명') + '">' + (v ? fmtN(v) : '') + '</td>';
      });
      h += '</tr>';
    });
    return h + '</tbody></table>';
  }
  function fmtN(v) { return Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1); }

  function showWhy(d, i) {
    state.sel = { d: d, i: i };
    var ex = Sim.explain(state.res, d, i);
    var h = '<div class="why st-' + ex.status + '-b"><b>' + esc(d) + ' · ' + ex.week + ' 주</b><p>' + esc(ex.text) + '</p>';
    if (ex.lines.length) h += '<table><thead><tr><th>기종 · 단계</th><th>투입(명)</th></tr></thead><tbody>' +
      ex.lines.map(function (l) { return '<tr><td>' + esc(l.key) + '</td><td class="num">' + l.fte + '</td></tr>'; }).join('') + '</tbody></table>';
    if (ex.changes.length) h += '<p class="sub" style="margin-top:10px">지난주 대비: ' + ex.changes.map(function (c) {
      return esc(c.key) + ' ' + c.kind + ' (' + (c.delta > 0 ? '+' : '') + c.delta + ')';
    }).join(' · ') + '</p>';
    $('why').innerHTML = h + '</div>';
  }

  // SVG 꺾은선 — 외부 차트 라이브러리를 들이지 않는다(사내망에서도 파일만 열면 돈다).
  function lineChart(weeks, series, cap, title) {
    var W = 1000, H = 260, L = 44, R = 12, T = 18, B = 34;
    var all = []; series.forEach(function (s) { all = all.concat(s.vals); });
    if (cap != null) all.push(cap);
    var max = Math.max(1, Math.max.apply(null, all.concat([0]))) * 1.12;
    var n = Math.max(1, weeks.length - 1);
    var x = function (i) { return L + (W - L - R) * i / n; }, y = function (v) { return T + (H - T - B) * (1 - v / max); };
    var g = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(title) + ' 주간 부하">';
    for (var k = 0; k <= 4; k++) { var v = max * k / 4; g += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="ax" x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + fmtN(v) + '</text>'; }
    var step = Math.ceil(weeks.length / 12);
    weeks.forEach(function (w, i) { if (i % step === 0) g += '<text class="ax" x="' + x(i) + '" y="' + (H - 12) + '" text-anchor="middle">' + Sim.fmt(w).slice(5) + '</text>'; });
    if (cap != null) g += '<line class="cap" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(cap) + '" y2="' + y(cap) + '"/><text class="cap-t" x="' + (W - R) + '" y="' + (y(cap) - 5) + '" text-anchor="end">가용 ' + cap + '명</text>';
    series.forEach(function (s) {
      g += '<polyline class="' + s.cls + '" points="' + s.vals.map(function (v, i) { return x(i) + ',' + y(v); }).join(' ') + '"/>';
    });
    g += '</svg><div class="legend">' + series.map(function (s) { return '<span class="lg ' + s.cls + '">' + esc(s.name) + '</span>'; }).join('') + '</div>';
    return g;
  }

  function gantt(rm, alt, weeks) {
    if (!weeks.length) return '';
    var W = 1000, L = 150, R = 10, row = 22;
    var t0 = weeks[0].getTime(), t1 = weeks[weeks.length - 1].getTime() + 7 * 86400000;
    var x = function (d) { return L + (W - L - R) * Math.max(0, Math.min(1, (d.getTime() - t0) / (t1 - t0))); };
    var keys = uniq(rm.map(function (r) { return r.project; }));
    var H = keys.length * row * (alt ? 2 : 1) + 30;
    var g = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="로드맵 간트">';
    var stages = uniq(rm.map(function (r) { return r.stage; }));
    keys.forEach(function (p, k) {
      var y0 = 6 + k * row * (alt ? 2 : 1);
      g += '<text class="gl" x="' + (L - 8) + '" y="' + (y0 + 14) + '" text-anchor="end">' + esc(p) + '</text>';
      [[rm, ''], [alt, 'alt']].forEach(function (pair, j) {
        if (!pair[0]) return;
        pair[0].filter(function (r) { return r.project === p; }).forEach(function (r) {
          var a = x(r.start), b = x(r.end);
          g += '<rect class="gb s' + (stages.indexOf(r.stage) % 6) + ' ' + pair[1] + '" x="' + a + '" y="' + (y0 + j * row) + '" width="' + Math.max(2, b - a) + '" height="' + (row - 6) + '" rx="3"><title>' + esc(p + ' ' + r.stage + ' ' + Sim.fmt(r.start) + '~' + Sim.fmt(r.end)) + '</title></rect>';
          if (b - a > 34) g += '<text class="gt" x="' + (a + 4) + '" y="' + (y0 + j * row + 12) + '">' + esc(r.stage) + '</text>';
        });
      });
    });
    g += '</svg>';
    if (alt) g += '<div class="legend"><span class="lg">위: 원래 일정</span><span class="lg l-alt">아래: 가정 적용</span></div>';
    return g;
  }

  /* ---------- 가정 ---------- */
  function fillSelects() {
    var d = state.data;
    var opt = function (a, all) { return (all ? '<option value="*">전 단계</option>' : '') + a.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join(''); };
    var depts = uniq(d.capacity.map(function (c) { return c.dept; }).concat(d.rules.map(function (r) { return r.dept; })));
    $('a-project').innerHTML = opt(uniq(d.roadmap.map(function (r) { return r.project; })));
    $('a-dept').innerHTML = opt(depts);
    $('dept').innerHTML = opt(depts);
    syncForm();
  }
  function syncForm() {
    var t = $('a-type').value, d = state.data; if (!d) return;
    var show = { shift: ['proj', 'stage', 'weeks', 'cascade'], stretch: ['proj', 'stage', 'weeks'], capacity: ['dept', 'fte'], fte: ['stage', 'dept', 'fte'] }[t];
    ['proj', 'stage', 'dept', 'weeks', 'fte', 'cascade'].forEach(function (k) { document.querySelector('.f-' + k).hidden = show.indexOf(k) < 0; });
    var stages = t === 'fte' ? uniq(d.rules.map(function (r) { return r.stage; }))
      : uniq(d.roadmap.filter(function (r) { return r.project === $('a-project').value; }).map(function (r) { return r.stage; }));
    $('a-stage').innerHTML = (t === 'shift' ? '<option value="*">전 단계</option>' : '') + stages.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('');
    if (t === 'capacity') { var c = d.capacity.filter(function (x) { return x.dept === $('a-dept').value; })[0]; if (c) $('a-fte').value = c.fte; }
    $('a-cascade').disabled = $('a-stage').value === '*';
  }
  function addAdj() {
    var t = $('a-type').value, a = { type: t, note: $('a-note').value.trim() };
    if (t === 'shift' || t === 'stretch') { a.project = $('a-project').value; a.stage = $('a-stage').value; a.weeks = +$('a-weeks').value || 0; if (!a.weeks) return; }
    if (t === 'shift') a.cascade = $('a-cascade').checked && a.stage !== '*';
    if (t === 'capacity' || t === 'fte') { a.dept = $('a-dept').value; a.fte = +$('a-fte').value; }
    if (t === 'fte') a.stage = $('a-stage').value;
    state.adj.push(a); $('a-note').value = '';
    renderCompare();
  }
  function renderCompare() {
    var list = $('adj-list');
    list.innerHTML = state.adj.map(function (a, i) {
      return '<li><b>' + esc(Sim.describe(a)) + '</b>' + (a.note ? ' — <span class="note-t">사유: ' + esc(a.note) + '</span>' : ' <span class="sub">(사유 메모 없음)</span>') +
        ' <button class="x" data-i="' + i + '" aria-label="이 가정 지우기">지우기</button></li>';
    }).join('');
    if (!state.adj.length) { $('compare').innerHTML = '<p class="sub">가정을 하나 이상 넣으면 변경 전후 비교가 나옵니다.</p>'; return; }
    var sc = Sim.apply(state.data, state.adj);
    var cmp = Sim.compare(state.data, sc.data, range());
    state.cmp = cmp; state.scen = sc;
    var untouched = sc.log.filter(function (l) { return !l.touched; });
    var h = untouched.length ? '<div class="warn">적용되지 않은 가정이 있습니다: ' + untouched.map(function (l) { return esc(Sim.describe(l.adj)); }).join(', ') + '</div>' : '';
    h += '<div class="tablewrap"><table><thead><tr><th>부문</th><th>가용 전→후</th><th>최대 부하 전→후</th><th>부족 주 전→후</th><th>부족 누적(인주) 전→후</th><th>변화</th></tr></thead><tbody>' +
      cmp.rows.map(function (r) {
        var cls = r.shortDelta < 0 ? 'better' : r.shortDelta > 0 ? 'worse' : '';
        return '<tr class="' + cls + '"><td>' + esc(r.dept) + '</td><td class="num">' + arrow(r.capBefore, r.capAfter) + '</td><td class="num">' + arrow(r.peakBefore, r.peakAfter) +
          '</td><td class="num">' + arrow(r.overBefore, r.overAfter) + '</td><td class="num">' + arrow(r.shortBefore, r.shortAfter) + '</td><td>' +
          (r.shortDelta < 0 ? '부족 ' + (-r.shortDelta) + '인주 해소' : r.shortDelta > 0 ? '부족 ' + r.shortDelta + '인주 증가' : '변화 없음') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    var sel = $('dept').value || cmp.after.depts[0];
    h += '<h3>' + esc(sel) + ' 부하 — 전후</h3>' + lineChart(cmp.after.weeks, [
      { name: '가정 전', vals: cmp.before.load[sel] || [], cls: 'l-before' },
      { name: '가정 후', vals: cmp.after.load[sel] || [], cls: 'l-need' }], cmp.after.cap[sel], sel);
    h += '<h3>가정 후 부하표</h3><div class="tablewrap heat">' + heat(cmp.after) + '</div>';
    h += '<h3>일정 전후</h3>' + gantt(state.data.roadmap, sc.data.roadmap, cmp.after.weeks);
    $('compare').innerHTML = h;
  }
  function arrow(a, b) { a = a == null ? '—' : a; b = b == null ? '—' : b; return a === b ? String(a) : a + ' → <b>' + b + '</b>'; }

  /* ---------- 엑셀 ---------- */
  function sheetOf(res) {
    var rows = [['부문', '가용'].concat(res.weeks.map(Sim.fmt))];
    res.depts.forEach(function (d) { rows.push([d, res.cap[d] == null ? '' : res.cap[d]].concat(res.load[d])); });
    return XLSX.utils.aoa_to_sheet(rows);
  }
  function exportXlsx() {
    var wb = XLSX.utils.book_new(), res = state.res;
    XLSX.utils.book_append_sheet(wb, sheetOf(res), '주간부하');
    var short = [['부문', '주', '필요', '가용', '부족', '사유']];
    res.depts.forEach(function (d) { res.load[d].forEach(function (v, i) {
      if (Sim.status(v, res.cap[d]) === 'over') { var ex = Sim.explain(res, d, i); short.push([d, ex.week, v, res.cap[d], Math.round((v - res.cap[d]) * 100) / 100, ex.text]); }
    }); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(short), '부족구간_사유');
    if (state.cmp) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['가정', '사유 메모']].concat(state.adj.map(function (a) { return [Sim.describe(a), a.note || '']; }))), '가정목록');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(state.cmp.rows.map(function (r) {
        return { 부문: r.dept, 가용_전: r.capBefore, 가용_후: r.capAfter, 최대부하_전: r.peakBefore, 최대부하_후: r.peakAfter, 부족주_전: r.overBefore, 부족주_후: r.overAfter, 부족누적_전: r.shortBefore, 부족누적_후: r.shortAfter, 변화: r.shortDelta };
      })), '전후비교');
      XLSX.utils.book_append_sheet(wb, sheetOf(state.cmp.after), '가정후_주간부하');
    }
    XLSX.writeFile(wb, '개발계획_부하분석_' + Sim.fmt(new Date()) + '.xlsx');
  }
  function template(withSample) {
    var s = withSample ? Sim.sample() : { roadmap: [{ 프로젝트: '', 단계: '', 시작일: '', 종료일: '' }], rules: [{ 프로젝트: '', 단계: '', 부문: '', 주당투입: '' }], capacity: [{ 부문: '', 가용: '' }] };
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.roadmap), '로드맵');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rules.map(function (r) { return { 프로젝트: r.프로젝트 || '', 단계: r.단계, 부문: r.부문, 주당투입: r.주당투입 }; })), '부하기준');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.capacity), '가용인력');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['시트', '열', '설명'],
      ['로드맵', '프로젝트 · 단계 · 시작일 · 종료일', '기종별 단계 일정. 날짜는 2026-03-02 형식이나 엑셀 날짜'],
      ['부하기준', '프로젝트(선택) · 단계 · 부문 · 주당투입', '그 단계가 진행되는 한 주에 부문이 쓰는 인원. 프로젝트를 적으면 그 기종에만 적용'],
      ['가용인력', '부문 · 가용', '부문의 주당 가용 인원']]), '작성법');
    XLSX.writeFile(wb, withSample ? '개발계획_예제.xlsx' : '개발계획_양식.xlsx');
  }

  /* ---------- 연결 ---------- */
  $('file').addEventListener('change', function (e) { if (e.target.files[0]) readFile(e.target.files[0]); });
  var drop = $('drop');
  ['dragover', 'dragenter'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { e.preventDefault(); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
  $('btn-sample').addEventListener('click', function () { load(Sim.sample(), '예제 로드맵(가짜 데이터)', []); });
  $('btn-template').addEventListener('click', function () { template(false); });
  $('from').addEventListener('change', renderAll); $('to').addEventListener('change', renderAll);
  $('dept').addEventListener('change', renderAll);
  $('heat').addEventListener('click', function (e) { var td = e.target.closest('td.cell'); if (td) showWhy(td.dataset.d, +td.dataset.i); });
  // 단계 목록은 종류·기종이 바뀔 때만 다시 만든다 — 단계를 고를 때마다 다시 만들면 고른 값이 첫 항목으로 돌아간다.
  ['a-type', 'a-project'].forEach(function (id) { $(id).addEventListener('change', syncForm); });
  $('a-stage').addEventListener('change', function () { $('a-cascade').disabled = $('a-stage').value === '*'; });
  $('a-dept').addEventListener('change', function () {
    if ($('a-type').value !== 'capacity') return;
    var c = state.data.capacity.filter(function (x) { return x.dept === $('a-dept').value; })[0]; if (c) $('a-fte').value = c.fte;
  });
  $('a-add').addEventListener('click', addAdj);
  $('adj-list').addEventListener('click', function (e) { if (e.target.classList.contains('x')) { state.adj.splice(+e.target.dataset.i, 1); renderCompare(); } });
  $('btn-clear').addEventListener('click', function () { state.adj = []; renderCompare(); });
  $('btn-export').addEventListener('click', exportXlsx);
  window.__app = { state: state, template: template };       // 연기 테스트용
})();
