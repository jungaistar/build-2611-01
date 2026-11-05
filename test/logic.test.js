/* 계산 규칙 고정 — node test/logic.test.js
 * 화면이 아니라 숫자가 틀리면 안 되는 도구다. 부하·부족·사유·가정 적용을 손으로 센 값과 대조한다. */
'use strict';
var S = require('../js/sim.js');
var passed = 0, failed = 0;
function ok(c, label, detail) { if (c) passed++; else { failed++; console.log('  X ' + label + (detail ? '\n      ' + detail : '')); } }
function eq(g, w, label) { ok(JSON.stringify(g) === JSON.stringify(w), label, '기대: ' + JSON.stringify(w) + '  실제: ' + JSON.stringify(g)); }

// 날짜
eq(S.fmt(S.toDate('2026-03-02')), '2026-03-02', 'ISO 날짜');
eq(S.fmt(S.toDate('2026.3.2')), '2026-03-02', '점 구분 날짜');
eq(S.fmt(S.toDate('2026년 3월 2일')), '2026-03-02', '한글 날짜');
eq(S.fmt(S.toDate(46083)), '2026-03-02', '엑셀 일련번호');
eq(S.toDate('2026-02-30'), null, '없는 날짜는 거른다');
eq(S.toDate(12), null, '날짜가 아닌 숫자는 거른다');
eq(S.fmt(S.monday(S.toDate('2026-03-05'))), '2026-03-02', '주 시작은 월요일');

// 단순 사례: 한 단계 2주(월~금 두 번) 설계 7명, 가용 3명
var raw = {
  roadmap: [{ 프로젝트: 'A', 단계: '개발', 시작일: '2026-03-02', 종료일: '2026-03-13' }],
  rules: [{ 단계: '개발', 부문: '설계', 주당투입: 7 }],
  capacity: [{ 부문: '설계', 가용: 3 }]
};
var d = S.normalize(raw);
eq(d.issues, [], '깨끗한 입력은 경고가 없다');
var r = S.compute(d);
eq(r.weeks.map(S.fmt), ['2026-03-02', '2026-03-09'], '주 2개');
eq(r.load['설계'], [7, 7], '월~금을 채운 주는 7명 그대로');
eq(S.summary(r)[0], { dept: '설계', cap: 3, peak: 7, peakWeek: '2026-03-02', overWeeks: 2, shortage: 8 }, '부족 2주 · 누적 8인주');
var half = S.compute(S.normalize({ roadmap: [{ 프로젝트: 'A', 단계: '개발', 시작일: '2026-03-02', 종료일: '2026-03-11' }],
  rules: raw.rules, capacity: raw.capacity }));
eq(half.load['설계'], [7, 4.2], '둘째 주 월~수 3일 = 7 × 3/5');
var wk = S.compute(S.normalize({ roadmap: [{ 프로젝트: 'A', 단계: '개발', 시작일: '2026-03-07', 종료일: '2026-03-08' }],
  rules: raw.rules, capacity: raw.capacity }));
eq(wk.load['설계'], [0], '주말만 걸치면 부하 0');
eq(S.status(5, 3), 'over', '가용 초과 = 부족');
eq(S.status(2.8, 3), 'tight', '90% 이상 = 빠듯');
eq(S.status(1, 3), 'idle', '50% 미만 = 여유');
eq(S.status(1, undefined), 'none', '가용 없음 = 판정 안 함');

// 입력 검증 — 틀린 줄은 버리지 않고 알린다
var bad = S.normalize({
  roadmap: [
    { 프로젝트: 'A', 단계: '개발', 시작일: '2026-03-10', 종료일: '2026-03-01' },
    { 프로젝트: 'A', 단계: '시험', 시작일: '모름', 종료일: '2026-03-01' },
    { 프로젝트: 'A', 단계: '양산', 시작일: '2026-03-01', 종료일: '2026-03-20' },
    { 프로젝트: '', 단계: '', 시작일: '', 종료일: '' }
  ],
  rules: [{ 단계: '개발', 부문: '해석', 주당투입: 2 }],
  capacity: []
});
eq(bad.roadmap.length, 1, '쓸 수 있는 줄만 남는다');
ok(bad.issues.some(function (s) { return s.indexOf('종료일이 시작일보다') >= 0; }), '역전 일정 경고');
ok(bad.issues.some(function (s) { return s.indexOf('날짜를 읽지 못했') >= 0; }), '날짜 오류 경고');
ok(bad.issues.some(function (s) { return s.indexOf('「양산」에 부하기준이 없어') >= 0; }), '기준 없는 단계 경고');
ok(bad.issues.some(function (s) { return s.indexOf('「해석」의 가용 인원이 없어') >= 0; }), '가용 없는 부문 경고');

// 열 이름이 달라도 읽는다
var alt = S.normalize({ roadmap: [{ 기종: 'B', 공정: '개발', 시작: '2026-03-02', 완료일: '2026-03-06' }],
  rules: [{ phase: '개발', 부서: '설계', fte: 1 }], capacity: [{ 팀: '설계', 가용인원: 2 }] });
eq([alt.roadmap.length, alt.rules.length, alt.capacity.length], [1, 1, 1], '열 이름 별칭');

// 기종 전용 기준이 일반 기준을 이긴다
var ov = S.normalize({
  roadmap: [{ 프로젝트: 'A', 단계: '개발', 시작일: '2026-03-02', 종료일: '2026-03-08' },
            { 프로젝트: 'B', 단계: '개발', 시작일: '2026-03-02', 종료일: '2026-03-08' }],
  rules: [{ 단계: '개발', 부문: '설계', 주당투입: 2 }, { 프로젝트: 'B', 단계: '개발', 부문: '설계', 주당투입: 5 }],
  capacity: [{ 부문: '설계', 가용: 10 }]
});
eq(S.compute(ov).load['설계'], [7], 'A 2 + B 전용 5 = 7 (B 에 일반 2 를 더하지 않는다)');

// 사유
var two = S.normalize({
  roadmap: [{ 프로젝트: 'A', 단계: '개발', 시작일: '2026-03-02', 종료일: '2026-03-15' },
            { 프로젝트: 'B', 단계: '개발', 시작일: '2026-03-09', 종료일: '2026-03-15' }],
  rules: [{ 단계: '개발', 부문: '설계', 주당투입: 3 }], capacity: [{ 부문: '설계', 가용: 4 }]
});
var r2 = S.compute(two);
eq(r2.load['설계'], [3, 6], 'B 가 둘째 주에 시작');
var ex = S.explain(r2, '설계', 1);
eq(ex.status, 'over', '둘째 주 부족');
eq(ex.changes[0], { key: 'B · 개발', delta: 3, kind: '시작' }, '늘어난 사유 = B 개발 시작');
ok(ex.text.indexOf('2명 많습니다') >= 0 && ex.text.indexOf('B · 개발 시작') >= 0, '사유 문장', ex.text);

// 가정: B 를 1주 늦추면 겹침이 사라진다
var sc = S.apply(two, [{ type: 'shift', project: 'B', stage: '*', weeks: 1, note: '부품 입고 지연' }]);
eq(two.roadmap[1].start.toISOString().slice(0, 10), '2026-03-09', '원본은 그대로');
eq(sc.data.roadmap[1].start.toISOString().slice(0, 10), '2026-03-16', '복사본만 1주 이동');
var cmp = S.compare(two, sc.data);
eq(cmp.rows[0].overBefore, 1, '전: 부족 1주');
eq(cmp.rows[0].overAfter, 0, '후: 부족 0주');
eq(cmp.rows[0].shortDelta, -2, '부족 누적 2인주 해소');

// cascade: 그 단계와 뒤 단계만 민다
var chain = S.normalize({
  roadmap: [{ 프로젝트: 'A', 단계: '개발', 시작일: '2026-03-02', 종료일: '2026-03-13' },
            { 프로젝트: 'A', 단계: '시험', 시작일: '2026-03-16', 종료일: '2026-03-27' },
            { 프로젝트: 'A', 단계: '생산', 시작일: '2026-03-30', 종료일: '2026-04-10' }],
  rules: [], capacity: []
});
var c2 = S.apply(chain, [{ type: 'shift', project: 'A', stage: '시험', weeks: 2, cascade: true }]).data;
eq(c2.roadmap.map(function (r) { return S.fmt(r.start); }), ['2026-03-02', '2026-03-30', '2026-04-13'], '시험 이후만 2주 이동');
var c3 = S.apply(chain, [{ type: 'shift', project: 'A', stage: '시험', weeks: 2, cascade: false }]).data;
eq(c3.roadmap.map(function (r) { return S.fmt(r.start); }), ['2026-03-02', '2026-03-30', '2026-03-30'], 'cascade 끄면 시험만');
var c4 = S.apply(chain, [{ type: 'stretch', project: 'A', stage: '개발', weeks: 1 }]).data;
eq(S.fmt(c4.roadmap[0].end), '2026-03-20', '기간 1주 연장');
var c5 = S.apply(chain, [{ type: 'stretch', project: 'A', stage: '개발', weeks: -9 }]).data;
eq(S.fmt(c5.roadmap[0].end), '2026-03-02', '줄여도 시작일보다 앞서지 않는다');

// 가용·기준 변경
var cap = S.apply(two, [{ type: 'capacity', dept: '설계', fte: 6 }]).data;
eq(S.compare(two, cap).rows[0].overAfter, 0, '가용 6명이면 부족 없음');
var fte = S.apply(two, [{ type: 'fte', stage: '개발', dept: '설계', fte: 1 }]).data;
eq(S.compute(fte).load['설계'], [1, 2], '기준 1명으로 낮춤');
eq(S.describe({ type: 'shift', project: 'B', stage: '시험', weeks: -2, cascade: true }), 'B 시험 이후 전체 -2주 이동', '가정 설명');

// 예제 데이터는 경고 없이 읽히고 부족 구간이 있어야 시연이 된다
var smp = S.normalize(S.sample());
eq(smp.issues, [], '예제 경고 없음');
ok(S.summary(S.compute(smp)).some(function (s) { return s.overWeeks > 0; }), '예제에 부족 구간이 있다');

console.log('\n통과 ' + passed + ' · 실패 ' + failed);
process.exit(failed ? 1 : 0);
