/* 브라우저에 실제로 띄워 화면이 그려지는지 본다 — node test/smoke.browser.js
 * 규칙 테스트가 다 통과해도 app.js 오타 하나면 빈 화면이 된다. playwright 가 없으면 건너뛴다. */
'use strict';
var http = require('http'), fs = require('fs'), path = require('path');
var chromium;
try { chromium = require('playwright').chromium; }
catch (e) { console.log('playwright 가 없어 화면 연기 테스트를 건너뜁니다.'); process.exit(0); }
var ROOT = path.join(__dirname, '..');
var MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
var srv = http.createServer(function (q, s) {
  var p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, function (e, b) { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); s.end(b); });
});
var passed = 0, failed = 0;
function ok(c, label, d) { if (c) passed++; else { failed++; console.log('  X ' + label + (d ? '  ' + d : '')); } }
srv.listen(0, async function () {
  var base = 'http://127.0.0.1:' + srv.address().port + '/';
  var br = await chromium.launch(); var pg = await br.newPage({ viewport: { width: 1280, height: 900 } });
  var errs = []; pg.on('pageerror', function (e) { errs.push(e.message); });
  try {
    await pg.goto(base);
    await pg.click('#btn-sample');
    await pg.waitForSelector('#heat td.cell', { timeout: 5000 });
    ok(await pg.isVisible('#s-load'), '부하 분석 영역이 열린다');
    var cells = await pg.$$eval('#heat td.cell', function (t) { return t.length; });
    ok(cells > 50, '부하 칸이 그려진다', cells);
    var over = await pg.$$eval('#heat td.st-over', function (t) { return t.length; });
    ok(over > 0, '예제에 부족 칸이 있다', over);
    await pg.click('#heat td.st-over');
    var why = await pg.textContent('#why');
    ok(/많습니다/.test(why), '부족 칸을 누르면 사유가 나온다', why.slice(0, 80));
    ok(await pg.$$eval('#chart polyline', function (t) { return t.length; }) === 1, '추이 선이 그려진다');
    await pg.selectOption('#a-type', 'shift');
    await pg.selectOption('#a-project', 'HX-35 전동화');
    await pg.fill('#a-weeks', '6');
    await pg.fill('#a-note', '협력사 금형 지연');
    await pg.click('#a-add');
    var cmp = await pg.textContent('#compare');
    ok(/전→후|→/.test(await pg.innerHTML('#compare')), '전후 비교표가 나온다');
    ok(/협력사 금형 지연/.test(await pg.textContent('#adj-list')), '사유 메모가 목록에 남는다');
    ok(await pg.$$eval('#compare polyline', function (t) { return t.length; }) === 2, '전후 두 선');
    await pg.goto(base + 'guide.html');
    ok(/시트 3장/.test(await pg.textContent('main')), '사용법 페이지');
  } catch (e) { failed++; console.log('  X 예외: ' + e.message); }
  ok(!errs.length, '페이지 오류 없음', errs.join(' | '));
  await br.close(); srv.close();
  console.log('\n화면 통과 ' + passed + ' · 실패 ' + failed);
  process.exit(failed ? 1 : 0);
});
