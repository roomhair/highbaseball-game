/* ==================================================
   高校野球  soccer-game.js

   サッカー部の試合中画面。野球の試合画面と同じく、起きた出来事を
   時間をかけて見せる演出をここで作る。
   ・Soccer.playUser() がすでに決めた結果（出来事の並び：パスをつないだ
     選手・シュートの結末・得点）を、フィールドの上で動きにして見せるだけ。
     試合そのものの計算（勝敗・得点）はここでは一切しない。
   ・フィールドとゴールを描き、11人ずつの選手・ボールを動かす。
     パス、シュート、セーブ、ゴール（ゴール演出つき）。
   ・フィールドの上に、前半・後半（延長・PK戦）と経過時間を出す。
   ・自軍は左から右へ攻める（ホームかアウェーかは関係なく、見やすさ優先）。
   ================================================== */
'use strict';

const SoccerGameScreen = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 105, H = 68;
  const COLOR = { my: '#2f6fe4', op: '#e5483c', myGK: '#f2c14e', opGK: '#8a63e8' };
  const BASE = {
    GK: [[5, 34]],
    DF: [[20, 11], [20, 25], [20, 43], [20, 57]],
    MF: [[40, 9], [40, 24], [40, 44], [40, 59]],
    FW: [[60, 27], [60, 41]],
  };

  let res = null;
  let myName = '', oppName = '';
  let runId = 0;
  let speed = 1;            // 1・2・3（倍速）
  let paused = false;       // 一時停止中
  let resumers = [];
  let doneCb = null;
  let units = { my: [], op: [] };
  let ball = null;
  let bpos = { x: W / 2, y: H / 2 };
  let revealed = [];
  let score = [0, 0];       // [自軍, 相手]
  let curMin = 0;

  class Cancel extends Error {}

  /* ---------- 待ち ---------- */

  function sleep(ms) {
    const my = runId;
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (my !== runId) { reject(new Cancel()); return; }
        // 一時停止中は、再開するまでここで止まる
        if (paused) resumers.push(() => (my === runId ? resolve() : reject(new Cancel())));
        else resolve();
      }, ms / speed);
    });
  }

  /* ---------- 描画 ---------- */

  function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k]));
    if (parent) parent.appendChild(n);
    return n;
  }

  function place(node, x, y, ms) {
    node.style.transition = 'transform ' + (ms / speed) + 'ms ease-in-out';
    node.style.transform = 'translate(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px)';
  }

  function drawPitch(svg) {
    svg.innerHTML = '';
    el('rect', { x: -3, y: -3, width: W + 6, height: H + 6, fill: '#3f8d55' }, svg);
    for (let i = 0; i < 10; i++) {
      if (i % 2 === 0) el('rect', { x: i * W / 10, y: 0, width: W / 10, height: H, fill: '#459a5c' }, svg);
    }
    const line = { fill: 'none', stroke: '#ffffff', 'stroke-width': 0.35, opacity: 0.9 };
    el('rect', Object.assign({ x: 0, y: 0, width: W, height: H }, line), svg);
    el('line', Object.assign({ x1: W / 2, y1: 0, x2: W / 2, y2: H }, line), svg);
    el('circle', Object.assign({ cx: W / 2, cy: H / 2, r: 9.15 }, line), svg);
    el('circle', { cx: W / 2, cy: H / 2, r: 0.5, fill: '#fff' }, svg);
    [0, 1].forEach((s) => {
      const x = s ? W - 16.5 : 0;
      el('rect', Object.assign({ x, y: H / 2 - 20.16, width: 16.5, height: 40.32 }, line), svg);
      const gx = s ? W - 5.5 : 0;
      el('rect', Object.assign({ x: gx, y: H / 2 - 9.16, width: 5.5, height: 18.32 }, line), svg);
      el('circle', { cx: s ? W - 11 : 11, cy: H / 2, r: 0.4, fill: '#fff' }, svg);
      // ゴール（ネット）
      el('rect', { x: s ? W : -2.4, y: H / 2 - 3.66, width: 2.4, height: 7.32, fill: 'rgba(255,255,255,.28)', stroke: '#fff', 'stroke-width': 0.3 }, svg);
    });
  }

  function makeUnits(svg) {
    const sides = [['my', res.myLineup], ['op', res.oppLineup]];
    units = { my: [], op: [] };
    sides.forEach(([side, lineup]) => {
      const cnt = { GK: 0, DF: 0, MF: 0, FW: 0 };
      lineup.forEach((p) => {
        const slot = BASE[p.pos][cnt[p.pos]++];
        const bx = side === 'my' ? slot[0] : W - slot[0];
        const g = el('g', { class: 'sp sp--' + side + (p.pos === 'GK' ? ' sp--gk' : '') }, svg);
        const fill = p.pos === 'GK' ? COLOR[side + 'GK'] : COLOR[side];
        el('circle', { r: 1.75, fill, stroke: '#fff', 'stroke-width': 0.3 }, g);
        const t = el('text', { class: 'sp__num', 'text-anchor': 'middle', y: 0.62, 'font-size': 1.9 }, g);
        t.textContent = p.num;
        const u = { pid: p.pid, name: p.name, num: p.num, pos: p.pos, side, g, base: [bx, slot[1]] };
        units[side].push(u);
        place(g, bx, slot[1], 0);
      });
    });
    ball = el('g', { class: 'sball' }, svg);
    el('circle', { r: 1.05, fill: '#fff', stroke: '#1d2024', 'stroke-width': 0.3 }, ball);
    el('circle', { r: 0.42, fill: '#1d2024' }, ball);
    placeBall(W / 2, H / 2, 0);
  }

  function placeBall(x, y, ms) {
    bpos = { x, y };
    place(ball, x, y, ms);
  }

  const SHIFT = { GK: 0.1, DF: 0.38, MF: 0.52, FW: 0.46 };

  /** ボールの位置に合わせて、全員の位置を決める（攻める側は前へ、守る側は下がる） */
  function shape(bx, by, attackSide, ms, override) {
    ['my', 'op'].forEach((side) => {
      const dir = side === 'my' ? 1 : -1;
      units[side].forEach((u) => {
        if (override && override[u.pid]) { place(u.g, override[u.pid][0], override[u.pid][1], ms); return; }
        const k = SHIFT[u.pos];
        let x = u.base[0] + (bx - W / 2) * k;
        const y = u.base[1] + (by - H / 2) * 0.22;
        if (attackSide === side && u.pos !== 'GK' && u.pos !== 'DF') x += dir * 4;
        if (attackSide && attackSide !== side && u.pos !== 'GK') x -= dir * 2;
        x = Math.max(2, Math.min(W - 2, x));
        place(u.g, x, Math.max(2, Math.min(H - 2, y)), ms);
      });
    });
  }

  function unitOf(pid) {
    return units.my.concat(units.op).find((u) => u.pid === pid);
  }

  /* ---------- 時計・表示 ---------- */

  function clockText(min) {
    const half = res.half, total = res.total;
    if (min <= 0) return '試合前';
    if (min <= half) return '前半 ' + min + '分';
    if (min <= total) return '後半 ' + min + '分';
    if (min <= total + 10) return '延長前半 ' + (min - total) + '分';
    return '延長後半 ' + (min - total - 10) + '分';
  }

  function renderClock(text) {
    const c = UI.el('soccer-clock');
    c.textContent = text != null ? text : clockText(curMin);
  }

  function renderScore() {
    const box = UI.el('soccer-game-score');
    box.classList.remove('is-win', 'is-lose');
    box.innerHTML = '<b>' + UI.esc(myName) + '</b> ' + score[0] + ' − ' + score[1] + ' <b>' + UI.esc(oppName) + '</b>';
  }

  function eventLine(e) {
    const mine = e.side === (res.home ? 'home' : 'away');
    const who = mine ? myName : oppName;
    const cls = 'soccer-log__item' + (e.kind === 'goal' ? ' soccer-log__item--goal' : '') + (mine ? ' is-mine' : '');
    const text = e.kind === 'goal'
      ? 'ゴール！ ' + UI.esc(e.name) + '（' + UI.esc(who) + '）'
      : UI.esc(who) + '：' + UI.esc(e.text);
    return '<li class="' + cls + '"><span class="soccer-log__min">' + e.min + '分</span>' +
      '<span class="soccer-log__text">' + text + '</span></li>';
  }

  function renderLog() {
    const box = UI.el('soccer-game-log');
    box.innerHTML = '<ul class="soccer-log__list">' + revealed.map(eventLine).join('') + '</ul>';
    box.scrollTop = box.scrollHeight;
  }

  async function banner(text, sub, ms, cls) {
    const fx = UI.el('soccer-fx');
    fx.className = 'goalfx is-on' + (cls ? ' ' + cls : '');
    fx.innerHTML = '<b>' + UI.esc(text) + '</b>' + (sub ? '<span>' + UI.esc(sub) + '</span>' : '');
    fx.hidden = false;
    await sleep(ms);
    fx.hidden = true;
    fx.className = 'goalfx';
  }

  /* ---------- 場面 ---------- */

  const rand = (a, b) => a + Math.random() * (b - a);

  /** 何も起きていないあいだの、ボール回し */
  function idle() {
    const side = Math.random() < 0.5 ? 'my' : 'op';
    const list = units[side].filter((u) => u.pos !== 'GK');
    const u = list[Math.floor(Math.random() * list.length)];
    const pos = parsePos(u);
    placeBall(pos[0], pos[1], 380);
  }

  function parsePos(u) {
    const m = /translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(u.g.style.transform || '');
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : u.base;
  }

  async function playEvent(e) {
    const mineSide = e.side === (res.home ? 'home' : 'away');
    const att = mineSide ? 'my' : 'op';
    const def = mineSide ? 'op' : 'my';
    const dir = mineSide ? 1 : -1;
    const goalX = mineSide ? W : 0;
    const build = e.build || [e.pid];
    const n = build.length;
    const startX = goalX - dir * 55;
    const finalX = goalX - dir * rand(13, 22);
    const dests = build.map((pid, i) => {
      const t = n > 1 ? i / (n - 1) : 1;
      const x = startX + (finalX - startX) * t;
      const y = i === n - 1 ? H / 2 + rand(-12, 12) : H / 2 + rand(-22, 22);
      return [x, y];
    });
    // パスをつなぐ
    for (let i = 0; i < n; i++) {
      const u = unitOf(build[i]);
      const [x, y] = dests[i];
      shape(x, y, att, 520, { [u.pid]: [x, y] });
      placeBall(x, y, 520);
      await sleep(i === n - 1 ? 560 : 520);
    }
    // シュート
    const gk = units[def].find((u) => u.pos === 'GK');
    const shooter = unitOf(e.pid);
    const sx = dests[n - 1][0], sy = dests[n - 1][1];
    let tx, ty, gkTo;
    const gy = H / 2;
    if (e.outcome === 'goal') {
      tx = goalX + dir * 1.6; ty = gy + rand(-3.2, 3.2);
      gkTo = [goalX - dir * 1.6, gy + (ty > gy ? -1 : 1) * rand(2.5, 4.5)];
    } else if (e.outcome === 'save') {
      ty = gy + rand(-3, 3); tx = goalX - dir * 1.4;
      gkTo = [tx, ty];
    } else if (e.outcome === 'wide') {
      tx = goalX + dir * 2.6; ty = gy + (Math.random() < 0.5 ? -1 : 1) * rand(6.5, 13);
      gkTo = [goalX - dir * 1.6, gy + (ty > gy ? 1 : -1) * 1.5];
    } else if (e.outcome === 'bar') {
      tx = goalX; ty = gy + (Math.random() < 0.5 ? -1 : 1) * 3.66;
      gkTo = [goalX - dir * 1.6, gy + (ty > gy ? 1 : -1) * 2];
    } else { // block
      tx = sx + dir * 5; ty = sy + rand(-2, 2);
      gkTo = [goalX - dir * 1.6, gy];
    }
    const over = { [shooter.pid]: [sx, sy], [gk.pid]: gkTo };
    if (e.outcome === 'block') {
      const d = units[def].filter((u) => u.pos === 'DF')[0];
      over[d.pid] = [tx, ty];
    }
    shape(sx, sy, att, 360, over);
    placeBall(tx, ty, 380);
    await sleep(520);
    if (e.outcome === 'goal') {
      score = e.score && mineSide ? [e.score[res.home ? 0 : 1], e.score[res.home ? 1 : 0]] : [e.score[res.home ? 0 : 1], e.score[res.home ? 1 : 0]];
      renderScore();
      // 喜ぶ：味方が得点者のまわりに集まる
      const spot = parsePos(shooter);
      const cel = {};
      units[att].forEach((u) => {
        if (u.pos === 'GK') return;
        cel[u.pid] = [Math.max(3, Math.min(W - 3, spot[0] + (Math.random() - 0.5) * 9)), Math.max(3, Math.min(H - 3, spot[1] + (Math.random() - 0.5) * 9))];
      });
      cel[shooter.pid] = [spot[0], spot[1]];
      shape(spot[0], spot[1], att, 700, cel);
      const sc = UI.el('soccer-stage');
      sc.classList.add(mineSide ? 'is-goal-my' : 'is-goal-op');
      await banner(mineSide ? 'GOAL!' : '失点…', '#' + shooter.num + ' ' + e.name, 1900, mineSide ? 'goalfx--my' : 'goalfx--op');
      sc.classList.remove('is-goal-my', 'is-goal-op');
      // センターから再開
      shape(W / 2, H / 2, null, 600);
      placeBall(W / 2, H / 2, 600);
      await sleep(650);
    } else {
      if (e.outcome === 'save') {
        placeBall(goalX - dir * rand(6, 9), gy + rand(-8, 8), 380);
      } else if (e.outcome === 'bar') {
        placeBall(goalX - dir * rand(3, 5), ty + (ty > gy ? 5 : -5), 380);
      } else if (e.outcome === 'block') {
        placeBall(tx - dir * 2, ty + rand(-5, 5), 320);
      } else {
        placeBall(goalX + dir * 6, ty + (ty > gy ? 5 : -5), 380);
      }
      await sleep(520);
      shape(W / 2, H / 2, null, 700);
      placeBall(W / 2 + dir * -6, H / 2 + rand(-6, 6), 700);
      await sleep(520);
    }
  }

  /** 時計を進める。途中でハーフタイムなどがあれば挟む */
  async function advanceClock(from, to) {
    for (let m = from + 1; m <= to; m++) {
      curMin = m;
      renderClock();
      if (m % 7 === 0) idle();
      await sleep(78);
      if (m === res.half) {
        renderClock('前半終了');
        shape(W / 2, H / 2, null, 600);
        placeBall(W / 2, H / 2, 600);
        await banner('ハーフタイム', myName + ' ' + score[0] + ' − ' + score[1] + ' ' + oppName, 1500);
        renderClock('後半開始');
        await sleep(450);
      } else if (m === res.total && res.extra) {
        renderClock('90分終了');
        await banner('同点のため延長戦', '10分ハーフ', 1600);
      } else if (res.extra && m === res.total + 10) {
        renderClock('延長前半終了');
        await sleep(500);
      }
    }
  }

  /** PK戦。蹴る選手とGKだけを見せ、結果を並べていく */
  async function playPK() {
    const pk = res.pk;
    const myKey = res.home ? 'home' : 'away';
    await banner('PK戦', '5人ずつ。決まらなければ1人ずつ', 1700);
    const marks = { my: [], op: [] };
    const showMarks = () => {
      UI.el('soccer-clock').innerHTML = 'PK戦　' +
        '<span class="pkm">' + UI.esc(myName) + ' ' + marks.my.map((m) => m ? '○' : '×').join('') + '</span>　' +
        '<span class="pkm">' + UI.esc(oppName) + ' ' + marks.op.map((m) => m ? '○' : '×').join('') + '</span>';
    };
    showMarks();
    for (const k of pk.kicks) {
      const kickerSide = k.side === myKey ? 'my' : 'op';
      const keeperSide = kickerSide === 'my' ? 'op' : 'my';
      const dir = kickerSide === 'my' ? 1 : -1;
      const goalX = kickerSide === 'my' ? W : 0;
      const kicker = unitOf(k.pid) || units[kickerSide].find((u) => u.pos === 'FW');
      const keeper = units[keeperSide].find((u) => u.pos === 'GK');
      const spotX = goalX - dir * 11;
      // 他の選手はセンターサークルへ。蹴る選手はPKのスポットへ
      const over = {};
      units.my.concat(units.op).forEach((u, i) => { over[u.pid] = [W / 2 + (u.side === 'my' ? -4 : 4), 20 + (i % 11) * 2.8]; });
      over[kicker.pid] = [spotX - dir * 2.2, H / 2];
      over[keeper.pid] = [goalX - dir * 1.4, H / 2];
      shape(W / 2, H / 2, null, 500, over);
      placeBall(spotX, H / 2, 500);
      await sleep(700);
      const dive = Math.random() < 0.5 ? -1 : 1;
      const wide = !k.scored && Math.random() < 0.4;
      const ty = k.scored ? H / 2 + (-dive) * rand(2, 3.2) : (wide ? H / 2 + dive * rand(5, 8) : H / 2 + dive * rand(1, 2.6));
      placeBall(goalX + (wide ? dir * 2 : -dir * 0.4), ty, 360);
      over[keeper.pid] = [goalX - dir * 1.4, H / 2 + dive * (k.scored ? 3.6 : 2.4)];
      place(keeper.g, over[keeper.pid][0], over[keeper.pid][1], 360);
      await sleep(520);
      marks[kickerSide].push(k.scored);
      showMarks();
      const pkScore = k.score ? [k.score[res.home ? 0 : 1], k.score[res.home ? 1 : 0]] : null;
      if (pkScore) score = score; // 試合のスコアは変えない
      await banner(k.scored ? 'ゴール' : (wide ? '枠の外' : 'セーブ'), '#' + kicker.num + ' ' + k.name, 900, k.scored ? 'goalfx--my goalfx--small' : 'goalfx--op goalfx--small');
    }
    shape(W / 2, H / 2, null, 500);
  }

  async function matchFlow(my) {
    renderClock('試合前');
    await sleep(500);
    await banner('キックオフ', myName + ' 対 ' + oppName, 1300);
    shape(W / 2, H / 2, null, 0);
    for (const e of res.events) {
      await advanceClockTo(e.min);
      revealed.push(e); renderLog();
      await playEvent(e);
    }
    await advanceClockTo(res.total + (res.extra ? 20 : 0));
    if (res.pk) await playPK();
    const win = res.win;
    renderClock(res.pk ? 'PK戦終了' : '試合終了');
    const box = UI.el('soccer-game-score');
    box.classList.add(win ? 'is-win' : 'is-lose');
    await banner('試合終了', myName + ' ' + res.my + ' − ' + res.op + ' ' + oppName + (res.pk ? '（PK ' + (res.home ? res.pk.home : res.pk.away) + '−' + (res.home ? res.pk.away : res.pk.home) + '）' : ''), 1700);
    finish();
  }

  let clockAt = 0;
  async function advanceClockTo(m) {
    if (m > clockAt) { await advanceClock(clockAt, m); clockAt = m; }
  }

  function finish() {
    if (doneCb) { const cb = doneCb; doneCb = null; cb(); }
  }

  /* ---------- 操作 ---------- */

  function setPaused(on) {
    paused = on;
    const btn = UI.el('soccer-pause');
    if (btn) { btn.textContent = on ? '再開' : '一時停止'; btn.classList.toggle('is-paused', on); }
    if (!on) { const rs = resumers; resumers = []; rs.forEach((f) => f()); }
  }

  function setSpeed(sp) {
    if (sp === 'pause') { setPaused(!paused); return; }
    document.querySelectorAll('#soccer-game-speed .speedbtn[data-sp]:not(#soccer-pause)').forEach((b) => b.classList.remove('is-on'));
    const btn = document.querySelector('#soccer-game-speed .speedbtn[data-sp="' + sp + '"]');
    if (btn) btn.classList.add('is-on');
    speed = Number(sp);
  }

  /** 試合開始。result は Soccer.playUser() が返したもの、
      onDone は全部見せ終わったあとに呼ぶコールバック */
  function start(state, result, onDone) {
    runId++;
    res = result;
    myName = state.soccer.schoolName;
    oppName = result.oppName || '相手校';
    revealed = []; score = [0, 0]; curMin = 0; clockAt = 0;
    speed = 1; resumers = []; doneCb = onDone;
    setPaused(false);
    document.querySelectorAll('#soccer-game-speed .speedbtn[data-sp]:not(#soccer-pause)').forEach((b) =>
      b.classList.toggle('is-on', b.dataset.sp === '1'));
    const svg = UI.el('soccer-pitch');
    drawPitch(svg);
    makeUnits(svg);
    UI.el('soccer-fx').hidden = true;
    renderScore();
    renderLog();
    UI.show('screen-soccer-game');
    const my = runId;
    matchFlow(my).catch((err) => { if (!(err instanceof Cancel)) throw err; });
  }

  function init() {
    document.querySelectorAll('#soccer-game-speed .speedbtn').forEach((b) => {
      b.addEventListener('click', () => setSpeed(b.dataset.sp));
    });
  }

  return { start, init };
})();
