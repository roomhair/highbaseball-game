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
  /* 0 = 1打席ずつ（タップで進む）、1 = 通常、2 = 2倍、3 = 3倍。
     毎試合「通常」から始める */
  let speed = 1;

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

  /* ---------- グラウンドの絵 ----------
     打球がどこへ飛んだかを見せる。中安ならセンター前、
     右二なら右中間、というふうに落ちどころを変えている。 */

  /* 守備位置のだいたいの立ち位置（本塁は 100,152） */
  const SPOT = {
    P:  [100, 112], C: [100, 160],
    '1B': [134, 118], '2B': [122, 88], '3B': [66, 118], SS: [78, 88],
    LF: [44, 52], CF: [100, 34], RF: [156, 52],
  };
  /* 長打の落ちどころ。左中間・右中間を使い分ける */
  const GAP = { LF: [58, 34], CF: [100, 22], RF: [142, 34] };
  const DEEP = { LF: [32, 26], CF: [100, 12], RF: [168, 26] };

  /** 打席の結果から、打球の落ちどころを決める */
  function ballTarget(e) {
    if (!e || !e.spot) return null;
    if (e.code === 'HR') return DEEP[e.spot] || [100, 12];
    if (e.code === '3B') return DEEP[e.spot] || GAP[e.spot] || SPOT[e.spot];
    if (e.code === '2B') return GAP[e.spot] || SPOT[e.spot];
    return SPOT[e.spot] || null;
  }

  /* 本塁の座標。打球はかならずここから飛んでいく */
  const HOME = [100, 152];

  function fieldView(bases, outs, e) {
    const t = ballTarget(e);
    const b = (i) => (bases && bases[i] ? ' is-on' : '');
    /* 打球は「本塁から飛んでいく」ことが分かるように、
       本塁からの軌跡の線を先に引き、その上をボールが走る。
       点が現れて移動するだけだと、どこから飛んだのか読み取れない。 */
    let ball = '';
    if (t) {
      const dx = t[0] - HOME[0], dy = t[1] - HOME[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      const hr = e.code === 'HR';
      ball =
        '<line class="balltrail' + (hr ? ' is-hr' : '') + '" ' +
          'x1="' + HOME[0] + '" y1="' + HOME[1] + '" x2="' + t[0] + '" y2="' + t[1] + '" ' +
          'style="--len:' + len.toFixed(1) + '"></line>' +
        '<circle class="ballfrom' + (hr ? ' is-hr' : '') + '" ' +
          'cx="' + HOME[0] + '" cy="' + HOME[1] + '" r="3"></circle>' +
        '<circle class="ball' + (hr ? ' is-hr' : '') + '" ' +
          'cx="' + HOME[0] + '" cy="' + HOME[1] + '" r="4.4" ' +
          'style="--dx:' + dx + ';--dy:' + dy + '"></circle>';
    }
    return '<div class="fieldview">' +
      '<svg viewBox="0 0 200 172" aria-hidden="true">' +
        '<path class="fv-grass" d="M100 152 L14 66 A122 122 0 0 1 186 66 Z"/>' +
        '<path class="fv-fence" d="M14 66 A122 122 0 0 1 186 66"/>' +
        '<polygon class="fv-inf" points="100,152 141,111 100,70 59,111"/>' +
        '<rect class="fv-base' + b(0) + '" x="136" y="107" width="9" height="9" transform="rotate(45 140.5 111.5)"/>' +
        '<rect class="fv-base' + b(1) + '" x="95.5" y="66" width="9" height="9" transform="rotate(45 100 70.5)"/>' +
        '<rect class="fv-base' + b(2) + '" x="54.5" y="107" width="9" height="9" transform="rotate(45 59 111.5)"/>' +
        '<polygon class="fv-home" points="100,147 105,152 100,157 95,152"/>' +
        ball +
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
        /* その試合の打席結果を全部並べる（消さない） */
        const done = (cur.results[p.id] || []);
        const res = done.map((t, k) =>
          '<i class="ll__r' + (k === done.length - 1 && now ? ' is-last' : '') + '">' + esc(t) + '</i>').join('');
        return '<li class="ll__item' + (now ? ' is-now' : '') + '" data-pid="' + p.id + '">' +
          '<span class="ll__no">' + (i + 1) + '</span>' +
          '<span class="ll__pos">' + posShort(s.pos) + '</span>' +
          '<span class="ll__name">' + esc(p.name) + '</span>' +
          '<span class="ll__res">' + res + '</span></li>';
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

  function start(gs, live, onDone) {
    const away = gs.away, home = gs.home;
    ctx = {
      live, onDone, i: 0, done: false,
      /* 自分が操る側。タイムをかけられるのはこちらだけ */
      mySide: gs.mySide || 'away',
      /* この試合で退いた選手。試合ごとに作り直す */
      retired: new Set(),
      state: {
        awayName: away.name, homeName: home.name,
        awayInn: [], homeInn: [], awayR: 0, homeR: 0,
        awayH: 0, homeH: 0, awayE: 0, homeE: 0,
        inning: 1, maxInning: 9, half: 'top',
      },
      cur: { side: 'away', order: 1, results: {}, awayPitcher: null, homePitcher: null },
      away, home,
    };

    /* 先発投手を控えておく（交代したらそのつど書き換える） */
    ctx.cur.awayPitcher = away.rotation[0];
    ctx.cur.homePitcher = home.rotation[0];

    UI.el('btn-skip').hidden = false;
    const bt = UI.el('btn-time');
    if (bt) bt.hidden = false;
    speed = 1;
    applySpeedButtons();
    UI.show('screen-game');
    render('');
    step();
  }

  /* ---------- 速さの切り替え ---------- */

  function applySpeedButtons() {
    document.querySelectorAll('#game-speed .speedbtn').forEach((b) => {
      b.classList.toggle('is-on', +b.dataset.sp === speed);
    });
  }

  function setSpeed(v) {
    const was = speed;
    speed = v;
    applySpeedButtons();
    if (!ctx || ctx.done) return;
    /* 「1打席ずつ」から戻したときは、止まっているので動かし直す */
    if (was === 0 && v > 0 && ctx.awaitTap) {
      ctx.awaitTap = false;
      showTapHint(false);
      step();
    } else if (v === 0) {
      clearTimeout(timer);
      ctx.awaitTap = true;
      showTapHint(true);
    }
  }

  function showTapHint(on) {
    const n = UI.el('game-taphint');
    if (n) n.hidden = !on;
    const st = UI.el('game-stage');
    if (st) st.classList.toggle('is-tappable', !!on);
  }

  /** 画面の真ん中をタップされたとき。1打席ずつのときだけ進む */
  function tap() {
    if (!ctx || ctx.done || !ctx.awaitTap) return;
    ctx.awaitTap = false;
    showTapHint(false);
    step();
  }

  /** 次の1つを出すまでの待ち時間を決める。0 なら止めてタップを待つ */
  function schedule(ms) {
    clearTimeout(timer);
    if (speed === 0) { ctx.awaitTap = true; showTapHint(true); return; }
    timer = setTimeout(step, Math.max(60, Math.round(ms / speed)));
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

  /** 攻撃中だった回を締める。無得点ならここで 0 を入れる */
  function closeHalf(st) {
    if (!st.openHalf) return;
    const prev = st.openHalf;
    const arr = prev.side === 'away' ? st.awayInn : st.homeInn;
    if (arr[prev.inning - 1] == null) arr[prev.inning - 1] = 0;
    st.openHalf = null;
  }

  function apply(e) {
    const st = ctx.state, cur = ctx.cur;
    if (e.k === 'half') {
      st.inning = e.inning; st.half = e.half;
      st.maxInning = Math.max(st.maxInning, e.inning);
      cur.side = e.half === 'top' ? 'away' : 'home';
      /* 回のはじめに、次の打者へ表示を合わせる */
      if (e.nextOrder) cur.order = e.nextOrder;
      /* 前の半分の回を締める。攻撃中は空欄のままで、
         回が終わってはじめて 0 を入れる */
      closeHalf(st);
      st.openHalf = { side: cur.side, inning: e.inning };
      return '<div class="stage__half">' + halfLabel(e) + (e.tie ? '　タイブレーク' : '') + '</div>' +
        fieldView([e.tie, e.tie, false], 0, null);
    }

    if (e.k === 'sub') {
      if (e.side === 'home') cur.homePitcher = e.pitcher; else cur.awayPitcher = e.pitcher;
      return '<div class="stage__sub">' + esc(e.text) + '</div>' + fieldView([false, false, false], 0, null);
    }

    if (e.k === 'steal') {
      return '<div class="stage__play' + (e.ok ? ' is-good' : ' is-bad') + '">' +
        '<span class="stage__meta">' + halfLabel(e) + '</span>' +
        '<span class="stage__text">' + esc(e.text) + '</span></div>' +
        fieldView(e.bases.map(Boolean), e.outs, null);
    }

    if (e.k === 'pa') {
      const off = e.half === 'top' ? 'away' : 'home';
      cur.side = off; cur.order = e.order;
      (cur.results[e.batter] = cur.results[e.batter] || []).push(e.text);
      const arr = off === 'away' ? st.awayInn : st.homeInn;
      /* 点が入ったときだけ数字を置く。入らないうちは空欄のまま */
      if (e.runs) arr[e.inning - 1] = (arr[e.inning - 1] || 0) + e.runs;
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
        '</div>' + fieldView(e.bases.map(Boolean), e.outs, e);
    }

    if (e.k === 'end') {
      closeHalf(st);
      st.awayR = e.score[0]; st.homeR = e.score[1];
      return '<div class="stage__end">試合終了' + (e.cold ? '（コールド）' : '') + '</div>';
    }
    return '';
  }

  /** log にまだ出していない行があるか。無ければ試合を1歩進めて作る */
  function pull() {
    const log = ctx.live.log;
    while (ctx.i >= log.length) {
      if (!ctx.live.next()) return false;   // 試合が終わった
    }
    return true;
  }

  function step() {
    if (ctx.done || ctx.paused) return;
    if (!pull()) { finish(); return; }
    const e = ctx.live.log[ctx.i++];
    const stage = apply(e);
    render(stage);
    const wait = e.k === 'half' ? 620 : (e.k === 'pa' ? (e.runs ? 1000 : 760) : 700);
    schedule(wait);
  }

  /** 残りをまとめて流して、結果画面へ */
  function skip() {
    if (!ctx || ctx.done) return;
    clearTimeout(timer);
    ctx.awaitTap = false;
    ctx.paused = false;
    while (pull()) apply(ctx.live.log[ctx.i++]);
    finish();
  }

  function finish() {
    if (!ctx || ctx.done) return;
    ctx.done = true;
    clearTimeout(timer);
    showTapHint(false);
    UI.el('btn-skip').hidden = true;
    const bt = UI.el('btn-time');
    if (bt) bt.hidden = true;
    const cb = ctx.onDone;
    ctx = null;
    cb();
  }


  /* ---------- タイム ----------
     試合を止めて、代打・選手交代・守備位置・投手交代をする。
     高校野球と同じで、一度退いた選手は戻れない。 */

  /** その試合でもう使えない選手（退いた選手）。
      チームの側ではなく ctx に持たせてある。チームに付けると
      次の試合まで残ってしまい、保存データにも紛れ込む。 */
  function retired() { return ctx.retired; }

  function myTeam() { return ctx.mySide === 'away' ? ctx.away : ctx.home; }

  /** ベンチで待っている、まだ退いていない野手 */
  function availableBench(t) {
    const out = retired();
    return Team.bench(t).filter((p) => !out.has(p.id));
  }

  /** まだ投げていない、退いていない投手 */
  function availablePitchers(t) {
    const out = retired();
    const nowId = currentPitcherId(t);
    return t.pitchers.filter((p) => !out.has(p.id) && p.id !== nowId && !p.game.g);
  }

  function currentPitcherId(t) {
    return t === ctx.away ? ctx.cur.awayPitcher : ctx.cur.homePitcher;
  }

  /** いま守っているのはどちらか */
  function iAmFielding() {
    return ctx.cur.side !== ctx.mySide;
  }

  /** 次に打つ打順（1〜9）。代打はここに入れる */
  function nextOrder() { return ctx.cur.order; }

  function openTime() {
    if (!ctx || ctx.done) return;
    clearTimeout(timer);
    ctx.paused = true;
    showTapHint(false);
    timeMenu();
  }

  function closeTime() {
    UI.closeModal();
    if (!ctx || ctx.done) return;
    ctx.paused = false;
    render(UI.el('game-stage').innerHTML);
    step();
  }

  function timeMenu() {
    const t = myTeam();
    const fielding = iAmFielding();
    const n = nextOrder();
    const slot = t.lineup[n - 1];
    const batter = slot ? Team.find(t, slot.pid) : null;
    const pit = Team.find(t, currentPitcherId(t));

    UI.modal(
      '<h3 class="modal__title">タイム</h3>' +
      '<p class="time__where">' + ctx.state.inning + '回' +
        (ctx.state.half === 'top' ? '表' : '裏') + '　' +
        (fielding ? '守備中' : '攻撃中') + '</p>' +
      '<div class="time__now">' +
        (pit ? '<div>いまの投手　<b>' + esc(pit.name) + '</b>　' +
          esc(Team.fatigueLabel(pit)) + '</div>' : '') +
        (batter ? '<div>次の打者　<b>' + n + '番 ' + esc(batter.name) + '</b></div>' : '') +
      '</div>' +
      '<div class="time__menu">' +
        (fielding ? '' :
          '<button type="button" class="btn btn--wide" id="tm-ph">代打を出す</button>') +
        '<button type="button" class="btn btn--wide" id="tm-sub">選手を交代する</button>' +
        '<button type="button" class="btn btn--wide" id="tm-pos">守備位置を変える</button>' +
        '<button type="button" class="btn btn--wide" id="tm-pit">投手を交代する</button>' +
      '</div>' +
      '<div class="actions actions--modal">' +
        '<button type="button" class="btn btn--primary btn--wide" id="tm-close">試合に戻る</button>' +
      '</div>',
      {
        kind: 'time',
        onOpen(body) {
          const on = (id, fn) => { const b = body.querySelector(id); if (b) b.addEventListener('click', fn); };
          on('#tm-ph', () => pinchHit());
          on('#tm-sub', () => subPlayer());
          on('#tm-pos', () => changePos());
          on('#tm-pit', () => changePitcher());
          on('#tm-close', closeTime);
        },
      }
    );
  }

  /** 選手を1人選ばせる共通の画面 */
  function pickPlayer(title, lead, list, onPick, emptyText) {
    if (!list.length) {
      UI.modal(
        '<h3 class="modal__title">' + esc(title) + '</h3>' +
        '<p class="time__empty">' + esc(emptyText || '選べる選手がいません。') + '</p>' +
        '<div class="actions actions--modal">' +
          '<button type="button" class="btn btn--wide" id="pk-back">戻る</button></div>',
        { kind: 'time', onOpen(b) { b.querySelector('#pk-back').addEventListener('click', timeMenu); } }
      );
      return;
    }
    UI.modal(
      '<h3 class="modal__title">' + esc(title) + '</h3>' +
      (lead ? '<p class="time__where">' + esc(lead) + '</p>' : '') +
      '<div class="spick__list">' + list.map((x) =>
        '<button type="button" class="spick__item" data-pid="' + x.p.id + '">' +
          '<span class="spick__nm">' + esc(x.p.name) + '</span>' +
          '<span class="spick__fat">' + esc(x.right || '') + '</span>' +
          '<span class="spick__meta">' + x.meta + '</span>' +
        '</button>').join('') + '</div>' +
      '<div class="actions actions--modal">' +
        '<button type="button" class="btn btn--wide" id="pk-back">戻る</button></div>',
      {
        kind: 'time',
        onOpen(body) {
          body.querySelectorAll('.spick__item').forEach((b) =>
            b.addEventListener('click', () => onPick(b.dataset.pid)));
          body.querySelector('#pk-back').addEventListener('click', timeMenu);
        },
      }
    );
  }

  /** その守備位置の適性（DHは守らないので「―」） */
  function aptAt(p, posKey) {
    if (posKey === 'DH') return '―';
    return (p.apt && p.apt[posKey]) || 'G';
  }

  function batMeta(p) {
    return p.grade + '年・' + UI.handMark(p) + '　ミート ' + UI.rankNum(p.meet) +
      '　パワー ' + UI.rankNum(p.power) + '　走力 ' + UI.rankNum(p.speed);
  }

  /** 代打。次の打者を控えの選手に差し替える */
  function pinchHit() {
    const t = myTeam();
    const n = nextOrder();
    const slot = t.lineup[n - 1];
    if (!slot) { timeMenu(); return; }
    const out = Team.find(t, slot.pid);
    const list = availableBench(t).map((p) => ({ p, meta: batMeta(p) }));
    pickPlayer('代打', n + '番 ' + (out ? out.name : '') + ' に代えて',
      list, (pid) => {
        const inP = Team.find(t, pid);
        if (!inP || !out) { timeMenu(); return; }
        t.lineup[n - 1] = { pid: inP.id, pos: slot.pos };
        retired().add(out.id);
        ctx.live.note('代打　' + out.name + ' → ' + inP.name);
        afterSub();
      }, '控えに出せる選手がいません。');
  }

  /** 選手交代。守っている選手を控えと入れ替える */
  function subPlayer() {
    const t = myTeam();
    const list = t.lineup.map((s, i) => {
      const p = Team.find(t, s.pid);
      return p ? { p, meta: (i + 1) + '番 ' + posName(s.pos) + '　' + batMeta(p), idx: i } : null;
    }).filter(Boolean);
    pickPlayer('選手を交代する', 'まず、退く選手を選んでください', list, (pid) => {
      const idx = t.lineup.findIndex((s) => s.pid === pid);
      const out = Team.find(t, pid);
      if (idx < 0 || !out) { timeMenu(); return; }
      const bench = availableBench(t).map((p) => ({
        p, meta: batMeta(p), right: posName(t.lineup[idx].pos) + '適性 ' + aptAt(p, t.lineup[idx].pos),
      }));
      pickPlayer('交代で出す選手', out.name + ' に代えて', bench, (pid2) => {
        const inP = Team.find(t, pid2);
        if (!inP) { timeMenu(); return; }
        t.lineup[idx] = { pid: inP.id, pos: t.lineup[idx].pos };
        retired().add(out.id);
        ctx.live.note('選手交代　' + out.name + ' → ' + inP.name);
        afterSub();
      }, '控えに出せる選手がいません。');
    });
  }

  /** 守備位置を入れ替える。2人選んで、その場所を交換する */
  function changePos() {
    const t = myTeam();
    const mk = () => t.lineup.map((s, i) => {
      const p = Team.find(t, s.pid);
      return p ? { p, meta: (i + 1) + '番　' + posName(s.pos) + '　適性 ' + aptAt(p, s.pos) } : null;
    }).filter(Boolean);
    pickPlayer('守備位置を変える', '入れ替える1人目', mk(), (pidA) => {
      const a = t.lineup.findIndex((s) => s.pid === pidA);
      const rest = mk().filter((x) => x.p.id !== pidA);
      pickPlayer('守備位置を変える', Team.find(t, pidA).name + ' と入れ替える相手', rest, (pidB) => {
        const b = t.lineup.findIndex((s) => s.pid === pidB);
        if (a < 0 || b < 0) { timeMenu(); return; }
        const pa = t.lineup[a].pos, pb = t.lineup[b].pos;
        t.lineup[a].pos = pb; t.lineup[b].pos = pa;
        ctx.live.note('守備変更　' + Team.find(t, pidA).name + ' ' + posName(pb) +
          '／' + Team.find(t, pidB).name + ' ' + posName(pa));
        afterSub();
      });
    });
  }

  /** 投手交代 */
  function changePitcher() {
    const t = myTeam();
    const now = Team.find(t, currentPitcherId(t));
    const list = availablePitchers(t).map((p) => ({
      p, right: Team.fatigueLabel(p),
      meta: p.grade + '年・' + (p.throws === 'L' ? '左' : '右') + '・' + p.velo + 'km/h　制球 ' +
        UI.rankNum(p.control) + '　スタミナ ' + UI.rankNum(p.stamina),
    }));
    pickPlayer('投手を交代する', now ? now.name + ' に代えて' : '', list, (pid) => {
      const side = ctx.mySide;
      if (ctx.live.changePitcher(side, pid)) {
        if (now) retired().add(now.id);
      }
      afterSub();
    }, 'まだ投げていない投手がいません。');
  }

  /** 交代したあと。新しく積まれた行を反映してから、タイムの画面に戻る */
  function afterSub() {
    Team.repair(myTeam());
    let stage = null;
    while (ctx.i < ctx.live.log.length) stage = apply(ctx.live.log[ctx.i++]);
    /* 「投手交代　A → B」を画面にも残す。ここで描いておかないと、
       タイムを閉じた瞬間に次の打席で上書きされて見逃してしまう */
    if (stage != null) render(stage);
    timeMenu();
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
    /* 出てきた順に並べる。名簿の並び（t.pitchers）は起用順と関係ないので、
       そのまま使うと先発が2番目以降に出てしまう。
       Sim は rotation[0] を先発、以降を順に継投させるので、
       先発を頭に置いたうえで rotation の順に並べれば登板順になる。 */
    const rot = t.rotation || [];
    const order = (p) => {
      if (p.game.gs) return -1;
      const i = rot.indexOf(p.id);
      return i < 0 ? rot.length : i;
    };
    const used = t.pitchers.filter((p) => p.game.outs > 0 || p.game.g)
      .sort((a, b) => order(a) - order(b));
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

  /* ---------- 打席の記録 ----------
     その試合で誰が何回に何を打ったかを、まとめて見られるようにする */

  function paLog(res, team, label) {
    /* 打者ID → 回ごとの打席結果 */
    const byPid = {};
    res.log.forEach((e) => {
      if (e.k !== 'pa' || !e.batter) return;
      const m = (byPid[e.batter] = byPid[e.batter] || {});
      (m[e.inning] = m[e.inning] || []).push(e);
    });
    const innings = Math.max(9, res.innings || 9);
    const order = team.lineup.map((sl) => ({ p: Team.find(team, sl.pid), pos: sl.pos }))
      .filter((x) => x.p);
    const extra = team.batters
      .filter((p) => byPid[p.id] && !order.some((x) => x.p.id === p.id))
      .map((p) => ({ p, pos: p.pos }));

    let head = '<th class="c">打順</th><th class="c">守</th>';
    for (let i = 1; i <= innings; i++) head += '<th class="c">' + i + '</th>';

    const rows = order.concat(extra).map((x, i) => {
      let tds = '<td class="c ord">' + (i < 9 ? i + 1 : '―') + '</td>' +
        '<td class="c">' + posShort(x.pos) + '</td>';
      for (let n = 1; n <= innings; n++) {
        const list = (byPid[x.p.id] || {})[n] || [];
        tds += '<td class="c pa-td">' + list.map((e) =>
          '<span class="pa-cell' + (e.runs ? ' is-run' : '') + '">' + esc(e.text) +
          (e.runs ? '<b>+' + e.runs + '</b>' : '') + '</span>').join('') + '</td>';
      }
      return '<tr data-pid="' + x.p.id + '" class="prow">' + tds + '</tr>';
    }).join('');

    /* 選手名は1列目の左に別表で出す（回の列が多いので分けたほうが読める） */
    const names = order.concat(extra).map((x) =>
      '<tr data-pid="' + x.p.id + '" class="prow"><td class="nm">' + esc(x.p.name) + '</td></tr>').join('');

    return '<h4 class="sub">' + esc(label) + '　打席結果</h4>' +
      '<div class="palogwrap">' +
        '<table class="box palognames"><thead><tr><th class="nm">選手</th></tr></thead><tbody>' + names + '</tbody></table>' +
        '<div class="tablewrap"><table class="box palog"><thead><tr>' + head + '</tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>' +
      '</div>';
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
        paLog(res, state.team, state.team.name) +
        batBox(state.team, state.team.name) +
        pitBox(state.team, state.team.name) +
        '<details class="rosterbox"><summary>' + esc(state.opponent.name) + 'の成績</summary>' +
          paLog(res, state.opponent, state.opponent.name) +
          batBox(state.opponent, state.opponent.name) +
          pitBox(state.opponent, state.opponent.name) +
        '</details>' +
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

  /** 速さのボタンとタップの受け口を用意する（起動時に一度だけ） */
  function init() {
    document.querySelectorAll('#game-speed .speedbtn').forEach((b) =>
      b.addEventListener('click', () => setSpeed(+b.dataset.sp)));
    const st = UI.el('game-stage');
    if (st) st.addEventListener('click', tap);
    const hint = UI.el('game-taphint');
    if (hint) hint.addEventListener('click', tap);
    const bt = UI.el('btn-time');
    if (bt) bt.addEventListener('click', openTime);
    applySpeedButtons();
  }

  return { start, skip, result, scoreboard, setSpeed, init, openTime };
})();
