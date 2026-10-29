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
  /* 「チャンスまで」。×3と同じ速さで進めつつ、チャンス（ピンチ）の
     場面に来たら自動でタップ待ち（1打席ずつ）に切り替える */
  let chanceMode = false;
  /* 「スタミナが切れるまで」。×3と同じ速さで進めつつ、自軍の投手の
     スタミナが一定（30%）まで減ったら自動でタップ待ち（1打席ずつ）に切り替える */
  let staminaMode = false;
  const STAMINA_STOP = 0.30;

  /* ---------- スコアボード ---------- */

  /** 後攻が回の途中で試合を決めた回（0始まり）。無ければ -1 */
  function endedMidInning(res) {
    const last = res.innings - 1;
    if (res.winner !== 'home' || !(res.walkoff || res.cold)) return -1;
    return res.home.byInning[last] != null ? last : -1;
  }

  function scoreboard(res, awayName, homeName) {
    const n = Math.max(9, res.innings);
    let head = '<th class="sb-team"></th>';
    for (let i = 1; i <= n; i++) head += '<th>' + i + '</th>';
    head += '<th class="sb-tot">R</th><th>H</th><th>E</th>';

    /* 後攻がサヨナラやコールドで回の途中に試合を決めたときは、
       その回の点に「x」を付ける（スコアボードの決まった書き方） */
    const xAt = endedMidInning(res);
    const row = (name, side, other) => {
      let s = '<th class="sb-team">' + esc(name) + '</th>';
      for (let i = 0; i < n; i++) {
        const v = side.byInning[i];
        const x = side === res.home && i === xAt ? 'x' : '';
        s += '<td>' + (v == null ? (i < res.innings ? '×' : '') : v + x) + '</td>';
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

  /** その打席でバットがどう動くか。
      本塁打〜凡打・空振り三振は大きく振り、バント・スクイズは小さく当てにいく。
      四球・死球・見逃し三振は振らない（見送っただけ） */
  function swingKindOf(e) {
    if (!e) return 'idle';
    if (e.code === 'K') return (e.text && e.text.indexOf('空') >= 0) ? 'swing' : 'idle';
    if (['1B', '2B', '3B', 'HR', 'OUT', 'E'].indexOf(e.code) >= 0) return 'swing';
    if (['SH', 'SQ', 'SQF', 'BF', 'BE'].indexOf(e.code) >= 0) return 'bunt';
    return 'idle';
  }

  /** 打者が打席に立っている絵。本塁から少し離した、はっきり分かる
      すき間を空けてうしろに立たせる（本塁に近すぎると、打球が本塁からでなく
      打者から飛び出したように見えてしまうため）。
      右打ちは本塁の三塁側（図の左）、左打ちは一塁側（図の右）に立つので、
      どちら打ちかひと目で分かる。打ったときだけバットを振る */
  function batterView(kind, bats) {
    const flip = bats === 'L';
    const mx = (x) => (flip ? 200 - x : x);
    const cls = (kind === 'swing' ? ' is-swing' : (kind === 'bunt' ? ' is-bunt' : '')) +
      (flip ? ' is-flip' : '');
    const legs = 'M' + mx(83) + ',186 L' + mx(86.4) + ',177 L' + mx(89.6) + ',177 L' + mx(93) + ',186 Z';
    const torsoX = flip ? mx(91.2) : 84.8;
    const handX = mx(90.2), tipX = mx(90.2);
    return '<g class="batter">' +
      '<path class="bt-legs" d="' + legs + '"/>' +
      '<rect class="bt-body" x="' + torsoX + '" y="170.5" width="6.4" height="7" rx="2.6"/>' +
      '<circle class="bt-head" cx="' + mx(88) + '" cy="167.5" r="2.7"/>' +
      '<g class="bt-bat' + cls + '" style="transform-origin:' + handX + 'px 173px">' +
        '<line x1="' + handX + '" y1="173" x2="' + tipX + '" y2="164"/>' +
        '<circle cx="' + tipX + '" cy="164" r="1.4"/>' +
      '</g>' +
    '</g>';
  }

  /* ---------- 小窓の動き（野球速報アプリや野球ゲームの試合画面を参考に） ----------
     ・打球は本塁から飛ぶ。フライは高く上がる（大きく見える）
     ・走者は塁を回って次の塁へ。生還したら本塁で消え、アウトになった走者は消える
     ・ホームランは外野の先で光がはじける
     動きは SVG の animateMotion などで付ける（描き直すたびに最初から動く） */

  const BASE_PT = [[140.5, 111.5], [100, 70.5], [59, 111.5]];
  /* 走者の色は、味方も相手も緑に統一 */
  const TEAM_COLOR = { my: 'var(--accent)', op: 'var(--accent)' };

  function basePt(b) { return (b < 0 || b >= 3) ? HOME : BASE_PT[b]; }

  /** 打球の種類（ゴロ・ライナー・フライ）。高さの出し方に使う */
  function flyKind(e) {
    const t = e.text || '';
    if (e.code === 'HR' || t.indexOf('飛') >= 0) return 'fly';
    if (t.indexOf('直') >= 0 || e.code === '2B' || e.code === '3B') return 'liner';
    return 'ground';
  }

  /** 1人ぶんの走者。g を出発点に置き、そこから塁を順に回る */
  function runnerSvg(from, to, begin, dur, color, fadeAtEnd) {
    const start = basePt(from);
    const pts = [];
    for (let b = from + 1; b <= to; b++) pts.push(basePt(b));
    let anim = '';
    if (pts.length) {
      const path = 'M0,0 ' + pts.map((p) => 'L' + (p[0] - start[0]).toFixed(1) + ',' + (p[1] - start[1]).toFixed(1)).join(' ');
      anim = '<animateMotion path="' + path + '" begin="' + begin.toFixed(2) + 's" dur="' + (dur * pts.length).toFixed(2) + 's" fill="freeze"/>';
    }
    const fade = fadeAtEnd
      ? '<animate attributeName="opacity" from="1" to="0" begin="' + (begin + dur * pts.length).toFixed(2) + 's" dur="0.25s" fill="freeze"/>'
      : '';
    return '<g transform="translate(' + start[0] + ' ' + start[1] + ')"><circle class="fv-runner" r="6" style="fill:' + color + '">' + anim + fade + '</circle></g>';
  }

  function fieldView(bases, outs, e, showBatter) {
    const k = 1 / Math.max(1, speed || 1);
    const offSide = e && e.half ? (e.half === 'top' ? 'away' : 'home') : (ctx && ctx.cur ? ctx.cur.side : 'away');
    const mine = ctx ? ctx.mySide : 'away';
    const offColor = offSide === mine ? TEAM_COLOR.my : TEAM_COLOR.op;
    const isBat = e && e.k === 'pa';
    const prev = (ctx && ctx.prevBases) || [null, null, null];
    const unitFallback = 0.24 * k;
    const arrive = {};
    const leave = {};

    /* 投球は描かない。打球は本塁からすぐに飛ぶ */
    const tPitch = 0;
    const t = isBat ? ballTarget(e) : null;
    const kind = t ? flyKind(e) : null;
    const hr = isBat && e.code === 'HR';
    const flight = t ? (hr ? 0.9 : (kind === 'fly' ? 0.7 : (kind === 'liner' ? 0.42 : 0.5))) * k : 0;

    /* 打球。本塁から落ちどころへ。フライは途中で大きく（高く）見せる */
    let ball = '';
    if (t) {
      const dx = t[0] - HOME[0], dy = t[1] - HOME[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      const big = hr ? 8 : (kind === 'fly' ? 7 : (kind === 'liner' ? 5 : 4.2));
      ball =
        /* 軌跡の線も、ボールと同じ SMIL（同じ開始・同じ長さ・等速）で伸ばす。
           線だけ別のアニメーション（イージングつき）にすると、線の先が先に
           行ってしまい、ボールがあとから追いかけるように見える */
        '<line class="balltrail' + (hr ? ' is-hr' : '') + '" x1="' + HOME[0] + '" y1="' + HOME[1] + '" x2="' + HOME[0] + '" y2="' + HOME[1] + '">' +
          '<animate attributeName="x2" from="' + HOME[0] + '" to="' + t[0] + '" begin="' + tPitch.toFixed(2) + 's" dur="' + flight.toFixed(2) + 's" calcMode="linear" fill="freeze"/>' +
          '<animate attributeName="y2" from="' + HOME[1] + '" to="' + t[1] + '" begin="' + tPitch.toFixed(2) + 's" dur="' + flight.toFixed(2) + 's" calcMode="linear" fill="freeze"/>' +
        '</line>' +
        '<g transform="translate(' + HOME[0] + ' ' + HOME[1] + ')"><circle class="fv-hit' + (hr ? ' is-hr' : '') + '" r="4.2">' +
          '<animateMotion path="M0,0 L' + dx.toFixed(1) + ',' + dy.toFixed(1) + '" begin="' + tPitch.toFixed(2) + 's" dur="' + flight.toFixed(2) + 's" fill="freeze"/>' +
          '<animate attributeName="r" values="4.2;' + big + ';4.2" begin="' + tPitch.toFixed(2) + 's" dur="' + flight.toFixed(2) + 's" fill="freeze"/>' +
        '</circle></g>';
      if (hr) {
        const at = (tPitch + flight).toFixed(2);
        ball += [0, 1, 2].map((i) =>
          '<circle class="fv-burst" cx="' + (t[0] + (i - 1) * 14) + '" cy="' + (t[1] + (i % 2) * 6) + '" r="2">' +
          '<animate attributeName="r" from="2" to="20" begin="' + (Number(at) + i * 0.12).toFixed(2) + 's" dur="0.55s" fill="freeze"/>' +
          '<animate attributeName="opacity" values="0;1;0" begin="' + (Number(at) + i * 0.12).toFixed(2) + 's" dur="0.55s" fill="freeze"/></circle>').join('');
      }
    }

    /* 走者。前の打席の塁と、この打席のあとの塁を比べて動かす */
    let runners = '';
    const after = (e && e.bases) ? e.bases : [null, null, null];
    if (e && (e.k === 'pa' || e.k === 'steal')) {
      const begin = e.k === 'pa' ? tPitch + flight * 0.6 : 0;
      const unit = 0.24 * k;
      let scored = 0;
      prev.forEach((id, base) => {
        if (!id) return;
        const nb = after.indexOf(id);
        if (nb >= 0) { runners += runnerSvg(base, nb, begin, unit, offColor, false); arrive[nb] = begin + unit * (nb - base); }
        else if (e.runs && scored < e.runs) { scored++; runners += runnerSvg(base, 3, begin, unit, offColor, true); }
        else runners += runnerSvg(base, base, begin, unit, offColor, true);
      });
      if (e.k === 'pa' && e.batter) {
        const nb = after.indexOf(e.batter);
        if (nb >= 0 && prev.indexOf(e.batter) < 0) { runners += runnerSvg(-1, nb, begin, unit, offColor, false); arrive[nb] = begin + unit * (nb + 1); }
        else if (hr) runners += runnerSvg(-1, 3, begin, unit * 0.8, offColor, true);
      }
      // 名前のない走者（前の情報が無いとき）はそのまま置く
      after.forEach((id, base) => {
        if (id && prev.indexOf(id) < 0 && !(e.k === 'pa' && id === e.batter)) runners += runnerSvg(base, base, 0, unit, offColor, false);
      });
    } else {
      (bases || []).forEach((on, base) => { if (on) runners += runnerSvg(base, base, 0, 0.2, offColor, false); });
    }

    /* 塁の色は、動きの前の状態から始め、走者が着いた（離れた）ときに変える。
       先に次の塁を緑にすると、結果が先にわかってしまうため */
    const animated = !!(e && (e.k === 'pa' || e.k === 'steal'));
    const b = (i) => {
      const was = animated ? !!prev[i] : !!(bases && bases[i]);
      const now = !!(bases && bases[i]);
      let c = was ? ' is-on' : '';
      if (animated && was !== now) {
        const d = now ? (arrive[i] != null ? arrive[i] : unitFallback) : ((e.k === 'pa' ? flight * 0.6 : 0) + 0.02);
        c += (now ? ' is-turn-on' : ' is-turn-off') + '" style="animation-delay:' + d.toFixed(2) + 's';
      }
      return c;
    };
    /* 三振は「STRIKE OUT」を、マウンドと本塁のあいだに横向きで出す */
    const strikeOut = (e && e.k === 'pa' && e.code === 'K')
      ? '<text class="fv-so" x="100" y="133" text-anchor="middle">STRIKE OUT' +
        '<animate attributeName="opacity" values="0;1;1;0.9" keyTimes="0;0.15;0.8;1" dur="' + (1.1 * k).toFixed(2) + 's" begin="0.12s" fill="freeze"/>' +
        '</text>'
      : '';
    return '<div class="fieldview">' +
      '<div class="fieldview__main">' +
      '<svg viewBox="0 0 200 188" aria-hidden="true">' +
        '<path class="fv-grass" d="M100 152 L14 66 A122 122 0 0 1 186 66 Z"/>' +
        '<path class="fv-fence" d="M14 66 A122 122 0 0 1 186 66"/>' +
        '<polygon class="fv-inf" points="100,152 141,111 100,70 59,111"/>' +
        '<rect class="fv-base' + b(0) + '" x="136" y="107" width="9" height="9" transform="rotate(45 140.5 111.5)"/>' +
        '<rect class="fv-base' + b(1) + '" x="95.5" y="66" width="9" height="9" transform="rotate(45 100 70.5)"/>' +
        '<rect class="fv-base' + b(2) + '" x="54.5" y="107" width="9" height="9" transform="rotate(45 59 111.5)"/>' +
        '<polygon class="fv-home" points="100,147 105,152 100,157 95,152"/>' +
        (showBatter === false ? '' : batterView(swingKindOf(e), e && e.batterBats)) +
        ball + runners + strikeOut +
      '</svg>' +
      '<div class="outs">' + [0, 1, 2].map((i) =>
        '<i class="out' + (i < outs ? ' is-on' : '') + '"></i>').join('') + '<span>OUT</span></div>' +
      '</div>' +
    '</div>';
  }

  /* ---------- 両軍のオーダー ---------- */

  /** 投打（投げる手・打つ手）。右投左打なら「右左」 */
  function handShort(p) {
    return (p.throws === 'L' ? '左' : '右') + (p.bats === 'L' ? '左' : (p.bats === 'B' ? '両' : '右'));
  }

  /** 名前の下に出す、打つほうの能力だけの小さい行。
      守備や肩まで並べると半分の幅に収まらないので、
      打席を見ているあいだに気になる4つだけにしてある */
  function abTiny(p) {
    const r = (v) => {
      const g = rankOf(v);
      return '<b class="rank-' + g + '">' + g + '</b>';
    };
    return '<span class="ll__ab">弾道' + p.traj +
      ' ミート' + r(p.meet) + ' パワー' + r(p.power) + ' 走力' + r(p.speed) + '</span>';
  }

  /** 今日の投手成績（投球回・球数・被安打・奪三振・四球） */
  function pitLine(s) {
    if (!s) return '';
    const ip = Math.floor(s.outs / 3) + (s.outs % 3 ? ' ' + (s.outs % 3) + '/3' : '');
    return '<span class="ll__today">' +
      '<i>投球回<b>' + ip + '</b></i><i>球数<b>' + (s.np || 0) + '</b></i>' +
      '<i>被安打<b>' + (s.h || 0) + '</b></i><i>奪三振<b>' + (s.so || 0) + '</b></i>' +
      '<i>四球<b>' + (s.bb || 0) + '</b></i></span>';
  }

  /** 投手の欄。名前のあとに、投げるほうの能力と変化球、いまの余力を出す。
      bf は「いまの投手が受けた打者の数」。交代すると0に戻る */
  function pitBlock(p, bf) {
    if (!p) return '';
    const r = (v) => {
      const g = rankOf(v);
      return '<b class="rank-' + g + '">' + g + '</b>';
    };
    /* スタミナ。打者を受けるほど減り、限界を超えると球威と制球が落ちていく。
       色が変わるところが、その落ちはじめ。前の試合から抜けきっていない
       ぶん（staminaCarry）があれば、今日はそこから始まる */
    const cap = Sim.capacityOf(p);
    const limit = cap + 18;
    const faced = Math.max(0, (p.staminaCarry || 0) + (bf || 0));
    const left = Math.max(0, Math.min(1, 1 - faced / limit));
    const worn = faced > cap + 9 ? ' is-low' : (faced > cap ? ' is-mid' : '');
    return '<div class="ll__p">' +
      '<span class="ll__pname">投手　' +
        '<button type="button" class="linkbtn llpit" data-pid="' + p.id + '">' +
        esc(p.name) + '</button>' +
        '<span class="ll__gr">' + p.grade + '年</span>' +
        '<span class="ll__gr ll__hand">' + handShort(p) + '</span></span>' +
      '<span class="ll__ab">球速' + p.velo + ' 制球' + r(p.control) +
        ' スタミナ' + r(p.stamina) + '</span>' +
      '<span class="ll__sta' + worn + '">' +
        '<span class="ll__stanum">スタミナ' + Math.round(left * 100) + '%' +
          (worn ? '↓' : '') + '</span>' +
        '<i class="ll__bar"><b style="width:' + Math.round(left * 100) + '%"></b></i>' +
      '</span>' +
      '<span class="ll__balls">' + Player.pitchesInOrder(p).map((q) =>
        '<i class="ll__ball">' + esc(q.name) + '<b>' + q.level + '</b></i>').join('') + '</span>' +
      pitLine(p.game) +
    '</div>';
  }

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
          '<span class="ll__gr">' + p.grade + '年</span>' +
          '<span class="ll__gr ll__hand">' + handShort(p) + '</span>' +
          abTiny(p) +
          '<span class="ll__res">' + res + '</span></li>';
      }).join('');
      const pit = Team.find(t, cur[key + 'Pitcher']);
      return '<div class="ll' + (cur.side === key ? ' is-batting' : '') + '">' +
        '<h4 class="ll__title">' + esc(t.name) + '<i>' + (cur.side === key ? '攻撃' : '守備') + '</i></h4>' +
        '<ol class="ll__list">' + rows + '</ol>' +
        pitBlock(pit, cur[key + 'Bf']) + '</div>';
    };
    /* 先攻（away）を右、後攻（home）を左に出す */
    return side(home, 'home') + side(away, 'away');
  }

  /* ---------- 試合の再生 ---------- */

  function start(gs, live, onDone) {
    const away = gs.away, home = gs.home;
    ctx = {
      live, onDone, i: 0, done: false,
      /* 自分が操る側。タイムをかけられるのはこちらだけ */
      mySide: gs.mySide || 'away',
      /* 交代を1つずつ外に渡す／どこまで見たかを外に伝える。
         中断して開き直したときに同じ試合を続けるために使う */
      onSub: gs.onSub || null,
      onProgress: gs.onProgress || null,
      timeAt: 0,
      /* この試合で退いた選手。試合ごとに作り直す。
         中断から戻ったときは、そこまでに退いた選手を引き継ぐ */
      retired: new Set(gs.retired || []),
      state: {
        awayName: away.name, homeName: home.name,
        awayInn: [], homeInn: [], awayR: 0, homeR: 0,
        awayH: 0, homeH: 0, awayE: 0, homeE: 0,
        inning: 1, maxInning: 9, half: 'top',
      },
      cur: { side: 'away', order: 1, nextOrder: 1, results: {}, awayPitcher: null, homePitcher: null },
      away, home,
    };

    /* 先発投手を控えておく（交代したらそのつど書き換える） */
    ctx.cur.awayPitcher = away.rotation[0];
    ctx.cur.homePitcher = home.rotation[0];

    UI.el('btn-skip').hidden = false;
    const bt = UI.el('btn-time');
    if (bt) bt.hidden = false;
    /* はじめは「1打席ずつ」。まず1打席ぶんを読んでもらってから、
       速くしたい人が速さを上げる */
    speed = 0;
    chanceMode = false;
    staminaMode = false;
    applySpeedButtons();
    UI.show('screen-game');
    /* 中断から戻ったときは、見たところまでを黙って流してから続ける */
    let stage = '';
    while (ctx.i < (gs.skipTo || 0) && pull()) stage = apply(ctx.live.log[ctx.i++]);
    render(stage);
    /* 試合開始のボタンを押したら、試合の画面のいちばん上から見せる。
       押したボタンにフォーカスが残っていると、スマホのブラウザがその位置へ
       スクロールを戻してしまうことがあるので、外してから、描き終わったあとにも
       もう一度いちばん上へ送る */
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const toTop = () => window.scrollTo(0, 0);
    toTop();
    requestAnimationFrame(toTop);
    setTimeout(toTop, 120);
    step();
  }

  /* ---------- 速さの切り替え ---------- */

  function applySpeedButtons() {
    document.querySelectorAll('#game-speed .speedbtn').forEach((b) => {
      if (b.dataset.sp === 'chance') { b.classList.toggle('is-on', chanceMode); return; }
      if (b.dataset.sp === 'stamina') { b.classList.toggle('is-on', staminaMode); return; }
      b.classList.toggle('is-on', !chanceMode && !staminaMode && +b.dataset.sp === speed);
    });
  }

  function setSpeed(v) {
    const was = speed;
    chanceMode = false;
    staminaMode = false;
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

  /** 「チャンスまで」ボタン。×3と同じ速さで進み、チャンス（ピンチ）の
      場面に来たところで自動的に1打席ずつへ切り替える */
  function setChanceMode() {
    chanceMode = true;
    staminaMode = false;
    speed = 3;
    applySpeedButtons();
    if (!ctx || ctx.done) return;
    if (ctx.awaitTap) {
      ctx.awaitTap = false;
      showTapHint(false);
      step();
    }
  }

  /** 「スタミナが切れるまで」ボタン。×3と同じ速さで進み、自軍の投手の
      スタミナが30%まで減ったところで自動的に1打席ずつへ切り替える */
  function setStaminaMode() {
    staminaMode = true;
    chanceMode = false;
    speed = 3;
    applySpeedButtons();
    if (!ctx || ctx.done) return;
    if (ctx.awaitTap) {
      ctx.awaitTap = false;
      showTapHint(false);
      step();
    }
  }

  /** 自軍のいまの投手の、スタミナの残り（0〜1）。
      試合中の表示（pitBlock）と同じ式 */
  function myPitcherStaminaLeft() {
    const key = ctx.mySide === 'home' ? 'home' : 'away';
    const p = Team.find(myTeam(), ctx.cur[key + 'Pitcher']);
    if (!p) return 1;
    const limit = Sim.capacityOf(p) + 18;
    const faced = Math.max(0, (p.staminaCarry || 0) + (ctx.cur[key + 'Bf'] || 0));
    return Math.max(0, Math.min(1, 1 - faced / limit));
  }

  /** いまの走者・アウト数が「チャンス（ピンチ）」の場面か。
      得点圏（二塁・三塁）に走者がいるとき、タイブレークの無死一二塁も含む */
  function isChanceEvent(e) {
    if (e.k === 'half') return !!e.tie;
    if (e.k === 'pa' || e.k === 'steal') return !!(e.bases && (e.bases[1] || e.bases[2]));
    return false;
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
    /* いまの投手がどれだけ投げたかを拾っておく（余力の表示に使う） */
    const live = ctx.live.state ? ctx.live.state() : null;
    ctx.cur.awayBf = live && live.A ? live.A.bf : 0;
    ctx.cur.homeBf = live && live.H ? live.H.bf : 0;
    UI.html('game-scoreboard', liveScoreboard(ctx.state));
    UI.html('game-stage', stageHtml);
    UI.html('game-lineups', liveLineups(ctx.away, ctx.home, ctx.cur));
    const wrap = UI.el('game-lineups');
    const open = (pid) => {
      const p = Team.find(ctx.away, pid) || Team.find(ctx.home, pid);
      if (p) UI.openPlayer(p, { team: myTeam(), rename: false });
    };
    wrap.querySelectorAll('.ll__item').forEach((li) =>
      li.addEventListener('click', () => open(li.dataset.pid)));
    /* 投手の名前も押せるようにする。打者と同じで、両チームとも見られる */
    wrap.querySelectorAll('.llpit').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); open(b.dataset.pid); }));
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

  /** 采配を出した打席には、その名前を添える */
  function ordTag(e) {
    return e.ord && e.ord.length ? '<span class="stage__ord">采配：' + esc(e.ord.join('・')) + '</span>' : '';
  }

  function apply(e) {
    const st = ctx.state, cur = ctx.cur;
    if (e.k === 'half') {
      st.inning = e.inning; st.half = e.half;
      st.maxInning = Math.max(st.maxInning, e.inning);
      cur.side = e.half === 'top' ? 'away' : 'home';
      /* 回のはじめに、次の打者へ表示を合わせる */
      if (e.nextOrder) { cur.order = e.nextOrder; cur.nextOrder = e.nextOrder; }
      /* 前の半分の回を締める。攻撃中は空欄のままで、
         回が終わってはじめて 0 を入れる */
      closeHalf(st);
      st.openHalf = { side: cur.side, inning: e.inning };
      ctx.prevBases = [e.tie ? 'tie1' : null, e.tie ? 'tie2' : null, null];
      /* イニングの変わり目では、まだ誰も打席に入っていないので
         打者の絵は出さない */
      return '<div class="stage__half">' + halfLabel(e) + (e.tie ? '　タイブレーク' : '') + '</div>' +
        fieldView([e.tie, e.tie, false], 0, null, false);
    }

    if (e.k === 'sub') {
      if (e.side === 'home') cur.homePitcher = e.pitcher; else cur.awayPitcher = e.pitcher;
      return '<div class="stage__sub">' + esc(e.text) + '</div>' + fieldView([false, false, false], 0, null);
    }

    if (e.k === 'steal') {
      /* 暴投・捕逸で点が入ったときは、スコアボードにも足す */
      if (e.runs) {
        const arr = e.half === 'top' ? st.awayInn : st.homeInn;
        arr[e.inning - 1] = (arr[e.inning - 1] || 0) + e.runs;
        st.awayR = e.score[0]; st.homeR = e.score[1];
      }
      const html = '<div class="stage__play' + (e.ok ? ' is-good' : ' is-bad') + '">' +
        '<span class="stage__meta">' + halfLabel(e) + '</span>' + ordTag(e) +
        '<span class="stage__text">' + esc(e.text) + '</span></div>' +
        fieldView(e.bases.map(Boolean), e.outs, e);
      ctx.prevBases = e.bases.slice();
      return html;
    }

    if (e.k === 'pa') {
      const off = e.half === 'top' ? 'away' : 'home';
      cur.side = off; cur.order = e.order;
      /* cur.order は「いま打った打順」（打者の見せ方に使う）。
         代打はまだ打っていない次の打者に出すので、別に「次の打者」を持っておく。
         盗塁など打席の外の出来事をはさんで止めても、ここは動かないので
         ずれない（cur.order をそのまま代打に使うと、1人前の打者に
         代打が出てしまうことがあった） */
      cur.nextOrder = (e.order % 9) + 1;
      (cur.results[e.batter] = cur.results[e.batter] || []).push(e.text);
      const arr = off === 'away' ? st.awayInn : st.homeInn;
      /* 点が入ったときだけ数字を置く。入らないうちは空欄のまま */
      if (e.runs) arr[e.inning - 1] = (arr[e.inning - 1] || 0) + e.runs;
      st.awayR = e.score[0]; st.homeR = e.score[1];
      if (['1B', '2B', '3B', 'HR'].indexOf(e.code) >= 0) {
        if (off === 'away') st.awayH++; else st.homeH++;
      }
      if (e.code === 'E' || e.code === 'BE') { if (off === 'away') st.homeE++; else st.awayE++; }

      const good = ['1B', '2B', '3B', 'HR', 'BB', 'HBP', 'E', 'BE'].indexOf(e.code) >= 0;
      /* 何を投げたか。球種と球速を打席結果の上に添える */
      const ball = e.pitch
        ? '<span class="stage__ball">' + esc(e.pitch) +
          (e.pitchSpeed ? ' <b>' + e.pitchSpeed + '</b>km/h' : '') + '</span>'
        : '';
      const playHtml = '<div class="stage__play' + (e.code === 'HR' ? ' is-hr' : (good ? ' is-good' : '')) + '">' +
        '<span class="stage__meta">' + halfLabel(e) + '　' + e.order + '番 ' + esc(e.batterName) + '</span>' +
        ordTag(e) + ball +
        '<span class="stage__text">' + esc(e.text) +
          (e.runs ? '<b class="stage__runs">+' + e.runs + '点</b>' : '') + '</span>' +
        '</div>' + fieldView(e.bases.map(Boolean), e.outs, e);
      ctx.prevBases = e.bases.slice();
      return playHtml;
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
    /* 回の変わり目ごとに、どこまで見たかを記録してもらう。
       1打席ごとに書くと保存が重いので、この粒度にしてある */
    if (e.k === 'half' && ctx.onProgress) ctx.onProgress(ctx.i);
    /* 「チャンスまで」の最中に、チャンス（ピンチ）の場面へ来たら、
       そこで1打席ずつに切り替えてタップ待ちにする */
    if (chanceMode && isChanceEvent(e)) {
      chanceMode = false;
      speed = 0;
      applySpeedButtons();
      ctx.awaitTap = true;
      showTapHint(true);
      return;
    }
    /* 「スタミナが切れるまで」の最中に、自軍の投手のスタミナが
       30%まで減ったら、そこで1打席ずつに切り替えてタップ待ちにする */
    if (staminaMode && myPitcherStaminaLeft() <= STAMINA_STOP) {
      staminaMode = false;
      speed = 0;
      applySpeedButtons();
      ctx.awaitTap = true;
      showTapHint(true);
      return;
    }
    /* グラウンドの小窓の動き（投球→打球→走塁）が見終わるくらいの間を取る */
    const wait = e.k === 'half' ? 700 : (e.k === 'pa' ? (e.code === 'HR' ? 1350 : (e.runs ? 1200 : 950)) : 800);
    schedule(wait);
  }

  /** 残りをまとめて流して、結果画面へ */
  function skip() {
    if (!ctx || ctx.done) return;
    clearTimeout(timer);
    ctx.awaitTap = false;
    ctx.paused = false;
    /* スキップしたあとは、自分の側もAI監督にまかせる（疲れた投手を投げさせ続けない） */
    if (ctx.live.autopilot) ctx.live.autopilot();
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
     試合を止めて、代打・代走・守備交代・守備位置・投手交代をする。
     守備交代（選手の入れ替え）は守備中にしか出さない。攻撃中は
     代打・代走でまかなう。
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
    /* 並びは、試合前に先発を選ぶ列の並び（1番手から順）のまま。
       先発に選んだ投手は、すでに投げているので外れ、残りが1番手から順に並ぶ。
       並びを持っていないチーム（相手など）は、起用順で並べる */
    const base = (t.pitcherOrder && t.pitcherOrder.length ? t.pitcherOrder : t.rotation) || [];
    const rank = (p) => { const i = base.indexOf(p.id); return i < 0 ? base.length : i; };
    return t.pitchers.filter((p) => !out.has(p.id) && p.id !== nowId && !p.game.g)
      .sort((a, b) => rank(a) - rank(b));
  }

  function currentPitcherId(t) {
    return t === ctx.away ? ctx.cur.awayPitcher : ctx.cur.homePitcher;
  }

  /** いま守っているのはどちらか */
  function iAmFielding() {
    return ctx.cur.side !== ctx.mySide;
  }

  /** 次に打つ打順（1〜9）。代打はここに入れる */
  function nextOrder() { return ctx.cur.nextOrder; }

  function openTime() {
    if (!ctx || ctx.done) return;
    clearTimeout(timer);
    ctx.paused = true;
    /* この止まった場所を控えておく。中断から戻ったとき、
       同じところで同じ交代を入れ直すために使う */
    ctx.timeAt = ctx.live.log.length;
    ctx.savedOrders = JSON.stringify(ctx.live.state().orders || null);
    /* 「1打席ずつ」でタップ待ちだったかを覚えておく。
       覚えずに戻すと、タイムを閉じた拍子に1打席ぶん進んでしまう */
    ctx.wasWaiting = !!ctx.awaitTap;
    ctx.awaitTap = false;
    showTapHint(false);
    /* ふきだしの外を触ったとき、×で閉じたとき、Esc を押したときも
       試合に戻す。どの閉じ方でも止まったままにならないようにしておく。
       ここを「試合に戻る」のボタンだけにしていたときは、外を触ると
       試合が止まったまま動かなくなっていた */
    UI.closeModal.after = resumeTime;
    timeMenu();
  }

  /** どの閉じ方でもここを通る。二重に呼ばれても平気なようにしてある */
  function resumeTime() {
    if (!ctx || ctx.done || !ctx.paused) return;
    commitOrders();
    ctx.paused = false;
    render(UI.el('game-stage').innerHTML);
    /* 「1打席ずつ」なら、閉じたあともタップを待つところへ戻す。
       ここで step() を呼ぶと、タイムをかけただけで1打席進んでしまう */
    if (speed === 0 || ctx.wasWaiting) {
      ctx.wasWaiting = false;
      ctx.awaitTap = true;
      showTapHint(true);
      return;
    }
    step();
  }

  function closeTime() {
    UI.closeModal();          // 閉じたあとに resumeTime が呼ばれる
    resumeTime();             // 念のため（after が外されていた場合の保険）
  }

  function timeMenu() {
    const t = myTeam();
    const fielding = iAmFielding();
    const n = nextOrder();
    const slot = t.lineup[n - 1];
    const batter = slot ? Team.find(t, slot.pid) : null;
    const pit = Team.find(t, currentPitcherId(t));
    const runners = fielding ? [] : baseRunners();

    UI.modal(
      '<h3 class="modal__title">タイム</h3>' +
      '<p class="time__where">' + ctx.state.inning + '回' +
        (ctx.state.half === 'top' ? '表' : '裏') + '　' +
        (fielding ? '守備中' : '攻撃中') + '</p>' +
      '<div class="time__now">' +
        (pit ? '<div>いまの投手　<b>' + esc(pit.name) + '</b>　体力' +
          Team.staminaGauge(pit) + '</div>' : '') +
        (batter ? '<div>次の打者　<b>' + n + '番 ' + esc(batter.name) + '</b></div>' : '') +
        '<div>采配　<b>' + esc(ordersText()) + '</b></div>' +
      '</div>' +
      '<div class="time__menu">' +
        '<button type="button" class="btn btn--wide btn--primary" id="tm-orders">采配</button>' +
        (fielding ? '' :
          '<button type="button" class="btn btn--wide" id="tm-ph">代打を出す</button>') +
        (runners.length ?
          '<button type="button" class="btn btn--wide" id="tm-pr">代走を出す</button>' : '') +
        /* 投手交代は守備中だけ。攻撃中は出さない */
        (fielding ? '<button type="button" class="btn btn--wide" id="tm-pit">投手を交代する</button>' : '') +
        (fielding ?
          '<button type="button" class="btn btn--wide" id="tm-sub">守備を交代する</button>' : '') +
        '<button type="button" class="btn btn--wide" id="tm-pos">守備位置を変える</button>' +
      '</div>' +
      '<div class="actions actions--modal">' +
        '<button type="button" class="btn btn--primary btn--wide" id="tm-close">試合に戻る</button>' +
      '</div>',
      {
        kind: 'time',
        onOpen(body) {
          const on = (id, fn) => { const b = body.querySelector(id); if (b) b.addEventListener('click', fn); };
          on('#tm-orders', () => ordersMenu());
          on('#tm-ph', () => pinchHit());
          on('#tm-pr', () => pinchRun());
          on('#tm-sub', () => subPlayer());
          on('#tm-pos', () => changePos());
          on('#tm-pit', () => { if (iAmFielding()) changePitcher(); });
          on('#tm-close', closeTime);
        },
      }
    );
  }

  /* ---------- 采配 ----------
     攻撃中は「全員に指示」と「走者に指示」、守備中は守備の指示を出す。
     出した指示は次の打席だけに効く（sim.js）。ボタンは押すたびに入り切り。
     同時にできない指示を押したときは、先に押していたほうが外れる。 */

  const ORDER_HINT = {
    steal: '一二塁なら2人ともスタート', bunt: '送りバントで走者を進める',
    squeeze: '三塁走者を還す（失敗は憤死）', buster: 'バントの構えから強く打つ',
    safety: '自分も生きようと転がす', he: '走者スタート。当てにいく',
    busterHE: 'バントの構えからのエンドラン', meet: '三振が減る・長打が減る',
    power: '長打が増える・三振も増える', stick: '粘って四球を狙う・球数が増える',
    roll: 'ゴロを打つ。走者を進めやすい', fly: 'フライを打つ。犠飛・長打狙い',
    gg: 'ゴロならスタート', ig: '打った瞬間にスタート', sg: 'スイングと同時にスタート',
    ibb: '勝負を避けて歩かせる', strike: '四球が減る・打たれやすい',
    edge: '三振が増える・四球も増える', fast: '直球中心。速い投手ほど有利',
    brk: '変化球中心。切れ味しだい',
  };

  /** いま出してある采配の文字（タイムの画面に出す） */
  function ordersText() {
    const o = ctx.live.state().orders;
    if (!o) return 'なし';
    const list = [].concat(o.all || [], o.run || [], o.def || []).map((k) => Sim.ORDER_LABELS[k]).filter(Boolean);
    return list.length ? list.join('・') : 'なし';
  }

  /** 采配が変わっていれば、中断から戻ったときに同じにできるよう記録に残す */
  function commitOrders() {
    if (!ctx || !ctx.onSub) return;
    const now = JSON.stringify(ctx.live.state().orders || null);
    if (now === ctx.savedOrders) return;
    ctx.savedOrders = now;
    ctx.onSub({ at: ctx.timeAt, orders: ctx.live.state().orders || null });
  }

  function ordersMenu() {
    const st = ctx.live.state();
    const bases = (st.bases || [null, null, null]);
    const outs = st.outs || 0;
    const fielding = iAmFielding();
    const cur = st.orders || {};
    const sel = { all: (cur.all || []).slice(), run: (cur.run || []).slice(), def: (cur.def || []).slice() };
    const groups = fielding ? ['def'] : ['all', 'run'];
    const title = { all: '全員に指示', run: '走者に指示', def: '守備の指示' };
    const runnerNames = bases.map((b, i) => (b ? ['一塁', '二塁', '三塁'][i] + ' ' + b.name : null)).filter(Boolean);

    const apply = () => ctx.live.setOrders(sel);
    const isOn = (k) => sel.all.indexOf(k) >= 0 || sel.run.indexOf(k) >= 0 || sel.def.indexOf(k) >= 0;
    const drop = (k) => { ['all', 'run', 'def'].forEach((g) => { sel[g] = sel[g].filter((x) => x !== k); }); };

    const draw = () => {
      const sections = groups.map((g) => {
        const keys = Sim.ORDER_GROUPS[g].filter((k) => Sim.orderAvailable(k, bases, outs));
        const body = keys.length
          ? '<div class="ordgrid">' + keys.map((k) =>
              '<button type="button" class="ordbtn' + (isOn(k) ? ' is-on' : '') + '" data-k="' + k + '" data-g="' + g + '">' +
              '<b>' + esc(Sim.ORDER_LABELS[k]) + '</b><span>' + esc(ORDER_HINT[k] || '') + '</span></button>').join('') + '</div>'
          : '<p class="time__empty">' + (g === 'run' ? '走者がいないので、指示は出せません。' : 'いまの場面で出せる指示はありません。') + '</p>';
        return '<h4 class="sub">' + title[g] + '</h4>' + body;
      }).join('');
      UI.html('modal-body',
        '<h3 class="modal__title">采配</h3>' +
        '<p class="time__where">' + ctx.state.inning + '回' + (ctx.state.half === 'top' ? '表' : '裏') + '　' +
          (fielding ? '守備中' : '攻撃中') + '　' + outs + 'アウト' +
          (!fielding ? '　' + (runnerNames.length ? esc(runnerNames.join('・')) : '走者なし') : '') + '</p>' +
        '<p class="tiny">出した指示は、次の1打席だけに効きます。同時にできない指示を押すと、先に押していたほうが外れます。</p>' +
        sections +
        '<div class="actions actions--modal">' +
          '<button type="button" class="btn" id="od-clear">指示をすべて外す</button>' +
          '<button type="button" class="btn btn--primary" id="od-back">決定</button></div>');
      const body = UI.el('modal-body');
      body.querySelectorAll('.ordbtn').forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.k, g = b.dataset.g;
        if (isOn(k)) drop(k);
        else {
          /* 同時にできない指示は、先に押していたほうを外す */
          (Sim.ORDER_CONFLICTS[k] || []).forEach(drop);
          sel[g].push(k);
        }
        apply();
        draw();
      }));
      body.querySelector('#od-clear').addEventListener('click', () => { sel.all = []; sel.run = []; sel.def = []; apply(); draw(); });
      body.querySelector('#od-back').addEventListener('click', () => { commitOrders(); UI.closeModal.back = null; timeMenu(); });
    };
    UI.closeModal.back = () => { commitOrders(); UI.closeModal.back = null; timeMenu(); };
    draw();
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
          '<span class="spick__fat">' + (x.rightHtml || esc(x.right || '')) + '</span>' +
          '<span class="spick__meta">' + x.meta + '</span>' +
          (x.balls ? '<span class="spick__balls">' + x.balls + '</span>' : '') +
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
        noteSub('代打　' + out.name + ' → ' + inP.name);
        afterSub();
      }, '控えに出せる選手がいません。');
  }

  /** いまの走者（一塁・二塁・三塁の順）。いない塁は飛ばす */
  function baseRunners() {
    const live = ctx.live.state ? ctx.live.state() : null;
    const bases = live && live.bases;
    if (!bases) return [];
    const labels = ['一塁', '二塁', '三塁'];
    return bases.map((p, i) => (p ? { i, p, label: labels[i] } : null)).filter(Boolean);
  }

  /** 代走。走者を控えの選手に差し替える。差し替えた選手は、
      以後その打順が回ってきたときも打つ（代打と同じ扱い）。
      足の速い選手のほうが盗塁を仕掛けやすくなる */
  function pinchRun() {
    const t = myTeam();
    const runners = baseRunners();
    if (!runners.length) { timeMenu(); return; }

    const doPick = (r) => {
      const list = availableBench(t).map((p) => ({ p, meta: batMeta(p) }));
      pickPlayer('代走', r.label + ' ' + r.p.name + ' に代えて',
        list, (pid) => {
          const inP = Team.find(t, pid);
          const live = ctx.live.state ? ctx.live.state() : null;
          if (!inP || !live || !live.bases) { timeMenu(); return; }
          live.bases[r.i] = inP;
          inP.pinchRunner = true;
          /* 代走は、元の走者の出塁を引き継ぐ（この走者が還ったときの失点は、
             元の走者を出した投手に付く。失策で出た走者なら自責点にならない） */
          inP._resp = r.p._resp; inP._uer = r.p._uer;
          const idx = t.lineup.findIndex((s) => s.pid === r.p.id);
          if (idx >= 0) t.lineup[idx] = { pid: inP.id, pos: t.lineup[idx].pos };
          retired().add(r.p.id);
          noteSub('代走　' + r.p.name + ' → ' + inP.name);
          afterSub();
        }, '控えに出せる選手がいません。');
    };

    if (runners.length === 1) { doPick(runners[0]); return; }
    const list = runners.map((r) => ({ p: r.p, meta: r.label + '　' + batMeta(r.p) }));
    pickPlayer('代走', 'どの走者に代走を送りますか', list, (pid) => {
      const r = runners.find((x) => x.p.id === pid);
      if (r) doPick(r); else timeMenu();
    });
  }

  /** 守備交代。守っている選手を控えと入れ替える */
  function subPlayer() {
    const t = myTeam();
    const list = t.lineup.map((s, i) => {
      const p = Team.find(t, s.pid);
      return p ? { p, meta: (i + 1) + '番 ' + posName(s.pos) + '　' + batMeta(p), idx: i } : null;
    }).filter(Boolean);
    pickPlayer('守備を交代する', 'まず、退く選手を選んでください', list, (pid) => {
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
        noteSub('守備交代　' + out.name + ' → ' + inP.name);
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
    pickPlayer('守備位置を変える', '入れ替える1人目の選手', mk(), (pidA) => {
      const a = t.lineup.findIndex((s) => s.pid === pidA);
      const rest = mk().filter((x) => x.p.id !== pidA);
      pickPlayer('守備位置を変える', Team.find(t, pidA).name + ' と入れ替える選手', rest, (pidB) => {
        const b = t.lineup.findIndex((s) => s.pid === pidB);
        if (a < 0 || b < 0) { timeMenu(); return; }
        const pa = t.lineup[a].pos, pb = t.lineup[b].pos;
        t.lineup[a].pos = pb; t.lineup[b].pos = pa;
        noteSub('守備変更　' + Team.find(t, pidA).name + ' ' + posName(pb) +
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
      p, rightHtml: Team.staminaGauge(p),
      meta: p.grade + '年・' + (p.throws === 'L' ? '左' : '右') +
        '　球速 <b class="rankval">' + p.velo + '</b>km/h' +
        '　制球 ' + UI.rankNum(p.control) + '　スタミナ ' + UI.rankNum(p.stamina),
      /* 変化球も出す。試合前に先発を選ぶ画面と同じ並べ方 */
      balls: Screens.pitchText(p),
    }));
    pickPlayer('投手を交代する', now ? now.name + ' に代えて' : '', list, (pid) => {
      const side = ctx.mySide;
      if (ctx.live.changePitcher(side, pid)) {
        if (now) retired().add(now.id);
        saveSub({ pitcher: pid });
      }
      afterSub();
    }, 'まだ投げていない投手がいません。');
  }

  /** 交代を1つ、外（保存する側）に渡す。
      中断して開き直したときは、ここに渡したものを同じ順番で入れ直す。
      並びそのものを丸ごと控えるので、代打でも守備変更でも同じ形で戻せる */
  function saveSub(extra) {
    if (!ctx || !ctx.onSub) return;
    const t = myTeam();
    ctx.onSub(Object.assign({
      at: ctx.timeAt,
      lineup: JSON.parse(JSON.stringify(t.lineup || [])),
      bench: (t.bench || []).slice(),
      rotation: (t.rotation || []).slice(),
      out: Array.from(retired()),
    }, extra));
  }

  /** 交代の文言を記録に残しつつ、あとで同じ行を積み直せるようにする */
  function noteSub(text) {
    ctx.live.note(text);
    saveSub({ note: text });
  }

  /** 保存してあった交代を入れ直す（試合の再開に使う） */
  function replaySub(live, team, side, rec) {
    if (rec.lineup) team.lineup = JSON.parse(JSON.stringify(rec.lineup));
    if (rec.bench) team.bench = rec.bench.slice();
    if (rec.rotation) team.rotation = rec.rotation.slice();
    if (rec.note) live.note(rec.note);
    if (rec.orders !== undefined) live.setOrders(rec.orders);
    if (rec.pitcher) live.changePitcher(side, rec.pitcher);
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

  /** 成長の1行ぶん。守備適性は数字でなく評価で出す */
  function upText(u) {
    if (u.apt) return esc(u.label) + ' ' + u.before + '→' + u.after;
    return esc(u.label) + ' +' + u.amount + (u.unit || '');
  }

  function growthList(report) {
    const awake = report.filter((r) => r.awakened);
    const grew = report.filter((r) => !r.awakened && r.ups.length);
    let html = '';
    if (awake.length) {
      html += '<div class="awakebox"><h4 class="awakebox__title">覚醒</h4>' +
        awake.map((r) => '<p class="awakebox__line"><b>' + esc(r.name) + '</b>（' + r.grade + '年）が覚醒した！　' +
          r.ups.map(upText).join('　') + '</p>').join('') +
        '</div>';
    }
    if (grew.length) {
      html += '<details class="growthbox"><summary>成長した選手（' + grew.length + '人）</summary>' +
        '<ul class="growthlist">' + grew.map((r) =>
          '<li><b>' + esc(r.name) + '</b><span>' + r.ups.map((u) =>
            upText(u)).join('　') + '</span></li>').join('') +
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
      UI.decisionLines(state.lastResult || {}) +
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
      if (p) UI.openPlayer(p, { team: state.team, rename: !!Team.find(state.team, tr.dataset.pid) });
    }));
    UI.show('screen-result');
  }

  /** 速さのボタンとタップの受け口を用意する（起動時に一度だけ） */
  function init() {
    document.querySelectorAll('#game-speed .speedbtn').forEach((b) =>
      b.addEventListener('click', () => {
        if (b.dataset.sp === 'chance') setChanceMode();
        else if (b.dataset.sp === 'stamina') setStaminaMode();
        else setSpeed(+b.dataset.sp);
      }));
    const st = UI.el('game-stage');
    if (st) st.addEventListener('click', tap);
    const hint = UI.el('game-taphint');
    if (hint) hint.addEventListener('click', tap);
    const bt = UI.el('btn-time');
    if (bt) bt.addEventListener('click', openTime);
    applySpeedButtons();
  }

  return { start, skip, result, scoreboard, setSpeed, init, openTime, replaySub };
})();
