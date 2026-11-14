'use strict';
/* ================================================================
   地合い定石カレンダー (公開版ビューアー)
   final/build.py (完成モック生成器) の忠実な JS 移植。
   設計の正本は FINAL-DESIGN.md、見せ方は styles.css (モックと同一)。
   データは data.json (generate_daily.py の日次生成、価格系フィールドなし)。
   ================================================================ */
const DOWN = { '大': '中', '中': '小', '小': '小' };
const W = { '大': 100, '中': 10, '小': 1 };
const R = { '大': 3, '中': 2, '小': 1 };
const BR = { '統計': 3, '経験則': 2, '根拠未確認': 1, '眉唾': 1 };
const CR = { 'event': 0, 'monthly': 1, 'cycle': 2 };
const WD = ['月', '火', '水', '木', '金', '土', '日'];

const TERM_FALLBACK = {
  'mega-earnings': ['決算', '会社の成績発表のこと'],
  'earnings-season': ['決算', '会社の成績発表のこと'],
  'november-earnings-us': ['決算', '会社の成績発表のこと'],
  'boj-meeting': ['日銀', '日本銀行の会議。金利などの方針が決まり、円や市場の空気が動くことがある'],
  'us-employment': ['米雇用統計', 'アメリカの働く人の数の発表。日本の夜に出て、翌日の朝の値段に持ち越される'],
  'ex-dividend': ['配当・権利落ち', '配当をもらえる権利がなくなる日。その分だけ値段が下って始まる（会社の調子が悪くなったわけではない下げ）'],
};
const TERM_NAME = {
  'sq-week': 'SQ', 'us-cpi': '米CPI', 'fomc': 'FOMC',
  'earnings-cross': '決算跨ぎと出尽くし', 'eto-anomaly': 'アノマリー',
  'sell-in-may': 'セルインメイ', 'year-end-rally': '掉尾の一振',
};

let DATA = null;      // data.json 全体
let pat = {};         // 当日アクティブな定石 (id -> patterns[] の要素)
let meta = {};        // 全定石のメタ (id -> allPatterns[] の要素: name/level/basis/kind/category/sectors)
let STOCKS = [];      // 母集団 (data.json の stocks)
let JPX_ORDER = [];   // セクタ初出順 (JPX業種順の代理、モック判断 J4 と同じ)

function esc(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function diffDays(a, b) { return Math.round((a - b) / 86400000); }

function termInfo(pid) {
  const p = pat[pid] || meta[pid] || {};
  const gloss = pat[pid] ? pat[pid].gloss : undefined;
  if (pid in TERM_FALLBACK) {
    const [name, fb] = TERM_FALLBACK[pid];
    return [name, gloss || fb];
  }
  if (pid in TERM_NAME) {
    return gloss ? [TERM_NAME[pid], gloss] : null;
  }
  return null;
}
function termHtml(pid, extraCls, display) {
  const p = pat[pid] || meta[pid];
  const ti = termInfo(pid);
  const label = display !== undefined && display !== null ? display : p.name;
  if (ti) {
    return '<button type="button" class="term ' + (extraCls || '') + '" data-term="' + esc(ti[0]) +
      '" data-tip="' + esc(ti[1]) + '" aria-expanded="false" aria-describedby="tip">' +
      esc(label) + '<span class="ic" aria-hidden="true">?</span></button>';
  }
  return '<span class="pat-label ' + (extraCls || '') + '">' + esc(label) + '</span>';
}
function shortName(pid) { return (pat[pid] || meta[pid]).name.split(' (')[0]; }
function lv(level) {
  const bars = '<i></i>'.repeat(3);
  return '<span class="imp imp-' + level + '" role="img" aria-label="影響の可能性 ' + level + '">' +
    '<span class="bars" aria-hidden="true">' + bars + '</span>' +
    '<span class="imp-w" aria-hidden="true">' + level + '</span></span>';
}
function rawLevel(pid) { return (meta[pid] || pat[pid]).level; }
function patKey(pid) {
  const p = pat[pid] || meta[pid];
  return [-R[rawLevel(pid)], -BR[p.basis], CR[p.category], p.name];
}
function cmpKey(a, b) {
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] - b[i]; }
  return a[3] < b[3] ? -1 : (a[3] > b[3] ? 1 : 0);
}
function sortByPatKey(pids) { return [...pids].sort((x, y) => cmpKey(patKey(x), patKey(y))); }
function classify(p, sector) {
  if (p.category !== 'cycle' && p.sectors.includes(sector)) return 'specific';
  if (p.sectors.includes('市場全体') || p.sectors.includes(sector)) return 'background';
  return null;
}
function effLevel(level) { return DOWN[level]; }

/* ---------- 時間分類 (FINAL-DESIGN §6、モック make_classifier の移植) ----------
   本番データは generatedFor 当日向けに生成されるため、eventDateNote の日付は
   常に対象日に対して有効 (モックの J2 仮置きは不要)。 */
function noteDates(p) {
  const note = p.eventDateNote || '';
  const ds = [];
  const re = /(\d{1,2})月(\d{1,2})日(?:\s*〜\s*(\d{1,2})日)?/g;
  let m;
  while ((m = re.exec(note)) !== null) {
    ds.push([Number(m[1]), Number(m[2])]);
    if (m[3]) ds.push([Number(m[1]), Number(m[3])]);
  }
  return ds;
}
function makeClassifier(today) {
  const tm = [today.getMonth() + 1, today.getDate()];
  function bucket(p) {
    const ds = noteDates(p);
    const note = p.eventDateNote || '';
    if (ds.length >= 2 && note.includes('〜')) {
      const start = new Date(today.getFullYear(), ds[0][0] - 1, ds[0][1]);
      const end = new Date(today.getFullYear(), ds[ds.length - 1][0] - 1, ds[ds.length - 1][1]);
      if (start <= today && today <= end) return 'period';
      if (end < today && diffDays(today, end) <= 7) return 'past';
      if (start > today && diffDays(start, today) <= 7) return 'future';
      return 'period';
    }
    if (ds.length === 1) {
      const d = new Date(today.getFullYear(), ds[0][0] - 1, ds[0][1]);
      const diff = diffDays(d, today);
      if (diff === 0) return 'today';
      if (0 < diff && diff <= 7) return 'future';
      if (-7 <= diff && diff < 0) return 'past';
      return 'excluded';
    }
    return 'period';
  }
  function marks(p) {
    const ds = noteDates(p);
    const note = p.eventDateNote || '';
    const out = [];
    if (ds.length >= 2 && note.includes('〜')) {
      if (ds[0][0] === tm[0] && ds[0][1] === tm[1]) out.push('今日から');
      const last = ds[ds.length - 1];
      if (last[0] === tm[0] && last[1] === tm[1]) out.push('今日まで');
    }
    return out;
  }
  function whenLabel(p, b) {
    const ds = noteDates(p);
    const note = p.eventDateNote || '';
    if (['today', 'future', 'past'].includes(b) && ds.length) return ds[0][0] + '/' + ds[0][1];
    if (ds.length >= 2 && note.includes('〜')) {
      const [sm, sd] = ds[0]; const [em, ed] = ds[ds.length - 1];
      if (sm === em) return sm + '月' + sd + '日〜' + ed + '日';
      return sm + '月' + sd + '日〜' + em + '月' + ed + '日';
    }
    let seg = p.periodText.split('。')[0];
    const open = (seg.match(/（/g) || []).length, close = (seg.match(/）/g) || []).length;
    if (open > close && p.periodText.includes('。')) seg += '。' + p.periodText.split('。')[1];
    return (seg.includes('〜') && seg.length <= 16) ? seg : '';
  }
  return { bucket, marks, whenLabel };
}
const BUCKET_LABEL = { today: '今日', period: 'この時期', future: 'これから', past: '過ぎた' };
const BUCKET_ORDER = ['today', 'period', 'future', 'past'];

/* ---------- 要点一文 (FINAL-DESIGN §2: 実事実からのみ自動生成、最大2分の節) ----------
   モックでは実例ごとに手書きだった一文を、本番ではデータから機械生成する。
   使う材料は「今日バケットのイベント事実」と「今日までで終わる範囲型」だけ。 */
const FACT_PHRASE = {
  'sq-week': 'SQ日', 'us-cpi': '米CPIの発表日', 'fomc': 'FOMCの日',
  'boj-meeting': '日銀の会合の日', 'us-employment': '米雇用統計の発表日',
  'mega-earnings': '大きな会社の決算発表の日', 'ex-dividend': '配当の権利落ちの日',
};
const END_PHRASE = { 'earnings-season': '決算の山は最終日' };
function composeFact(groups, marksOf, specPids, bucketOf) {
  const clauses = [];
  const todayPids = groups.today || [];
  if (todayPids.length) {
    const phrases = todayPids.map(pid => FACT_PHRASE[pid] || (shortName(pid) + 'の日'));
    clauses.push('今日は' + phrases.join('と') + '。');
  }
  const ending = [];
  for (const key of BUCKET_ORDER) {
    for (const pid of (groups[key] || [])) {
      if (!todayPids.includes(pid) && marksOf(pat[pid]).includes('今日まで')) ending.push(pid);
    }
  }
  if (ending.length && clauses.length < 2) {
    const pid = ending[0];
    clauses.push(END_PHRASE[pid] ? END_PHRASE[pid] + '。' : shortName(pid) + 'は今日まで。');
  }
  if (clauses.length === 1 && specPids.length) {
    // 1文だけでは薄い日は、期間型の固有の定石を第2文に足す (最大2分の節は維持)
    const periodSpec = specPids.filter(pid => bucketOf[pid] === 'period' && !todayPids.includes(pid));
    if (periodSpec.length) {
      const names = periodSpec.slice(0, 3).map(pid => shortName(pid));
      clauses.push(names.join('、') + 'が重なる時期です。');
    }
  }
  if (!clauses.length) {
    if (specPids.length) {
      const periodSpec = specPids.filter(pid => bucketOf[pid] === 'period');
      const base = periodSpec.length ? periodSpec : specPids;
      const names = base.slice(0, 4).map(pid => shortName(pid));
      clauses.push(names.join('、') + 'が重なる時期です。');
    } else {
      clauses.push('今日は、業種に固有に効く定石のない日です。');
    }
  }
  return clauses.join('');
}

/* ---------- 休場・先行表示の注記 (2026-11-14 追加) ----------
   data.json は「対象日 (generatedFor)」の内容。訪問者の JST の今日と比べ、
   generatedFor が未来の営業日のときだけ、FV の date-line 直下に最大1行出す。
   判定材料は data.json 同梱の marketCalendar (JPX 休場日)。通常表示
   (generatedFor = 今日) では何も出さない。 */
function jstTodayIso() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const v = {};
  for (const p of parts) v[p.type] = p.value;
  return v.year + '-' + v.month + '-' + v.day;
}
function isBusinessDay(iso) {
  const d = parseDate(iso);
  const wd = d.getDay();
  if (wd === 0 || wd === 6) return false;
  const byYear = (DATA.marketCalendar && DATA.marketCalendar.holidaysByYear) || {};
  const list = byYear[String(d.getFullYear())];
  return list ? !list.includes(iso) : true;
}
function wdLabel(d) { return WD[d.getDay() === 0 ? 6 : d.getDay() - 1]; }
function marketNoteText(genStr) {
  const visitorToday = jstTodayIso();
  if (genStr <= visitorToday) return '';
  const gd = parseDate(genStr);
  const genMd = (gd.getMonth() + 1) + '月' + gd.getDate() + '日・' + wdLabel(gd);
  if (!isBusinessDay(visitorToday)) {
    const td = parseDate(visitorToday);
    return '今日（' + (td.getMonth() + 1) + '月' + td.getDate() + '日）は休場日のため、次の営業日（' +
      genMd + '）の地合いを表示しています。';
  }
  return '本日の市場は終了したため、次の営業日（' + genMd + '）の地合いを表示しています。';
}

/* ---------- メインビュー (モック build_page の移植) ---------- */
let SEARCH_DATA = [];
function buildMain() {
  const genStr = DATA.generatedFor;
  const today = parseDate(genStr);
  const y = today.getFullYear(), m = today.getMonth() + 1, dd = today.getDate();
  const genLabel = y + '年' + m + '月' + dd + '日（' + wdLabel(today) + '）';
  const marketNote = marketNoteText(genStr);
  const junItems = DATA.jun.items;
  const jun = junItems.find(j => j.start <= genStr && genStr <= j.end);
  const junLabel = jun.label;
  const activeIds = [...jun.patternIds];
  const { bucket, marks, whenLabel } = makeClassifier(today);
  const bucketOf = {}, marksOf = p => marks(p), whenOf = (p, b) => whenLabel(p, b);
  for (const pid of activeIds) bucketOf[pid] = bucket(pat[pid]);

  const specOf = {}, backOf = {};
  for (const s of STOCKS) {
    const spec = {}, back = [];
    for (const pid of activeIds) {
      if (bucketOf[pid] === 'excluded') continue;
      const c = classify(pat[pid], s.sector);
      if (c === 'specific') spec[pid] = effLevel(rawLevel(pid));
      else if (c === 'background') back.push(pid);
    }
    specOf[s.code] = spec; backOf[s.code] = back;
  }
  const shownIds = activeIds.filter(pid => bucketOf[pid] !== 'excluded');
  const specPids = sortByPatKey(shownIds.filter(pid => STOCKS.some(s => pid in specOf[s.code])));
  const backGlobal = sortByPatKey(shownIds.filter(pid => !specPids.includes(pid)));
  const hitStocks = STOCKS.filter(s => Object.keys(specOf[s.code]).length);
  const hitSectors = [];
  for (const s of hitStocks) if (!hitSectors.includes(s.sector)) hitSectors.push(s.sector);
  const S = hitSectors.length, N = hitStocks.length;
  const stage = (S >= 10 || N > 80) ? '最重量日' : (S >= 7 || N >= 61) ? '重い日' : '通常日';
  const stageAttr = stage === '最重量日' ? 'heaviest' : (stage === '重い日' ? 'heavy' : 'normal');

  // ブロック3: 今日の定石
  function chipLevel(pid) { return specPids.includes(pid) ? effLevel(rawLevel(pid)) : rawLevel(pid); }
  const groups = { today: [], period: [], future: [], past: [] };
  for (const pid of shownIds) groups[bucketOf[pid]].push(pid);
  let timeGroups = '';
  for (const key of BUCKET_ORDER) {
    const pids = sortByPatKey(groups[key]);
    if (!pids.length) continue;
    let items = '';
    for (const pid of pids) {
      const p = pat[pid];
      const wl = whenOf(p, bucketOf[pid]);
      const whenChip = wl ? '<span class="when-chip">' + esc(wl) + '</span>' : '';
      const markChips = marksOf(p).map(mk => '<span class="mark-chip">' + esc(mk) + '</span>').join('');
      // eventDateNote の文面そのものを注記として行内に併記する (2026-11-14 追加、
      // 同日 widthfix で置き場を変更)。どの会社の決算か等が画面から読めるように
      // するためで、文面は data.json の既存文字列をそのまま使う (新しい文は
      // 作らない)。分類・チップ・並びは不変。
      // 置き場は .time-item の内側末尾: 独立した li で同列フローに置くと、
      // ウィンドウ幅によっては注記が行の右端の外へ押し出されて見えなくなる
      // 欠陥があったため、行の中で折り返せる子要素として持つ (広い幅では
      // 現行どおり同列、狭い幅では行の下へ回り込んで必ず画面内に収まる)。
      const evNote = p.eventDateNote ? '<span class="ev-note">' + esc(p.eventDateNote) + '</span>' : '';
      items += '<li class="time-item" data-pid="' + pid + '">' + termHtml(pid) + lv(chipLevel(pid)) + whenChip + markChips + evNote + '</li>';
    }
    let plain = '';
    if (key === 'period') {
      plain = '<p class="period-plain">' + pids.map(pid => esc(shortName(pid))).join('／') + '</p>';
    }
    timeGroups += '<div class="time-group" data-bucket="' + key + '">\n' +
      '      <h3 class="time-h">' + BUCKET_LABEL[key] + '<span class="cnt">' + pids.length + '件</span></h3>\n' +
      '      <ul class="time-list">' + items + '</ul>' + plain + '</div>';
  }

  // ブロック4: セクタと銘柄
  function sectorPatterns(sector) {
    const pids = {};
    for (const s of STOCKS) {
      if (s.sector !== sector) continue;
      for (const pid of Object.keys(specOf[s.code])) pids[pid] = specOf[s.code][pid];
    }
    return sortByPatKey(Object.keys(pids)).map(pid => [pid, pids[pid]]);
  }
  function sectorStocks(sector) {
    return STOCKS.filter(s => s.sector === sector && Object.keys(specOf[s.code]).length)
      .sort((a, b) => (-a.impactScore + b.impactScore) || (a.code < b.code ? -1 : 1));
  }
  const panels = [];
  for (const sec of hitSectors) {
    const patsHere = sectorPatterns(sec);
    const score = patsHere.reduce((acc, [, e]) => acc + W[e], 0);
    const maxlv = patsHere.length ? patsHere.map(([, e]) => e).sort((a, b) => R[b] - R[a])[0] : '小';
    panels.push({ sector: sec, patterns: patsHere, stocks: sectorStocks(sec), score, maxlv });
  }
  panels.sort((a, b) => (-a.score + b.score) || (JPX_ORDER.indexOf(a.sector) - JPX_ORDER.indexOf(b.sector)));
  const maxScore = panels.reduce((acc, pd) => Math.max(acc, pd.score), 0);
  let secRows = '';
  panels.forEach((pd, i) => {
    let chips = '';
    pd.patterns.forEach(([pid, e], ci) => {
      const b = bucketOf[pid];
      let dateChip = '';
      if (b === 'past' || b === 'future') {
        dateChip = '<span class="when-chip">' + BUCKET_LABEL[b] + whenOf(pat[pid], b) + '</span>';
      }
      const markChips = marksOf(pat[pid]).map(mk => '<span class="mark-chip">' + esc(mk) + '</span>').join('');
      const extra = (stage === '重い日' && ci >= 2) ? ' sec-chip-extra' : '';
      chips += '<span class="sec-chip' + extra + '">' +
        termHtml(pid, '', shortName(pid)) + dateChip + markChips +
        '<span class="unv">未検証</span></span>';
    });
    if (stage === '重い日' && pd.patterns.length > 2) {
      chips += '<span class="sec-chips-more-d">ほか' + (pd.patterns.length - 2) + '件の定石</span>';
    }
    if (pd.patterns.length > 1) {
      chips += '<span class="sec-chips-more">ほか' + (pd.patterns.length - 1) + '件の定石</span>';
    }
    const total = pd.stocks.length;
    let shown, rest;
    if (stage === '最重量日') { shown = pd.stocks.slice(0, 5); rest = pd.stocks.slice(5); }
    else { shown = pd.stocks; rest = []; }
    let rows = shown.map(s => '<li class="stk"><span class="stk-code">' + esc(s.code) + '</span><span class="stk-name">' + esc(s.name) + '</span></li>').join('');
    rows += rest.map(s => '<li class="stk stk-rest" hidden><span class="stk-code">' + esc(s.code) + '</span><span class="stk-name">' + esc(s.name) + '</span></li>').join('');
    const moreBtn = rest.length
      ? '<button type="button" class="more-btn" data-more="' + i + '" aria-expanded="false">ほか' + rest.length + '件を見る</button>' : '';
    const meterPct = maxScore ? Math.round(100 * pd.score / maxScore) : 0;
    secRows += '<article class="sec-row" data-sec-row="' + i + '" data-maxlv="' + pd.maxlv + '">\n' +
      '      <div class="sec-row-head"><h3 class="sec-name">' + esc(pd.sector) + '</h3>\n' +
      '        <span class="sec-count"><b>' + total + '</b>件</span></div>\n' +
      '      <div class="sec-meter" aria-hidden="true"><i style="width:' + meterPct + '%"></i></div>\n' +
      '      <div class="sec-chips">' + chips + '</div>\n' +
      '      <ul class="stk-list" id="sec-stocks-' + i + '">' + rows + '</ul>\n' +
      '      ' + moreBtn + '\n    </article>';
  });

  // ブロック5: 市場全体の帯
  const bgShown = backGlobal.slice(0, 5);
  const bgNames = esc(bgShown.map(pid => pat[pid].name).join('／')) +
    (backGlobal.length - bgShown.length > 0 ? '　ほか' + (backGlobal.length - bgShown.length) + '件' : '');
  const bgBand = '<div class="bg-band"><b>市場全体にかかるもの：</b>' + bgNames + '</div>';

  let stageNote = '';
  if (stage === '最重量日') {
    stageNote = '<p class="stage-note">今日は関係する銘柄が多い日です。各セクタは影響の可能性が大きいとされる順に5件まで表示し、残りは「ほかN件を見る」で見られます。</p>';
  } else if (stage === '重い日') {
    stageNote = '<p class="stage-note">今日は関係する銘柄が少し多い日です。すべてのセクタと銘柄を表示しています。</p>';
  }
  const legend = '<p class="legend"><span class="legend-t">影響の可能性の目安</span>' + lv('大') + lv('中') + lv('小') + '</p>';

  const zero = specPids.length === 0;
  let bgTop = '', block4Html = '', bgBottom = '';
  if (zero) {
    let nextLine = '';
    const curIdx = junItems.indexOf(jun);
    for (let k = curIdx + 1; k < junItems.length; k++) {
      const j2 = junItems[k];
      const names = j2.patternIds.filter(pid2 => {
        const mm = meta[pid2];
        return mm && mm.category !== 'cycle' && (mm.sectors || []).some(s2 => s2 !== '市場全体');
      }).map(pid2 => meta[pid2].name);
      if (names.length) {
        const parts = j2.start.split('-');
        nextLine = '<p class="next-spec">次の、業種ごとに効く定石は、' +
          Number(parts[1]) + '月' + Number(parts[2]) + '日（' + j2.label + '）からです：' +
          names.map(esc).join('、') + '</p>';
        break;
      }
    }
    bgTop = '<section aria-labelledby="bg-h">\n  <h2 id="bg-h">市場全体にかかるもの</h2>\n' +
      '  <div class="bg-band bg-main">' + bgNames + '</div>\n</section>';
    block4Html = '<section aria-label="業種ごとの定石">\n' +
      '  <p class="no-spec">今日、業種ごとに効く定石はありません。</p>\n  ' + nextLine + '\n</section>';
    bgBottom = '';
  } else {
    block4Html = '<section aria-labelledby="sector-h">\n' +
      '  <h2 id="sector-h">関係するセクタと銘柄</h2>\n  ' + stageNote + '\n' +
      '  <p class="origin-note"><span class="on-full">影響の可能性が高いとされる業種から順に並べています（目安）。銘柄も同じ目安の順です。</span><span class="on-short">業種も銘柄も影響の可能性の目安の順です。</span></p>\n' +
      '  <div class="sec-rows">' + secRows + '</div>\n</section>';
    bgBottom = bgBand;
  }

  // ブロック6: 検索用データ
  SEARCH_DATA = STOCKS.map(s => ({
    code: s.code, name: s.name, sector: s.sector,
    spec: sortByPatKey(Object.keys(specOf[s.code])).map(pid => {
      const ti = termInfo(pid);
      return {
        name: pat[pid].name,
        term: ti ? ti[0] : null, tip: ti ? ti[1] : null,
        when: whenOf(pat[pid], bucketOf[pid]),
        bucket: BUCKET_LABEL[bucketOf[pid]],
        marks: marksOf(pat[pid]),
        level: specOf[s.code][pid],
      };
    }),
    bgCount: backOf[s.code].length,
  }));

  const factSentence = composeFact(groups, marksOf, specPids, bucketOf);
  return '<div class="wrap" data-stage="' + stageAttr + '">\n' +
'<header class="masthead">\n' +
'  <div class="mast-row"><span class="site-name"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>地合い定石カレンダー</span>\n' +
'    <span class="data-chip">データ時点：' + m + '月' + dd + '日</span></div>\n' +
'  <div class="date-line">' + genLabel + '<span class="jun">・' + esc(junLabel) + '</span></div>\n' +
(marketNote ? '  <p class="market-note">' + esc(marketNote) + '</p>\n' : '') +
'</header>\n\n' +
'<section class="fv" aria-label="今日の要点"' + (zero ? ' data-zero="1"' : '') + '>\n' +
'  <h1>重なる定石と、関係する業種・銘柄</h1>\n' +
'  <p class="summary">' + esc(factSentence) + '</p>\n' +
'  <div class="cnt-chips">\n' +
'    <span class="cnt-chip"><span class="cnt-lab">固有の定石</span><b class="cnt-num">' + specPids.length + '<small>件</small></b></span>\n' +
'    <span class="cnt-chip"><span class="cnt-lab">関係するセクタ</span><b class="cnt-num">' + S + '<small>件</small></b></span>\n' +
'    <span class="cnt-chip hero"><span class="cnt-lab">銘柄</span><b class="cnt-num">' + N + '<small>件</small></b></span>\n' +
'  </div>\n</section>\n\n' +
'<section aria-labelledby="time-h">\n' +
'  <div class="time-head"><h2 id="time-h">今日の定石</h2>' + legend + '</div>\n' +
'  <div class="time-groups">' + timeGroups + '</div>\n' +
'</section>\n\n' +
bgTop + '\n\n' + block4Html + '\n\n' + bgBottom + '\n\n' +
'<section aria-labelledby="search-h">\n' +
'  <h2 id="search-h">銘柄から探す</h2>\n' +
'  <div class="search-box">\n' +
'    <input id="q" type="search" inputmode="search" autocomplete="off"\n' +
'      placeholder="コードまたは会社名で探す" aria-label="会社のコードまたは名前で検索">\n' +
'  </div>\n' +
'  <ul class="suggest" id="suggest" hidden></ul>\n' +
'  <div class="result" id="result" hidden aria-live="polite"></div>\n' +
'</section>\n\n' +
'<nav class="links" aria-label="全データへの入口">\n' +
'  <a href="#/patterns">定石一覧 →</a>\n' +
'  <a href="#/map">年間マップ →</a>\n' +
'  <a href="#/stocks">全銘柄一覧 →</a>\n' +
'</nav>\n\n' +
'<footer class="foot">\n' +
'  <p>傾向の提示です。将来の値動きの予測や保証ではなく、投資の助言でもありません。</p>\n' +
'  <p>業種との関係には、まだ確かめられていない（未検証の）ものが含まれます。</p>\n' +
'  <p>データ：地合い定石カレンダー（' + genLabel + '・' + esc(junLabel) + '時点）／ 価格・チャートは表示していません。</p>\n' +
'  <p><a href="https://ashlorn.com/tools/jiai-viewer/">見方・注意点などの詳細</a> ／ <a href="https://ashlorn.com/">Studio Ashlorn</a></p>\n' +
'</footer>\n</div>';
}

/* ---------- 下層ビュー (ブロック7のリンク先。data.json 内のデータだけで構成) ---------- */
function viewHead(title, note) {
  return '<div class="wrap">\n<header class="masthead">\n' +
    '  <div class="mast-row"><span class="site-name"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>地合い定石カレンダー</span></div>\n' +
    '</header>\n<section>\n  <a class="sub-back" href="#/">← 今日のページへ</a>\n' +
    '  <h2>' + esc(title) + '</h2>\n' +
    (note ? '  <p class="sub-note">' + esc(note) + '</p>\n' : '');
}
function viewFoot() {
  return '</section>\n<footer class="foot">\n' +
    '  <p>傾向の提示です。将来の値動きの予測や保証ではなく、投資の助言でもありません。</p>\n' +
    '  <p>業種との関係には、まだ確かめられていない（未検証の）ものが含まれます。</p>\n' +
    '  <p><a href="https://ashlorn.com/tools/jiai-viewer/">見方・注意点などの詳細</a> ／ <a href="https://ashlorn.com/">Studio Ashlorn</a></p>\n' +
    '</footer>\n</div>';
}
function buildPatterns() {
  const ids = sortByPatKey(DATA.allPatterns.map(p => p.id));
  const rows = ids.map(pid => {
    const p = meta[pid];
    return '<li class="pat-row">' + lv(p.level) +
      '<span class="pat-name">' + esc(p.name) + '</span>' +
      '<span class="pat-kind">' + esc(p.kind) + '</span>' +
      '<span class="pat-basis">' + esc(p.basis) + '</span></li>';
  }).join('');
  return viewHead('定石一覧', 'このサイトで扱う定石の全件です。符号は影響の可能性の目安（素の度合い）です。') +
    '<ul class="pat-list">' + rows + '</ul>' + viewFoot();
}
function buildMap() {
  const genStr = DATA.generatedFor;
  const items = DATA.jun.items.map(j => {
    const cur = (j.start <= genStr && genStr <= j.end) ? ' cur' : '';
    const [, sm, sd] = j.start.split('-'); const [, em, ed] = j.end.split('-');
    const names = j.patternIds.map(pid => (meta[pid] || pat[pid] || {}).name || pid).join('・');
    return '<div class="map-item' + cur + '"><div class="mi-label">' + esc(j.label) + '</div>' +
      '<div class="mi-range">' + Number(sm) + '/' + Number(sd) + '〜' + Number(em) + '/' + Number(ed) + '</div>' +
      '<div class="mi-pats">' + esc(names) + '</div></div>';
  }).join('');
  return viewHead('年間マップ', DATA.jun.year + '年の36の時期（旬）ごとに、当てはまる定石です。枠で囲んだ時期が今日の分です。') +
    '<div class="map-grid">' + items + '</div>' + viewFoot();
}
function buildStocks() {
  let html = viewHead('全銘柄一覧', 'このサイトで扱う銘柄の全件（' + STOCKS.length + '件）です。業種ごとに並べています。');
  for (const sec of JPX_ORDER) {
    const ss = STOCKS.filter(s => s.sector === sec);
    if (!ss.length) continue;
    const rows = ss.map(s => '<li class="stk"><span class="stk-code">' + esc(s.code) + '</span><span class="stk-name">' + esc(s.name) + '</span></li>').join('');
    html += '<div class="as-sec"><h3>' + esc(sec) + '<span class="cnt">' + ss.length + '件</span></h3>' +
      '<ul class="stk-list">' + rows + '</ul></div>';
  }
  return html + viewFoot();
}

/* ---------- 対話部品 (モック JS の移植: 検索・開示・ツールチップ) ---------- */
function bindInteractions() {
  const input = document.querySelector('#q');
  const sug = document.querySelector('#suggest');
  const result = document.querySelector('#result');
  if (input && sug && result) {
    const escHtml = t => { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; };
    function termBtn(p) {
      if (p.term && p.tip) {
        return '<button type="button" class="term" data-term="' + escHtml(p.term) + '" data-tip="' + escHtml(p.tip) + '" aria-expanded="false" aria-describedby="tip">' + escHtml(p.name) + '<span class="ic" aria-hidden="true">?</span></button>';
      }
      return '<span class="pat-label">' + escHtml(p.name) + '</span>';
    }
    function showStock(s) {
      sug.hidden = true;
      const spec = s.spec.length
        ? s.spec.map(p =>
            '<div class="spec-item">' + termBtn(p) +
            (p.when ? '<span class="when-chip">' + escHtml(p.bucket) + ' ' + escHtml(p.when) + '</span>' : '') +
            (p.marks || []).map(mk => '<span class="mark-chip">' + escHtml(mk) + '</span>').join('') +
            '<span class="unv">未検証</span></div>').join('')
        : '<p class="none">業種に固有に効く定石はありません。</p>';
      result.innerHTML =
        '<div class="r-head"><span class="r-code">' + escHtml(s.code) + '</span><span class="r-name">' + escHtml(s.name) + '</span>' +
        '<span class="r-sector">セクタ：' + escHtml(s.sector) + '</span></div>' +
        '<h4>' + escHtml(s.sector) + '経由で関係するもの</h4>' + spec +
        '<p class="bg-line">市場全体の定石が' + s.bgCount + '件かかっています。</p>';
      result.hidden = false;
      result.scrollIntoView({ block: 'nearest' });
    }
    function search() {
      const q = input.value.trim();
      result.hidden = true;
      if (!q) { sug.hidden = true; return; }
      const hits = SEARCH_DATA.filter(s => s.code.toUpperCase().startsWith(q.toUpperCase()) || s.name.includes(q)).slice(0, 6);
      if (!hits.length) {
        sug.innerHTML = '<li><button type="button" disabled>見つかりませんでした</button></li>';
        sug.hidden = false; return;
      }
      sug.innerHTML = hits.map(s =>
        '<li><button type="button" data-code="' + escHtml(s.code) + '"><span class="sg-code">' + escHtml(s.code) + '</span>' +
        '<span>' + escHtml(s.name) + '</span><span class="sg-sector">' + escHtml(s.sector) + '</span></button></li>').join('');
      sug.hidden = false;
      sug.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        const s = SEARCH_DATA.find(x => x.code === b.dataset.code);
        if (s) showStock(s);
      }));
    }
    input.addEventListener('input', search);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const q = input.value.trim();
        const exact = SEARCH_DATA.find(s => s.code.toUpperCase() === q.toUpperCase()) || SEARCH_DATA.find(s => s.name.includes(q));
        if (exact) showStock(exact);
      }
      if (e.key === 'Escape') { sug.hidden = true; }
    });
    new MutationObserver(() => bindTerms(result)).observe(result, { childList: true });
  }
  document.querySelectorAll('.more-btn').forEach(b => b.addEventListener('click', () => {
    const list = document.querySelector('#sec-stocks-' + b.dataset.more);
    list.querySelectorAll('.stk-rest').forEach(li => { li.hidden = false; });
    b.setAttribute('aria-expanded', 'true');
    b.hidden = true;
  }));
  bindTerms(document);
}

/* ---------- ツールチップ (concepts6 の凍結部品、モックから無変更) ---------- */
const tipEl = () => document.querySelector('#tip');
let tipFor = null, tipPinned = false;
function placeTip(tr) {
  const tip = tipEl();
  const r = tr.getBoundingClientRect();
  tip.style.visibility = 'hidden'; tip.hidden = false;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let left = r.left + scrollX;
  left = Math.max(scrollX + 8, Math.min(left, scrollX + innerWidth - tw - 8));
  let top = r.bottom + scrollY + 8;
  if (r.bottom + th + 8 > innerHeight) top = r.top + scrollY - th - 8;
  tip.style.left = left + 'px'; tip.style.top = top + 'px';
  tip.style.visibility = '';
}
function openTip(tr, pin) {
  const tip = tipEl();
  if (tipFor && tipFor !== tr) tipFor.setAttribute('aria-expanded', 'false');
  tipFor = tr; tipPinned = !!pin;
  tip.querySelector('.tip-t').textContent = tr.dataset.term || '';
  tip.querySelector('.tip-b').textContent = tr.dataset.tip || '';
  placeTip(tr);
  tr.setAttribute('aria-expanded', 'true');
}
function closeTip() {
  if (tipFor) tipFor.setAttribute('aria-expanded', 'false');
  tipFor = null; tipPinned = false; tipEl().hidden = true;
}
function bindTerms(scope) {
  scope.querySelectorAll('.term').forEach(b => {
    if (b.dataset.bound) return; b.dataset.bound = '1';
    b.addEventListener('mouseenter', () => { if (!tipPinned) openTip(b, false); });
    b.addEventListener('mouseleave', () => { if (!tipPinned && tipFor === b) closeTip(); });
    b.addEventListener('focus', () => { if (!tipPinned) openTip(b, false); });
    b.addEventListener('blur', () => { if (!tipPinned && tipFor === b) closeTip(); });
    b.addEventListener('click', e => {
      e.stopPropagation();
      if (tipPinned && tipFor === b) closeTip(); else openTip(b, true);
    });
  });
}
document.addEventListener('click', e => {
  const tip = tipEl();
  if (tipPinned && !tip.contains(e.target) && !(tipFor && tipFor.contains(e.target))) closeTip();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTip(); });
addEventListener('resize', () => { if (tipFor) placeTip(tipFor); });

/* ---------- ルーティングと初期化 ---------- */
function route() {
  const app = document.querySelector('#app');
  const h = location.hash || '#/';
  closeTip();
  if (h.startsWith('#/patterns')) app.innerHTML = buildPatterns();
  else if (h.startsWith('#/map')) app.innerHTML = buildMap();
  else if (h.startsWith('#/stocks')) app.innerHTML = buildStocks();
  else app.innerHTML = buildMain();
  bindInteractions();
  if (h !== '#/' && h !== '') scrollTo(0, 0);
}
addEventListener('hashchange', route);
fetch('data.json', { cache: 'no-cache' })
  .then(r => { if (!r.ok) throw new Error('data.json ' + r.status); return r.json(); })
  .then(d => {
    DATA = d;
    pat = {}; for (const p of DATA.patterns) pat[p.id] = p;
    meta = {}; for (const p of DATA.allPatterns) meta[p.id] = p;
    // 当日パターンは allPatterns より情報が多い (category/sectors) ので meta を補完する
    for (const p of DATA.patterns) {
      if (meta[p.id]) { meta[p.id].category = p.category; meta[p.id].sectors = p.sectors; }
      else meta[p.id] = { id: p.id, name: p.name, level: p.level, basis: p.basis, kind: p.kind, category: p.category, sectors: p.sectors };
    }
    STOCKS = DATA.stocks;
    JPX_ORDER = [];
    for (const s of STOCKS) if (!JPX_ORDER.includes(s.sector)) JPX_ORDER.push(s.sector);
    route();
  })
  .catch(err => {
    document.querySelector('#app').innerHTML =
      '<p class="load-error">データを読み込めませんでした。時間をおいて開き直してください。</p>';
    console.error(err);
  });
