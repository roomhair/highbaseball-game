/* ==================================================
   高校野球  ui.js

   画面の出し入れと、どの画面からも使う部品。
   ・選手の詳細（能力・高校通算成績・名場面）とオーダー編集は
     どこからでも開けるよう、ここにまとめてある。
   ・選手名はここから変えられる。ユーザーが自分の部員に
     好きな名前を付けられたほうが、引退のときに効く。
   ================================================== */
'use strict';

const UI = (() => {

  const el = (id) => document.getElementById(id);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function html(id, s) { const n = el(id); if (n) n.innerHTML = s; return n; }

  /* ---------- 画面の切り替え ---------- */

  let current = 'screen-top';

  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('is-active'));
    const n = el(id);
    if (n) n.classList.add('is-active');
    current = id;
    window.scrollTo(0, 0);
  }

  function currentScreen() { return current; }

  /* ---------- 幕（開幕前の軽いアニメーション） ---------- */

  function curtain(lines, done) {
    const c = el('curtain');
    const t = el('curtain-text');
    if (!c || !t) { done(); return; }
    t.innerHTML = lines;
    c.hidden = false;
    c.classList.remove('is-out');
    /* 次のフレームで class を付けて、CSS のアニメーションを走らせる */
    requestAnimationFrame(() => c.classList.add('is-in'));
    setTimeout(() => {
      c.classList.add('is-out');
      setTimeout(() => {
        c.hidden = true;
        c.classList.remove('is-in', 'is-out');
        done();
      }, 420);
    }, 1150);
  }

  /* ---------- ふきだし（モーダル） ---------- */

  function modal(content, opts) {
    const m = el('modal');
    html('modal-body', content);
    m.hidden = false;
    m.dataset.kind = (opts && opts.kind) || '';
    document.body.classList.add('is-modal');
    if (opts && opts.onOpen) opts.onOpen(el('modal-body'));
  }

  function closeModal() {
    const m = el('modal');
    m.hidden = true;
    document.body.classList.remove('is-modal');
    if (closeModal.after) { const f = closeModal.after; closeModal.after = null; f(); }
  }

  /* ---------- 数字の書式 ---------- */

  function avg(h, ab) {
    if (!ab) return '.---';
    const v = h / ab;
    return (v >= 1 ? '1' : '') + v.toFixed(3).replace(/^0/, '');
  }

  function era(er, outs) {
    if (!outs) return '-.--';
    return (er * 27 / outs).toFixed(2);
  }

  function ipText(outs) {
    const w = Math.floor(outs / 3), r = outs % 3;
    return w + (r ? ' ' + r + '/3' : '');
  }

  /* ---------- 選手の部品 ---------- */

  /** 能力ひとつ（S〜G と数字） */
  function stat(label, value, unit) {
    const r = rankOf(value);
    return '<div class="stat"><span class="stat__label">' + esc(label) + '</span>' +
      '<span class="stat__rank rank-' + r + '">' + r + '</span>' +
      '<span class="stat__num">' + value + (unit ? esc(unit) : '') + '</span></div>';
  }

  function rankSpan(value) {
    const r = rankOf(value);
    return '<span class="rank rank-' + r + '">' + r + '</span>';
  }

  function aptSpan(letter) {
    return '<span class="rank rank-' + letter + '">' + letter + '</span>';
  }

  function pullText(v) {
    if (v >= 55) return '強い引っ張り';
    if (v >= 20) return '引っ張り';
    if (v > -20) return 'センター返し';
    if (v > -55) return '広角';
    return '流し打ち';
  }

  function handMark(p) {
    return (p.throws === 'L' ? '左' : '右') + '投' + (p.bats === 'L' ? '左' : '右') + '打';
  }

  /** 一覧用の1行 */
  function playerRow(p, opts) {
    opts = opts || {};
    const isPit = p.kind === 'pitcher';
    const cells = isPit
      ? ['<td class="c">' + p.velo + '</td>',
         '<td class="c">' + rankSpan(p.control) + '</td>',
         '<td class="c">' + rankSpan(p.stamina) + '</td>',
         '<td class="t-break">' + p.pitches.map((q) => esc(q.name) + '<i>' + q.level + '</i>').join('・') + '</td>'].join('')
      : ['<td class="c">' + p.traj + '</td>',
         '<td class="c">' + rankSpan(p.meet) + '</td>',
         '<td class="c">' + rankSpan(p.power) + '</td>',
         '<td class="c">' + rankSpan(p.speed) + '</td>',
         '<td class="c">' + rankSpan(p.arm) + '</td>',
         '<td class="c">' + rankSpan(p.field) + '</td>',
         '<td class="c">' + rankSpan(p.catch) + '</td>'].join('');
    return '<tr data-pid="' + p.id + '" class="prow' + (opts.mark ? ' is-' + opts.mark : '') + '">' +
      '<td class="c g' + p.grade + '">' + p.grade + '</td>' +
      '<td class="nm">' + esc(p.name) + (p.awakened ? '<em class="awake-dot" title="覚醒">◆</em>' : '') + '</td>' +
      '<td class="c">' + (isPit ? '投' : posShort(p.pos)) + '</td>' +
      '<td class="c hand">' + handMark(p) + '</td>' +
      cells + '</tr>';
  }

  function rosterTable(players, opts) {
    opts = opts || {};
    const isPit = (players[0] || {}).kind === 'pitcher';
    const head = isPit
      ? '<th>球速</th><th>制球</th><th>スタ</th><th class="t-break">変化球</th>'
      : '<th>弾道</th><th>ミート</th><th>パワー</th><th>走力</th><th>肩力</th><th>守備</th><th>捕球</th>';
    return '<div class="tablewrap"><table class="roster">' +
      '<thead><tr><th>年</th><th class="nm">選手</th><th>位置</th><th class="hand">利き</th>' + head + '</tr></thead>' +
      '<tbody>' + players.map((p) => playerRow(p, opts)).join('') + '</tbody></table></div>';
  }

  /* ---------- 選手の詳細 ---------- */

  function careerBatLine(s) {
    return '<table class="statline"><thead><tr><th>試合</th><th>打数</th><th>安打</th><th>本塁打</th><th>打点</th><th>盗塁</th><th>四球</th><th>三振</th><th>打率</th></tr></thead>' +
      '<tbody><tr><td>' + s.g + '</td><td>' + s.ab + '</td><td>' + s.h + '</td><td>' + s.hr + '</td><td>' + s.rbi +
      '</td><td>' + s.sb + '</td><td>' + s.bb + '</td><td>' + s.so + '</td><td class="hl">' + avg(s.h, s.ab) + '</td></tr></tbody></table>';
  }

  function careerPitLine(s) {
    return '<table class="statline"><thead><tr><th>試合</th><th>勝</th><th>敗</th><th>投球回</th><th>被安打</th><th>奪三振</th><th>四球</th><th>自責</th><th>防御率</th></tr></thead>' +
      '<tbody><tr><td>' + s.g + '</td><td>' + s.w + '</td><td>' + s.l + '</td><td>' + ipText(s.outs) + '</td><td>' + s.h +
      '</td><td>' + s.so + '</td><td>' + s.bb + '</td><td>' + s.er + '</td><td class="hl">' + era(s.er, s.outs) + '</td></tr></tbody></table>';
  }

  function playerDetail(p, opts) {
    opts = opts || {};
    const isPit = p.kind === 'pitcher';

    let abilities = '<div class="stats">';
    if (isPit) {
      abilities += '<div class="stat"><span class="stat__label">最速</span><span class="stat__num stat__num--wide">' + p.velo + ' km/h</span></div>';
      abilities += stat('制球', p.control) + stat('スタミナ', p.stamina);
      abilities += '</div><h4 class="sub">変化球</h4><ul class="pitchlist">' +
        p.pitches.map((q) => '<li><span>' + esc(q.name) + '</span><b>' + q.level + '</b>' +
          '<i class="bar"><i style="width:' + (q.level / 7 * 100) + '%"></i></i></li>').join('') + '</ul>';
    } else {
      abilities += stat('ミート', p.meet) + stat('パワー', p.power) + stat('走力', p.speed) +
        stat('肩力', p.arm) + stat('守備', p.field) + stat('捕球', p.catch);
      abilities += '</div>';
      abilities += '<div class="minor"><span>弾道 <b>' + p.traj + '</b>（' + TRAJ_LABEL[p.traj] + '）</span>' +
        '<span>打球方向 <b>' + pullText(p.pull) + '</b>（' + (p.pull > 0 ? '+' : '') + p.pull + '）</span></div>';
      abilities += '<h4 class="sub">守備適性</h4><div class="aptrow">' +
        FIELD_POSITIONS.map((k) => '<span class="apt"><i>' + posShort(k) + '</i>' + aptSpan(p.apt[k]) + '</span>').join('') +
        '</div>';
    }

    const top = (p.hl || []).slice().sort((a, b) => b.score - a.score).slice(0, 3);
    const hl = top.length
      ? '<h4 class="sub">活躍シーン</h4><ol class="hllist">' + top.map((h) =>
          '<li><span class="hl__where">' + esc(h.where) + '</span><span class="hl__line">' + esc(h.line) + '</span></li>').join('') + '</ol>'
      : '';

    return '<div class="pdetail">' +
      '<div class="pdetail__head">' +
        '<div class="pdetail__name" id="pd-name">' + esc(p.name) + '</div>' +
        (opts.rename === false ? '' : '<button type="button" class="linkbtn" id="pd-rename">名前を変える</button>') +
        '<div class="pdetail__meta">' + p.grade + '年　' + (isPit ? '投手' : posName(p.pos)) + '　' + handMark(p) +
        (p.awakened ? '　<b class="awake">覚醒</b>' : '') + '</div>' +
      '</div>' +
      abilities +
      '<h4 class="sub">高校通算成績<span class="sub__note">練習試合を含む</span></h4>' +
      (isPit ? careerPitLine(p.career) : careerBatLine(p.career)) +
      (isPit && p.batCareer && p.batCareer.ab ? '<h4 class="sub">打撃（通算）</h4>' + careerBatLine(p.batCareer) : '') +
      hl +
      '</div>';
  }

  /** 選手の詳細をふきだしで開く。名前の書き換えもここで受ける */
  function openPlayer(p, opts) {
    opts = opts || {};
    modal(playerDetail(p, opts), {
      kind: 'player',
      onOpen(body) {
        const btn = body.querySelector('#pd-rename');
        if (!btn) return;
        btn.addEventListener('click', () => {
          const holder = body.querySelector('#pd-name');
          holder.innerHTML = '<input type="text" class="field__input field__input--inline" id="pd-input" maxlength="12" value="' + esc(p.name) + '">' +
            '<button type="button" class="btn btn--small" id="pd-save">決定</button>';
          const input = body.querySelector('#pd-input');
          input.focus(); input.select();
          const save = () => {
            const v = input.value.trim();
            if (v) { p.name = v.slice(0, 12); }
            holder.textContent = p.name;
            btn.hidden = false;
            if (opts.onRename) opts.onRename(p);
          };
          body.querySelector('#pd-save').addEventListener('click', save);
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
          btn.hidden = true;
        });
      },
    });
  }

  /* ---------- オーダー編集 ---------- */

  function lineupEditor(team, onDone) {
    let selected = null;

    function render() {
      const rows = team.lineup.map((slot, i) => {
        const p = Team.find(team, slot.pid);
        if (!p) return '';
        const options = DATASET_POSITIONS.map((k) =>
          '<option value="' + k + '"' + (k === slot.pos ? ' selected' : '') + '>' + posShort(k) + '</option>').join('');
        return '<tr data-i="' + i + '">' +
          '<td class="c ord">' + (i + 1) + '</td>' +
          '<td class="c"><select class="possel" data-i="' + i + '">' + options + '</select></td>' +
          '<td class="nm"><button type="button" class="linkbtn pname" data-pid="' + p.id + '">' + esc(p.name) + '</button>' +
            '<span class="tiny">' + p.grade + '年 ' + handMark(p) + ' ' +
            (slot.pos === 'DH' ? '' : '適性' + p.apt[slot.pos]) + '</span></td>' +
          '<td class="c tiny">' + rankSpan(p.meet) + rankSpan(p.power) + rankSpan(p.speed) + '</td>' +
          '<td class="c"><button type="button" class="btn btn--tiny up" data-i="' + i + '">▲</button>' +
            '<button type="button" class="btn btn--tiny down" data-i="' + i + '">▼</button></td>' +
          '<td class="c"><button type="button" class="btn btn--tiny swap" data-i="' + i + '">交代</button></td>' +
          '</tr>';
      }).join('');

      const benchList = Team.bench(team);
      const benchHtml = benchList.length
        ? '<h4 class="sub">控え</h4>' + UI.rosterTable(benchList)
        : '';

      const pitchers = team.rotation.map((id, i) => {
        const p = Team.find(team, id);
        if (!p) return '';
        return '<tr data-pi="' + i + '"><td class="c ord">' + (i + 1) + '</td>' +
          '<td class="nm"><button type="button" class="linkbtn pname" data-pid="' + p.id + '">' + esc(p.name) + '</button>' +
          '<span class="tiny">' + p.grade + '年 ' + p.velo + 'km/h ' + handMark(p) + '</span></td>' +
          '<td class="c tiny">' + rankSpan(p.control) + rankSpan(p.stamina) + '</td>' +
          '<td class="c"><button type="button" class="btn btn--tiny pup" data-pi="' + i + '">▲</button>' +
          '<button type="button" class="btn btn--tiny pdown" data-pi="' + i + '">▼</button></td></tr>';
      }).join('');

      return '<div class="lineup-edit">' +
        '<h3 class="modal__title">オーダー編集</h3>' +
        '<div class="tablewrap"><table class="lineup"><thead><tr><th>打順</th><th>守備</th><th class="nm">選手</th><th>ミ/パ/走</th><th>順</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<h4 class="sub">投手の起用順<span class="sub__note">上から先発</span></h4>' +
        '<div class="tablewrap"><table class="lineup"><tbody>' + pitchers + '</tbody></table></div>' +
        benchHtml +
        '<div class="actions actions--modal">' +
        '<button type="button" class="btn" id="lu-auto">おまかせ</button>' +
        '<button type="button" class="btn btn--primary" id="lu-done">決定</button>' +
        '</div></div>';
    }

    function open() {
      modal(render(), {
        kind: 'lineup',
        onOpen(body) { wire(body); },
      });
    }

    function refresh() {
      html('modal-body', render());
      wire(el('modal-body'));
    }

    function wire(body) {
      body.querySelectorAll('.up').forEach((b) => b.addEventListener('click', () => {
        const i = +b.dataset.i; if (i <= 0) return;
        [team.lineup[i - 1], team.lineup[i]] = [team.lineup[i], team.lineup[i - 1]];
        refresh();
      }));
      body.querySelectorAll('.down').forEach((b) => b.addEventListener('click', () => {
        const i = +b.dataset.i; if (i >= team.lineup.length - 1) return;
        [team.lineup[i + 1], team.lineup[i]] = [team.lineup[i], team.lineup[i + 1]];
        refresh();
      }));
      body.querySelectorAll('.pup').forEach((b) => b.addEventListener('click', () => {
        const i = +b.dataset.pi; if (i <= 0) return;
        [team.rotation[i - 1], team.rotation[i]] = [team.rotation[i], team.rotation[i - 1]];
        refresh();
      }));
      body.querySelectorAll('.pdown').forEach((b) => b.addEventListener('click', () => {
        const i = +b.dataset.pi; if (i >= team.rotation.length - 1) return;
        [team.rotation[i + 1], team.rotation[i]] = [team.rotation[i], team.rotation[i + 1]];
        refresh();
      }));
      body.querySelectorAll('.possel').forEach((sel) => sel.addEventListener('change', () => {
        const i = +sel.dataset.i;
        const next = sel.value;
        /* 同じ守備位置が2人にならないよう、持っていた選手と入れ替える */
        const other = team.lineup.findIndex((s, k) => k !== i && s.pos === next);
        if (other >= 0) team.lineup[other].pos = team.lineup[i].pos;
        team.lineup[i].pos = next;
        refresh();
      }));
      body.querySelectorAll('.swap').forEach((b) => b.addEventListener('click', () => {
        const i = +b.dataset.i;
        openSwap(i);
      }));
      body.querySelectorAll('.pname').forEach((b) => b.addEventListener('click', () => {
        const p = Team.find(team, b.dataset.pid);
        if (!p) return;
        openPlayer(p, { onRename: () => { /* 名前はそのまま反映される */ } });
        closeModal.after = () => refresh();
      }));
      const auto = body.querySelector('#lu-auto');
      if (auto) auto.addEventListener('click', () => { Team.autoLineup(team); refresh(); });
      const done = body.querySelector('#lu-done');
      if (done) done.addEventListener('click', () => { closeModal.after = null; closeModal(); if (onDone) onDone(); });
    }

    function openSwap(i) {
      const benchList = Team.bench(team);
      const cur = Team.find(team, team.lineup[i].pid);
      const body = '<h3 class="modal__title">' + (i + 1) + '番・' + esc(cur ? cur.name : '') + ' と交代</h3>' +
        (benchList.length
          ? '<div class="swaplist">' + benchList.map((p) =>
              '<button type="button" class="swapitem" data-pid="' + p.id + '">' +
              '<b>' + esc(p.name) + '</b><span>' + p.grade + '年 ' + posShort(p.pos) + ' ' + handMark(p) + '</span>' +
              '<span class="tiny">ミ' + rankOf(p.meet) + ' パ' + rankOf(p.power) + ' 走' + rankOf(p.speed) +
              ' 守' + rankOf(p.field) + '</span></button>').join('') + '</div>'
          : '<p class="note">控えがいません。</p>') +
        '<div class="actions actions--modal"><button type="button" class="btn" id="sw-back">戻る</button></div>';
      html('modal-body', body);
      const node = el('modal-body');
      node.querySelectorAll('.swapitem').forEach((b) => b.addEventListener('click', () => {
        team.lineup[i].pid = b.dataset.pid;
        refresh();
      }));
      node.querySelector('#sw-back').addEventListener('click', refresh);
    }

    open();
  }

  /* ---------- 共通の初期化 ---------- */

  function init() {
    document.querySelectorAll('[data-close]').forEach((n) =>
      n.addEventListener('click', () => closeModal()));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el('modal').hidden) closeModal();
    });
  }

  return {
    el, esc, html, show, currentScreen, curtain, modal, closeModal,
    avg, era, ipText, stat, rankSpan, aptSpan, pullText, handMark,
    playerRow, rosterTable, playerDetail, openPlayer, lineupEditor,
    careerBatLine, careerPitLine, init,
  };
})();
