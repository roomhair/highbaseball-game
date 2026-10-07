/* ==================================================
   高校野球  soccer-game.js

   サッカー部の試合中画面。Soccer.playUser() はその場で試合全体の
   結果（events 配列、minごとの出来事）をまとめて返すが、それを
   いきなり結果画面で見せると試合がサクッと終わりすぎてしまうため、
   野球の試合画面（game-screen.js）と同じように、起きた出来事を
   時間をかけて1つずつ見せる「試合中」の演出をここで作る。
   ・試合そのものの計算（勝敗・得点）はここでは一切しない。
     Soccer.playUser() がすでに決めた結果を、順番に見せるだけ。
   ================================================== */
'use strict';

const SoccerGameScreen = (() => {
  let res = null;
  let myName = '', oppName = '';
  let idx = 0;
  let revealed = [];
  let speed = 1;          // 0=1つずつ（手動）, 1=オート, 3=オート（速い）
  let timer = null;
  let doneCb = null;

  function mySideKey() { return res.home ? 'home' : 'away'; }

  function scoreAt() {
    if (!revealed.length) return { my: 0, op: 0 };
    const sc = revealed[revealed.length - 1].score;
    return res.home ? { my: sc[0], op: sc[1] } : { my: sc[1], op: sc[0] };
  }

  function renderScore() {
    const { my, op } = scoreAt();
    const minLabel = revealed.length ? revealed[revealed.length - 1].min + '分' : '開始前';
    const box = UI.el('soccer-game-score');
    box.classList.remove('is-win', 'is-lose');
    if (idx >= res.events.length) box.classList.add(res.win ? 'is-win' : 'is-lose');
    box.innerHTML =
      '<b>' + UI.esc(myName) + '</b> ' + my + ' − ' + op + ' <b>' + UI.esc(oppName) + '</b>' +
      '<i>' + minLabel + '</i>';
  }

  function eventLine(e) {
    const mine = e.side === mySideKey();
    const who = mine ? myName : oppName;
    const cls = 'soccer-log__item' + (e.kind === 'goal' ? ' soccer-log__item--goal' : '') + (mine ? ' is-mine' : '');
    const text = e.kind === 'goal'
      ? 'ゴール！ ' + UI.esc(e.name) + '（' + UI.esc(who) + '）'
      : UI.esc(who) + '：' + UI.esc(e.text);
    return '<li class="' + cls + '"><span class="soccer-log__min">' + e.min + '分</span>' +
      '<span class="soccer-log__text">' + text + '</span></li>';
  }

  function renderLog() {
    const el = UI.el('soccer-game-log');
    el.innerHTML = '<ul class="soccer-log__list">' + revealed.map(eventLine).join('') + '</ul>';
    el.scrollTop = el.scrollHeight;
  }

  function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }

  function finish() {
    clearTimer();
    const hint = UI.el('soccer-game-taphint');
    if (hint) hint.hidden = true;
    if (doneCb) { const cb = doneCb; doneCb = null; cb(); }
  }

  function scheduleNext() {
    clearTimer();
    const hint = UI.el('soccer-game-taphint');
    if (speed === 0) { if (hint) hint.hidden = false; return; }
    if (hint) hint.hidden = true;
    timer = setTimeout(revealNext, speed === 3 ? 120 : 550);
  }

  function revealNext() {
    clearTimer();
    if (idx >= res.events.length) { finish(); return; }
    revealed.push(res.events[idx]);
    idx++;
    renderScore();
    renderLog();
    if (idx >= res.events.length) {
      const hint = UI.el('soccer-game-taphint');
      if (hint) hint.hidden = true;
      timer = setTimeout(finish, 600);
    } else {
      scheduleNext();
    }
  }

  /** 次のゴール（無ければ試合終了）まで、まとめて見せる */
  function skipToGoal() {
    clearTimer();
    while (idx < res.events.length) {
      const e = res.events[idx];
      revealed.push(e);
      idx++;
      if (e.kind === 'goal') break;
    }
    renderScore();
    renderLog();
    if (idx >= res.events.length) { timer = setTimeout(finish, 600); return; }
    scheduleNext();
  }

  function setSpeed(sp) {
    document.querySelectorAll('#soccer-game-speed .speedbtn').forEach((b) => b.classList.remove('is-on'));
    const btn = document.querySelector('#soccer-game-speed .speedbtn[data-sp="' + sp + '"]');
    if (btn) btn.classList.add('is-on');
    if (sp === 'goal') { skipToGoal(); return; }
    speed = Number(sp);
    scheduleNext();
  }

  /** 手動（1つずつ）のときだけ、タップで次の場面へ進める */
  function tap() {
    if (speed !== 0 || idx >= res.events.length) return;
    revealNext();
  }

  /** 試合開始。result は Soccer.playUser() が返したもの、
      onDone は全出来事を見せ終わったあとに呼ぶコールバック */
  function start(state, result, onDone) {
    res = result;
    myName = state.soccer.schoolName;
    oppName = result.oppName || '相手校';
    idx = 0; revealed = []; speed = 1; doneCb = onDone;
    document.querySelectorAll('#soccer-game-speed .speedbtn').forEach((b) =>
      b.classList.toggle('is-on', b.dataset.sp === '1'));
    renderScore();
    renderLog();
    UI.show('screen-soccer-game');
    scheduleNext();
  }

  function init() {
    document.querySelectorAll('#soccer-game-speed .speedbtn').forEach((b) => {
      b.addEventListener('click', () => setSpeed(b.dataset.sp));
    });
    const log = UI.el('soccer-game-log');
    if (log) log.addEventListener('click', tap);
    const score = UI.el('soccer-game-score');
    if (score) score.addEventListener('click', tap);
  }

  return { start, init };
})();
