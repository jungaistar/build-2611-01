/* 개발 계획 시뮬레이터 — 계산 엔진
 *
 * 화면(app.js)은 판정하지 않는다. 부하·부족·사유·전후 비교는 전부 여기서 계산하고
 * test/logic.test.js 로 고정한다. 브라우저와 node 양쪽에서 읽힌다.
 *
 * 데이터 세 가지
 *   roadmap  : [{ project, stage, start, end }]           — 기종별 단계 일정
 *   rules    : [{ stage, dept, fte, project? }]            — 단계 하나가 부문에 주당 몇 명을 쓰는가
 *                                                            project 가 있으면 그 기종에만 적용(일반 규칙보다 우선)
 *   capacity : [{ dept, fte }]                             — 부문별 주당 가용 인원
 *
 * 부하는 주(월요일 시작) 단위로 센다. 단계가 그 주에 걸친 근무일(월~금) / 5 만큼만 넣는다
 * — 수요일에 끝나는 단계를 한 주 통째로 세면 부하가 부풀려진다.
 */
(function (root) {
  'use strict';
  var DAY = 86400000;

  /* ---------- 날짜 ---------- */
  // 엑셀 일련번호(45658) · '2026-03-02' · '2026.03.02' · '2026/3/2' · Date 를 받는다.
  // 시간대 때문에 하루씩 밀리지 않게 전부 UTC 자정으로 맞춘다.
  function toDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
    if (typeof v === 'number' && isFinite(v)) {
      if (v < 20000 || v > 80000) return null;           // 엑셀 날짜가 아닌 숫자
      return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * DAY);
    }
    var m = String(v).trim().match(/^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
    if (!m) return null;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCMonth() === +m[2] - 1 ? d : null;      // 2월 30일 같은 날짜는 거른다
  }
  function fmt(d) { return d ? d.toISOString().slice(0, 10) : ''; }
  function monday(d) { var w = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - w * DAY); }
  function addDays(d, n) { return new Date(d.getTime() + n * DAY); }

  /* ---------- 입력 정리 ---------- */
  // 열 이름이 조금 달라도 읽는다. 늘릴 때는 코드가 아니라 이 표를 늘린다.
  var ALIASES = {
    project: ['프로젝트', '기종', '모델', 'project', 'model'],
    stage: ['단계', '공정', 'stage', 'phase'],
    start: ['시작일', '시작', 'start', '착수일'],
    end: ['종료일', '종료', '완료일', 'end', 'finish'],
    dept: ['부문', '부서', '팀', 'dept', 'department'],
    fte: ['주당투입', '투입', '인원', 'fte', '주당 투입(명)', '투입(명)', '가용', '가용인원', '주당가용', '주당 가용(명)']
  };
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase(); }
  function pick(row, key) {
    var names = ALIASES[key].map(norm);
    for (var k in row) if (names.indexOf(norm(k)) >= 0) return row[k];
    return undefined;
  }
  function num(v) {
    if (typeof v === 'number') return v;
    var n = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
    return isFinite(n) ? n : NaN;
  }

  // 시트 3장(배열의 배열이 아니라 객체 배열)을 받아 검증한다.
  // 틀린 줄은 버리지 않고 issues 에 남긴다 — 조용히 빠지면 부하가 적게 나와도 아무도 모른다.
  function normalize(raw) {
    var issues = [], roadmap = [], rules = [], capacity = [];
    (raw.roadmap || []).forEach(function (r, i) {
      var o = { project: String(pick(r, 'project') || '').trim(), stage: String(pick(r, 'stage') || '').trim(),
        start: toDate(pick(r, 'start')), end: toDate(pick(r, 'end')), row: i + 2 };
      if (!o.project && !o.stage) return;                     // 빈 줄
      if (!o.project || !o.stage) { issues.push('로드맵 ' + o.row + '행: 프로젝트나 단계가 비어 있습니다'); return; }
      if (!o.start || !o.end) { issues.push('로드맵 ' + o.row + '행(' + o.project + ' ' + o.stage + '): 날짜를 읽지 못했습니다'); return; }
      if (o.end < o.start) { issues.push('로드맵 ' + o.row + '행(' + o.project + ' ' + o.stage + '): 종료일이 시작일보다 앞섭니다'); return; }
      roadmap.push(o);
    });
    (raw.rules || []).forEach(function (r, i) {
      var o = { stage: String(pick(r, 'stage') || '').trim(), dept: String(pick(r, 'dept') || '').trim(),
        fte: num(pick(r, 'fte')), project: String(pick(r, 'project') || '').trim() };
      if (!o.stage && !o.dept) return;
      if (!o.stage || !o.dept || !(o.fte >= 0)) { issues.push('부하기준 ' + (i + 2) + '행: 단계·부문·투입 중 빈 값이 있습니다'); return; }
      rules.push(o);
    });
    (raw.capacity || []).forEach(function (r, i) {
      var o = { dept: String(pick(r, 'dept') || '').trim(), fte: num(pick(r, 'fte')) };
      if (!o.dept) return;
      if (!(o.fte >= 0)) { issues.push('가용인력 ' + (i + 2) + '행(' + o.dept + '): 가용 인원이 숫자가 아닙니다'); return; }
      capacity.push(o);
    });
    // 로드맵에 있는데 기준이 하나도 없는 단계 — 부하 0 으로 계산되니 알린다
    var ruled = {}; rules.forEach(function (r) { ruled[r.stage] = 1; });
    var seen = {};
    roadmap.forEach(function (r) {
      if (!ruled[r.stage] && !seen[r.stage]) { seen[r.stage] = 1; issues.push('단계 「' + r.stage + '」에 부하기준이 없어 부하 0 으로 계산합니다'); }
    });
    var capDept = {}; capacity.forEach(function (c) { capDept[c.dept] = 1; });
    var seenD = {};
    rules.forEach(function (r) {
      if (!capDept[r.dept] && !seenD[r.dept]) { seenD[r.dept] = 1; issues.push('부문 「' + r.dept + '」의 가용 인원이 없어 부족 판정을 하지 않습니다'); }
    });
    return { roadmap: roadmap, rules: rules, capacity: capacity, issues: issues };
  }

  /* ---------- 부하 계산 ---------- */
  function rulesFor(rules, project, stage) {
    var own = rules.filter(function (r) { return r.stage === stage && r.project === project; });
    if (own.length) return own;                                // 기종 전용 기준이 이긴다
    return rules.filter(function (r) { return r.stage === stage && !r.project; });
  }

  // 결과: { weeks:[주 시작일], depts:[], load:{dept:[주별]}, cap:{dept:n}, parts:{dept:[주별 [{project,stage,fte}]]} }
  function compute(data, range) {
    var rm = data.roadmap;
    var depts = [];
    function addDept(d) { if (depts.indexOf(d) < 0) depts.push(d); }
    data.capacity.forEach(function (c) { addDept(c.dept); });
    data.rules.forEach(function (r) { addDept(r.dept); });
    var cap = {}; data.capacity.forEach(function (c) { cap[c.dept] = c.fte; });
    if (!rm.length) return { weeks: [], depts: depts, load: {}, cap: cap, parts: {} };

    var lo = range && range.from ? toDate(range.from) : null;
    var hi = range && range.to ? toDate(range.to) : null;
    var min = lo || rm.reduce(function (a, r) { return r.start < a ? r.start : a; }, rm[0].start);
    var max = hi || rm.reduce(function (a, r) { return r.end > a ? r.end : a; }, rm[0].end);
    var weeks = [];
    for (var w = monday(min); w <= max; w = addDays(w, 7)) weeks.push(w);

    var load = {}, parts = {};
    depts.forEach(function (d) { load[d] = weeks.map(function () { return 0; }); parts[d] = weeks.map(function () { return []; }); });
    rm.forEach(function (r) {
      var rs = rulesFor(data.rules, r.project, r.stage);
      if (!rs.length) return;
      weeks.forEach(function (ws, i) {
        var we = addDays(ws, 6);
        var a = r.start > ws ? r.start : ws, b = r.end < we ? r.end : we;
        if (b < a) return;
        var frac = workdays(a, b) / 5;                       // 그 주에 걸친 근무일(월~금) 비율
        if (!frac) return;
        rs.forEach(function (rule) {
          var v = rule.fte * frac;
          if (!v) return;
          load[rule.dept][i] += v;
          parts[rule.dept][i].push({ project: r.project, stage: r.stage, fte: v });
        });
      });
    });
    depts.forEach(function (d) { load[d] = load[d].map(round2); });
    return { weeks: weeks, depts: depts, load: load, cap: cap, parts: parts };
  }
  function round2(x) { return Math.round(x * 100) / 100; }
  // a~b(같은 주 안) 사이의 월~금 날 수. 주말만 걸친 단계는 부하가 없다.
  function workdays(a, b) {
    var n = 0;
    for (var t = a; t <= b; t = addDays(t, 1)) { var w = t.getUTCDay(); if (w >= 1 && w <= 5) n++; }
    return n;
  }

  // 칸 판정: 부족(가용 초과) / 빠듯(90% 이상) / 적정 / 여유(50% 미만) / 기준없음
  function status(load, cap) {
    if (cap == null) return 'none';
    if (cap === 0) return load > 0 ? 'over' : 'idle';
    var r = load / cap;
    if (r > 1.0001) return 'over';
    if (r >= 0.9) return 'tight';
    if (r < 0.5) return 'idle';
    return 'ok';
  }

  // 부문별 요약: 최대 부하, 부족 주 수, 부족 누적(인·주)
  function summary(res) {
    return res.depts.map(function (d) {
      var L = res.load[d] || [], c = res.cap[d];
      var peak = 0, peakAt = -1, overWeeks = 0, shortage = 0;
      L.forEach(function (v, i) {
        if (v > peak) { peak = v; peakAt = i; }
        if (c != null && v > c + 1e-9) { overWeeks++; shortage += v - c; }
      });
      return { dept: d, cap: c, peak: round2(peak), peakWeek: peakAt >= 0 ? fmt(res.weeks[peakAt]) : '',
        overWeeks: overWeeks, shortage: round2(shortage) };
    });
  }

  /* ---------- 사유 ---------- */
  // 한 부문·한 주가 왜 그만큼인지: 어떤 기종의 어떤 단계가 몇 명을 쓰는지, 지난주보다 무엇이 늘고 줄었는지.
  function explain(res, dept, i) {
    var cur = group(res.parts[dept][i]);
    var prev = i > 0 ? group(res.parts[dept][i - 1]) : {};
    var L = res.load[dept][i], c = res.cap[dept];
    var lines = Object.keys(cur).map(function (k) { return { key: k, fte: round2(cur[k]) }; })
      .sort(function (a, b) { return b.fte - a.fte; });
    var changes = [];
    var keys = {}; Object.keys(cur).concat(Object.keys(prev)).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var d = round2((cur[k] || 0) - (prev[k] || 0));
      if (Math.abs(d) < 0.005) return;
      changes.push({ key: k, delta: d, kind: !prev[k] ? '시작' : !cur[k] ? '종료' : d > 0 ? '증가' : '감소' });
    });
    changes.sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); });
    var st = status(L, c), text;
    if (st === 'over') text = '가용 ' + c + '명보다 ' + round2(L - c) + '명 많습니다.';
    else if (st === 'none') text = '가용 인원이 없어 부족 판정을 하지 않았습니다.';
    else text = '가용 ' + c + '명 중 ' + L + '명을 씁니다.';
    if (lines.length) text += ' 가장 큰 몫은 ' + lines[0].key + '(' + lines[0].fte + '명)입니다.';
    var up = changes.filter(function (x) { return x.delta > 0; })[0];
    var down = changes.filter(function (x) { return x.delta < 0; })[0];
    if (up) text += ' 지난주보다 ' + up.key + ' ' + up.kind + '으로 ' + up.delta + '명 늘었습니다.';
    if (down) text += (up ? ' 반면 ' : ' 지난주보다 ') + down.key + ' ' + down.kind + '으로 ' + Math.abs(down.delta) + '명 줄었습니다.';
    return { dept: dept, week: fmt(res.weeks[i]), load: L, cap: c, status: st, lines: lines, changes: changes, text: text };
  }
  function group(list) {
    var g = {};
    (list || []).forEach(function (p) { var k = p.project + ' · ' + p.stage; g[k] = (g[k] || 0) + p.fte; });
    return g;
  }

  /* ---------- 가정(시나리오) ---------- */
  // 원본을 바꾸지 않고 복사본에 가정을 적용한다. 가정마다 사유 메모(note)를 함께 둔다
  // — 「데이터 밖의 이유로 일정이 바뀐」 것을 기록하는 자리다.
  //   { type:'shift', project, stage:'*'|단계, weeks, cascade:true|false, note }
  //       cascade 면 그 단계와 뒤따르는 단계(시작일이 같거나 늦은 것)를 함께 민다
  //   { type:'stretch', project, stage, weeks, note }   — 단계 기간을 늘리거나 줄인다(종료일만 이동)
  //   { type:'fte', stage, dept, fte, note }            — 부하기준 변경(그 단계·부문의 일반 기준)
  //   { type:'capacity', dept, fte, note }              — 가용 인원 변경
  function clone(data) {
    return {
      roadmap: data.roadmap.map(function (r) { return { project: r.project, stage: r.stage, start: r.start, end: r.end, row: r.row }; }),
      rules: data.rules.map(function (r) { return { stage: r.stage, dept: r.dept, fte: r.fte, project: r.project }; }),
      capacity: data.capacity.map(function (c) { return { dept: c.dept, fte: c.fte }; }),
      issues: []
    };
  }
  function apply(data, adjustments) {
    var d = clone(data), log = [];
    (adjustments || []).forEach(function (a) {
      var n = 0;
      if (a.type === 'shift') {
        var days = Math.round((+a.weeks || 0) * 7);
        var anchor = null;
        if (a.stage && a.stage !== '*') {
          d.roadmap.forEach(function (r) { if (r.project === a.project && r.stage === a.stage) anchor = r.start; });
        }
        d.roadmap.forEach(function (r) {
          if (r.project !== a.project) return;
          var hit = !a.stage || a.stage === '*' || r.stage === a.stage || (a.cascade && anchor && r.start >= anchor);
          if (!hit) return;
          r.start = addDays(r.start, days); r.end = addDays(r.end, days); n++;
        });
      } else if (a.type === 'stretch') {
        var dd = Math.round((+a.weeks || 0) * 7);
        d.roadmap.forEach(function (r) {
          if (r.project === a.project && r.stage === a.stage) {
            var e = addDays(r.end, dd);
            r.end = e < r.start ? r.start : e; n++;
          }
        });
      } else if (a.type === 'fte') {
        d.rules.forEach(function (r) { if (r.stage === a.stage && r.dept === a.dept && !r.project) { r.fte = +a.fte; n++; } });
        if (!n) { d.rules.push({ stage: a.stage, dept: a.dept, fte: +a.fte, project: '' }); n = 1; }
      } else if (a.type === 'capacity') {
        d.capacity.forEach(function (c) { if (c.dept === a.dept) { c.fte = +a.fte; n++; } });
        if (!n) { d.capacity.push({ dept: a.dept, fte: +a.fte }); n = 1; }
      }
      log.push({ adj: a, touched: n });
    });
    return { data: d, log: log };
  }
  function describe(a) {
    if (a.type === 'shift') return a.project + ' ' + (a.stage && a.stage !== '*' ? a.stage + (a.cascade ? ' 이후 전체' : '') : '전 단계') + ' ' + signed(a.weeks) + '주 이동';
    if (a.type === 'stretch') return a.project + ' ' + a.stage + ' 기간 ' + signed(a.weeks) + '주';
    if (a.type === 'fte') return a.stage + ' 단계의 ' + a.dept + ' 투입을 ' + a.fte + '명으로';
    if (a.type === 'capacity') return a.dept + ' 가용 인원을 ' + a.fte + '명으로';
    return '';
  }
  function signed(x) { x = +x; return (x > 0 ? '+' : '') + x; }

  // 전후 비교 — 두 결과의 주 범위가 다를 수 있으니 합집합 주로 맞춰 다시 센다.
  function compare(base, alt, range) {
    var lo = null, hi = null;
    [base, alt].forEach(function (d) {
      d.roadmap.forEach(function (r) { if (!lo || r.start < lo) lo = r.start; if (!hi || r.end > hi) hi = r.end; });
    });
    var rg = range || (lo ? { from: fmt(lo), to: fmt(hi) } : null);
    var A = compute(base, rg), B = compute(alt, rg);
    var sa = summary(A), sb = summary(B);
    var rows = sb.map(function (b) {
      var a = sa.filter(function (x) { return x.dept === b.dept; })[0] || { peak: 0, overWeeks: 0, shortage: 0, cap: null };
      return { dept: b.dept, capBefore: a.cap, capAfter: b.cap, peakBefore: a.peak, peakAfter: b.peak,
        overBefore: a.overWeeks, overAfter: b.overWeeks, shortBefore: a.shortage, shortAfter: b.shortage,
        shortDelta: round2(b.shortage - a.shortage) };
    });
    return { before: A, after: B, rows: rows };
  }

  /* ---------- 예제 ---------- */
  // 실제 사내 데이터가 아니다. 모양만 비슷하게 만든 가짜 로드맵이다.
  function sample() {
    var stages = [['개발', 16], ['시험', 8], ['검증', 6], ['생산준비', 6], ['생산', 4]];
    var projects = [['HX-14 신기종', '2026-01-05'], ['HX-22 개량형', '2026-03-02'], ['HX-35 전동화', '2026-04-13'], ['HX-08 수출형', '2026-06-01']];
    var roadmap = [];
    projects.forEach(function (p) {
      var s = toDate(p[1]);
      stages.forEach(function (st) {
        var e = addDays(s, st[1] * 7 - 3);                    // 금요일에 끝난다
        roadmap.push({ 프로젝트: p[0], 단계: st[0], 시작일: fmt(s), 종료일: fmt(e) });
        s = addDays(e, 3);
      });
    });
    var rules = [
      { 단계: '개발', 부문: '설계', 주당투입: 6 }, { 단계: '개발', 부문: '해석', 주당투입: 2 },
      { 단계: '시험', 부문: '시험', 주당투입: 5 }, { 단계: '시험', 부문: '설계', 주당투입: 2 },
      { 단계: '검증', 부문: '시험', 주당투입: 3 }, { 단계: '검증', 부문: '품질', 주당투입: 3 }, { 단계: '검증', 부문: '해석', 주당투입: 1 },
      { 단계: '생산준비', 부문: '생산기술', 주당투입: 5 }, { 단계: '생산준비', 부문: '품질', 주당투입: 2 },
      { 단계: '생산', 부문: '생산기술', 주당투입: 2 }, { 단계: '생산', 부문: '품질', 주당투입: 1 },
      { 프로젝트: 'HX-35 전동화', 단계: '개발', 부문: '설계', 주당투입: 9 },
      { 프로젝트: 'HX-35 전동화', 단계: '개발', 부문: '해석', 주당투입: 4 }
    ];
    var capacity = [
      { 부문: '설계', 가용: 14 }, { 부문: '해석', 가용: 5 }, { 부문: '시험', 가용: 7 },
      { 부문: '품질', 가용: 5 }, { 부문: '생산기술', 가용: 7 }
    ];
    return { roadmap: roadmap, rules: rules, capacity: capacity };
  }

  var api = { toDate: toDate, fmt: fmt, monday: monday, normalize: normalize, compute: compute, status: status,
    summary: summary, explain: explain, apply: apply, describe: describe, compare: compare, sample: sample, ALIASES: ALIASES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sim = api;
})(this);
