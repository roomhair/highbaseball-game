/* ==================================================
   高校野球  game-screen.js

   試合中の画面と、試合結果の画面。
   ・試合の中身は sim.js が先に全部決めている。ここはその log を
     1つずつ画面に出しているだけ。だから「スキップ」は
     残りをまとめて流すだけで済む。
   ・スコアボード・打席の表示・両軍のオーダーの3段組み。
     いまどちらの攻撃で誰の打席かが、常に分かるようにしている。
   ================================================== */
'use strict';

const GameScreen = (() => {

  const esc = UI.esc;
  let timer = null;
  let ctx = null;

  /* ---------- スコアボード ---------- */

  function scoreboard(res, awayName, homeName) {
    const n = Math.max(9, res.innings);
    let head = '<th class="sb-team"></th>';
    for (let i = 1; i <= n; i++) head += '<th>' + i + '</th>';
    head += '<th class="sb-tot">R</th><th>H</th><th>E</th>';

    const row = (name, side, other) => {
      let s = '<th class="sb-team">' + esc(name) + '</th>';
      for (let i = 0; i < n; i++) {
        const v = side.byInning[i];
        s += '<td>' + (v == null ? (i < res.innings ? '×' : '') : v) + '</td>';
      }
      s += '<td class="sb-tot">' + side.runs + '</td><td>' + side.hits + '</td><td>' + side.errors + '</td>';
      return '<tr>' + s + '</tr>';
    };
    return '<div class="tablewrap"><table class="scoreboard"><thead><tr>' + head + '</tr></thead><tbody>' +
      row(awayName, res.away) + row(homeName, res.home) + '</tbody></table></div>';
  }

  /** 途中経過のスコアボード（まだ終わっていない回は空欄） */
  function liveScoreboard(state, upto) {
    const n = Math.max(9, state.maxInning);
    let head = '<th class="sb-team"></th>';
    for (let i = 1; i <= n; i++) head += '<th' + (i === state.inning ? ' class="is-now"' : '') + '>' + i + '</th>';
    head += '<th class="sb-tot">R</th><th>H</th><th>E</th>';
    const row = (name, arr, r, h, e) => {
      let s = '<th class="sb-team">' + esc(name) + '</th>';
      for (let i = 0; i < n; i++) s += '<td>' + (arr[i] == null ? '' : arr[i]) + '</td>';
      s += '<td class="sb-tot">' + r + '</td><td>' + h + '</td><td>' + e + '</td>';
      return '<tr>' + s + '</tr>';
    };
    return '<div class="tablewrap"><table class="scoreboard"><thead><tr>' + head + '</tr></thead><tbody>' +
      row(state.awayName, state.awayInn, state.awayR, state.awayH, state.awayE) +
      row(state.homeName, state.homeInn, state.homeR, state.homeH, state.homeE) +
      '</tbody></table></div>';
  }

  /* ---------- 走者の図 ---------- */

  function diamond(bases, outs) {
    const b = (i) => (bases && bases[i] ? ' is-on' : '');
    return '<div class="diamond">' +
      '<svg viewBox="0 0 100 92" aria-hidden="true">' +
        '<polygon class="field" points="50,8 92,50 50,92 8,50"/>' +
        '<rect class="base' + b(1) + '" x="44" y="2" width="12" height="12" transform="rotate(45 50 8)"/>' +
        '<rect class="base' + b(0) + '" x="86" y="44" width="12" height="12" transform="rotate(45 92 50)"/>' +
        '<rect class="base' + b(2) + '" x="2" y="44" width="12" height="12" transform="rotate(45 8 50)"/>' +
        '<rect class="base home" x="44" y="86" width="12" height="12" transform="rotate(45 50 92)"/>' +
      '</svg>' +
      '<div class="outs">' + [0, 1, 2].map((i) =>
        '<i class="out' + (i < outs ? ' is-on' : '') + '"></i>').join('') + '<span>OUT</span></div>' +
    '</div>';
  }

  /* ---------- 両軍のオーダー ---------- */

  function liveLineups(away, home, cur) {
    const side = (t, key) => {
      const rows = t.lineup.map((s, i) => {
        const p = Team.find(t, s.pid);
        if (!p) return '';
        const now = cur.side === key && cur.order === i + 1;
        return '<li class="ll__item' + (now ? ' is-now' : '') + '" data-pid="' + p.id + '">' +
          '<span class="ll__no">' + (i + 1) + '</span>' +
          '<span class="ll__pos">' + posShort(s.pos) + '</span>' +
          '<span class="ll__name">' + esc(p.name) + '</span>' +
          '<span class="ll__res">' + esc(cur.results[p.id] || '') + '</span></li>';
      }).join('');
      const pit = Team.find(t, cur[key + 'Pitcher']);
      return '<div class="ll' + (cur.side === key ? ' is-batting' : '') + '">' +
        '<h4 class="ll__title">' + esc(t.name) + '<i>' + (cur.side === key ? '攻撃' : '守備') + '</i></h4>' +
        '<ol class="ll__list">' + rows + '</ol>' +
        (pit ? '<p class="ll__p">投手　' + esc(pit.name) + '</p>' : '') + '</div>';
    };
    return side(away, 'away') + side(home, 'home');
  }

  /* ---------- 試合の再生 ---------- */

  function start(gs, res, onDone) {
    const away = gs.away, home = gs.home;
    ctx = {
      res, onDone, i: 0, done: false,
      state: {
        awayName: away.name, homeName: home.name,
        awayInn: [], homeInn: [], awayR: 0, homeR: 0,
        awayH: 0, homeH: 0, awayE: 0, homeE: 0,
        inning: 1, maxInning: Math.max(9, res.innings), half: 'top',
      },
      cur: { side: 'away', order: 1, results: {}, awayPitcher: null, homePitcher: null },
      away, home,
    };

    /* 先発投手を控えておく（交代したらそのつど書き換える） */
    ctx.cur.awayPitcher = away.rotation[0];
    ctx.cur.homePitcher = home.rotation[0];

    UI.el('btn-skip').hidden = false;
    UI.show('screen-game');
    render('');
    step();
  }

  function render(stageHtml) {
    UI.html('game-scoreboard', liveScoreboard(ctx.state));
    UI.html('game-stage', stageHtml);
    UI.html('game-lineups', liveLineups(ctx.away, ctx.home, ctx.cur));
    const wrap = UI.el('game-lineups');
    wrap.querySelectorAll('.ll__item').forEach((li) => li.addEventListener('click', () => {
      const p = Team.find(ctx.away, li.dataset.pid) || Team.find(ctx.home, li.dataset.pid);
      if (p) UI.openPlayer(p, { rename: false });
    }));
  }

  function halfLabel(e) { return e.inning + '回' + (e.half === 'top' ? '表' : '裏'); }

  function apply(e) {
    const st = ctx.state, cur = ctx.cur;
    if (e.k === 'half') {
      st.inning = e.inning; st.half = e.half;
      st.maxInning = Math.max(st.maxInning, e.inning);
      cur.side = e.half === 'top' ? 'away' : 'home';
      if (e.half === 'top') { cur.results = {}; }   // 回をまたぐと結果表示を消す
      const arr = cur.side === 'away' ? st.awayInn : st.homeInn;
      if (arr[e.inning - 1] == null) arr[e.inning - 1] = 0;
      return '<div class="stage__half">' + halfLabel(e) + (e.tie ? '　タイブレーク' : '') + '</div>' +
        diamond([e.tie, e.tie, false], 0);
    }

    if (e.k === 'sub') {
      if (e.side === 'home') cur.homePitcher = e.pitcher; else cur.awayPitcher = e.pitcher;
      return '<div class="stage__sub">' + esc(e.text) + '</div>' + diamond([false, false, false], 0);
    }

    if (e.k === 'steal') {
      return '<div class="stage__play' + (e.ok ? ' is-good' : ' is-bad') + '">' +
        '<span class="stage__meta">' + halfLabel(e) + '</span>' +
        '<span class="stage__text">' + esc(e.text) + '</span></div>' +
        diamond(e.bases.map(Boolean), e.outs);
    }

    if (e.k === 'pa') {
      const off = e.half === 'top' ? 'away' : 'home';
      cur.side = off; cur.order = e.order;
      cur.results[e.batter] = e.text;
      const arr = off === 'away' ? st.awayInn : st.homeInn;
      arr[e.inning - 1] = (arr[e.inning - 1] || 0) + (e.runs || 0);
      st.awayR = e.score[0]; st.homeR = e.score[1];
      if (['1B', '2B', '3B', 'HR'].indexOf(e.code) >= 0) {
        if (off === 'away') st.awayH++; else st.homeH++;
      }
      if (e.code === 'E') { if (off === 'away') st.homeE++; else st.awayE++; }

      const good = ['1B', '2B', '3B', 'HR', 'BB', 'HBP', 'E'].indexOf(e.code) >= 0;
      return '<div class="stage__play' + (e.code === 'HR' ? ' is-hr' : (good ? ' is-good' : '')) + '">' +
        '<span class="stage__meta">' + halfLabel(e) + '　' + e.order + '番 ' + esc(e.batterName) + '</span>' +
        '<span class="stage__text">' + esc(e.text) +
          (e.runs ? '<b class="stage__runs">+' + e.runs + '点</b>' : '') + '</span>' +
        '</div>' + diamond(e.bases.map(Boolean), e.outs);
    }

    if (e.k === 'end') {
      st.awayR = e.score[0]; st.homeR = e.score[1];
      return '<div class="stage__end">試合終了' + (e.cold ? '（コールド）' : '') + '</div>';
    }
    return '';
  }

  function step() {
    if (ctx.done) return;
    if (ctx.i >= ctx.res.log.length) { finish(); return; }
    const e = ctx.res.log[ctx.i++];
    const stage = apply(e);
    render(stage);
    const wait = e.k === 'half' ? 620 : (e.k === 'pa' ? (e.runs ? 1000 : 760) : 700);
    timer = setTimeout(step, wait);
  }

  /** 残りをまとめて流して、結果画面へ */
  function skip() {
    if (!ctx || ctx.done) return;
    clearTimeout(timer);
    while (ctx.i < ctx.res.log.length) apply(ctx.res.log[ctx.i++]);
    finish();
  }

  function finish() {
    if (!ctx || ctx.done) return;
    ctx.done = true;
    clearTimeout(timer);
    UI.el('btn-skip').hidden = true;
    const cb = ctx.onDone;
    ctx = null;
    cb();
  }

  /* ---------- 結果画面 ---------- */

  function batBox(t, label) {
    const inLineup = t.lineup.map((s) => ({ p: Team.find(t, s.pid), pos: s.pos }))
      .filter((x) => x.p);
    const subs = Team.all(t).filter((p) =>
      p.kind !== 'pitcher' && p.game.pa > 0 && !inLineup.some((x) => x.p.id === p.id))
      .map((p) => ({ p, pos: p.pos }));
    const rows = inLineup.concat(subs).map((x, i) => {
      const s = x.p.game;
      return '<tr data-pid="' + x.p.id + '" class="prow"><td class="c ord">' + (i < 9 ? i + 1 : '') + '</td>' +
        '<td class="c">' + posShort(x.pos) + '</td>' +
        '<td class="nm">' + esc(x.p.name) + '</td>' +
        '<td class="c">' + s.ab + '</td><td class="c">' + s.h + '</td><td class="c">' + s.hr + '</td>' +
        '<td class="c">' + s.rbi + '</td><td class="c">' + s.bb + '</td><td class="c">' + s.so + '</td>' +
        '<td class="c">' + s.sb + '</td>' +
        '<td class="c hl">' + UI.avg(x.p.career.h, x.p.career.ab) + '</td></tr>';
    }).join('');
    return '<h4 class="sub">' + esc(label) + '　打撃成績</h4>' +
      '<div class="tablewrap"><table class="box"><thead><tr><th>打順</th><th>守</th><th class="nm">選手</th>' +
      '<th>打数</th><th>安打</th><th>本</th><th>点</th><th>四球</th><th>三振</th><th>盗</th><th>通算打率</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function pitBox(t, label) {
    const used = t.pitchers.filter((p) => p.game.outs > 0 || p.game.g);
    const rows = used.map((p) => {
      const s = p.game;
      const mark = s.w ? '○' : (s.l ? '●' : '');
      return '<tr data-pid="' + p.id + '" class="prow"><td class="nm">' + mark + esc(p.name) + '</td>' +
        '<td class="c">' + UI.ipText(s.outs) + '</td><td class="c">' + s.h + '</td>' +
        '<td class="c">' + s.so + '</td><td class="c">' + s.bb + '</td>' +
        '<td class="c">' + s.r + '</td><td class="c">' + s.hr + '</td>' +
        '<td class="c hl">' + UI.era(p.career.er, p.career.outs) + '</td></tr>';
    }).join('');
    return '<h4 class="sub">' + esc(label) + '　投球成績</h4>' +
      '<div class="tablewrap"><table class="box"><thead><tr><th class="nm">投手</th><th>回</th><th>安打</th>' +
      '<th>三振</th><th>四球</th><th>失点</th><th>本</th><th>通算防御率</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function growthList(report) {
    const awake = report.filter((r) => r.awakened);
    const grew = report.filter((r) => !r.awakened && r.ups.length);
    let html = '';
    if (awake.length) {
      html += '<div class="awakebox"><h4 class="awakebox__title">覚醒</h4>' +
        awake.map((r) => '<p class="awakebox__line"><b>' + esc(r.name) + '</b>（' + r.grade + '年）が覚醒した！　' +
          r.ups.map((u) => esc(u.label) + ' +' + u.amount + (u.unit || '')).join('　') + '</p>').join('') +
        '</div>';
    }
    if (grew.length) {
      html += '<details class="growthbox"><summary>成長した選手（' + grew.length + '人）</summary>' +
        '<ul class="growthlist">' + grew.map((r) =>
          '<li><b>' + esc(r.name) + '</b><span>' + r.ups.map((u) =>
            esc(u.label) + ' +' + u.amount + (u.unit || '')).join('　') + '</span></li>').join('') +
        '</ul></details>';
    }
    return html;
  }

  function result(state, res, meta) {
    const my = meta.mySide === 'away' ? res.away : res.home;
    const op = meta.mySide === 'away' ? res.home : res.away;
    const win = my.runs > op.runs;

    UI.el('result-title').textContent =
      meta.tourLabel + '　' + meta.roundName + '　' + (win ? '勝利' : '敗戦');

    const pg = Tournament.perGame(state.tour);
    const html =
      '<p class="result-score' + (win ? ' is-win' : ' is-lose') + '">' +
        esc(state.team.name) + ' <b>' + my.runs + '</b> - <b>' + op.runs + '</b> ' + esc(state.opponent.name) +
        (res.cold ? '<i>（コールド）</i>' : (res.walkoff ? '<i>（サヨナラ）</i>' : '')) + '</p>' +
      scoreboard(res, res.away.team.name, res.home.team.name) +
      growthList(meta.report) +
      '<div class="boxes">' +
        batBox(state.team, state.team.name) +
        pitBox(state.team, state.team.name) +
        batBox(state.opponent, state.opponent.name) +
        pitBox(state.opponent, state.opponent.name) +
      '</div>' +
      '<div class="tourstat"><h4 class="sub">' + esc(meta.tourLabel) + 'の成績</h4>' +
        '<p>' + state.tour.games + '試合　1試合平均 <b>' + pg.rf.toFixed(1) + '</b>得点／' +
        '<b>' + pg.ra.toFixed(1) + '</b>失点</p></div>' +
      '<details class="rosterbox"><summary>両チームの能力一覧</summary>' +
        '<h4 class="sub">' + esc(state.team.name) + '　野手</h4>' + UI.rosterTable(state.team.batters) +
        '<h4 class="sub">' + esc(state.team.name) + '　投手</h4>' + UI.rosterTable(state.team.pitchers) +
        '<h4 class="sub">' + esc(state.opponent.name) + '　野手</h4>' + UI.rosterTable(state.opponent.batters) +
        '<h4 class="sub">' + esc(state.opponent.name) + '　投手</h4>' + UI.rosterTable(state.opponent.pitchers) +
      '</details>';

    UI.html('result-body', html);
    const body = UI.el('result-body');
    body.querySelectorAll('tr.prow').forEach((tr) => tr.addEventListener('click', () => {
      const p = Team.find(state.team, tr.dataset.pid) || Team.find(state.opponent, tr.dataset.pid);
      if (p) UI.openPlayer(p, { rename: !!Team.find(state.team, tr.dataset.pid) });
    }));
    UI.show('screen-result');
  }

  return { start, skip, result, scoreboard };
})();
