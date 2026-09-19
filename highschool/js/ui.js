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

  /** 評価と素の数字を並べて出す（特訓の画面などで使う） */
  function rankNum(value) {
    const r = rankOf(value);
    return '<span class="rank rank-' + r + '">' + r + '</span><b class="rankval">' + value + '</b>';
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

  /** その選手がオーダーのどこにいるか。控えなら「控え」 */
  function roleText(team, p) {
    if (!team) return '';
    if (p.kind === 'pitcher') {
      const i = (team.rotation || []).indexOf(p.id);
      if (i === 0) return '先発';
      if (i > 0) return (i + 1) + '番手';
      return '投手';
    }
    const i = (team.lineup || []).findIndex((s) => s.pid === p.id);
    if (i < 0) return '控え';
    return (i + 1) + '番 ' + posShort(team.lineup[i].pos);
  }

  /** 一覧用の1行。能力は評価だけでなく素の数字も添える */
  function playerRow(p, opts) {
    opts = opts || {};
    const isPit = p.kind === 'pitcher';
    const cells = isPit
      ? ['<td class="c"><b class="rankval">' + p.velo + '</b></td>',
         '<td class="c">' + rankNum(p.control) + '</td>',
         '<td class="c">' + rankNum(p.stamina) + '</td>',
         '<td class="t-break">' + p.pitches.map((q) => esc(q.name) + '<i>' + q.level + '</i>').join('・') + '</td>'].join('')
      : ['<td class="c"><b class="rankval">' + p.traj + '</b></td>',
         '<td class="c">' + rankNum(p.meet) + '</td>',
         '<td class="c">' + rankNum(p.power) + '</td>',
         '<td class="c">' + rankNum(p.speed) + '</td>',
         '<td class="c">' + rankNum(p.arm) + '</td>',
         '<td class="c">' + rankNum(p.field) + '</td>',
         '<td class="c">' + rankNum(p.catch) + '</td>'].join('');
    /* 自分のチームを渡されたときは、打順・守備位置（控えなら「控え」）も出す */
    const role = opts.team ? '<td class="c role">' + roleText(opts.team, p) + '</td>' : '';
    return '<tr data-pid="' + p.id + '" class="prow' + (opts.mark ? ' is-' + opts.mark : '') + '">' +
      '<td class="c g' + p.grade + '">' + p.grade + '</td>' +
      '<td class="nm">' + esc(p.name) + (p.awakened ? '<em class="awake-dot" title="覚醒">◆</em>' : '') + '</td>' +
      role +
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
    const roleHead = opts.team ? '<th>いまの役割</th>' : '';
    return '<div class="tablewrap"><table class="roster">' +
      '<thead><tr><th>年</th><th class="nm">選手</th>' + roleHead +
      '<th>位置</th><th class="hand">利き</th>' + head + '</tr></thead>' +
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

  /* ---------- 並べ替え（指でもマウスでも） ----------
     行の左はしの取っ手をつまむと、その行が指について動く。
     動かしているあいだ、すれ違った行とその場で入れ替わる。
     つまめるのは取っ手だけ。行全体をつまめるようにすると
     画面のスクロールができなくなってしまう。 */

  function makeSortable(list, opt) {
    let drag = null;      // いま動かしている行
    let grabY = 0;        // 行の上はしから指までの距離
    let lastY = 0;        // いちばん新しい指の位置
    let raf = 0;

    /* 入れ替えや自動スクロールで行の位置が動いても、
       指の下から離れないように毎回置き直す */
    function place() {
      if (!drag) return;
      drag.style.transform = '';
      const nat = drag.getBoundingClientRect();
      drag.style.transform = 'translateY(' + ((lastY - grabY) - nat.top) + 'px)';
    }

    /* 見た目のまん中が隣の行のまん中を越えたら、その場で入れ替える */
    function reorder() {
      if (!drag) return;
      for (let guard = 0; guard < 24; guard++) {
        const r = drag.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        const next = drag.nextElementSibling;
        const prev = drag.previousElementSibling;
        if (next) {
          const nr = next.getBoundingClientRect();
          if (mid > nr.top + nr.height / 2) {
            list.insertBefore(next, drag);
            place();
            if (opt.onMove) opt.onMove(list);
            continue;
          }
        }
        if (prev) {
          const pr = prev.getBoundingClientRect();
          if (mid < pr.top + pr.height / 2) {
            list.insertBefore(drag, prev);
            place();
            if (opt.onMove) opt.onMove(list);
            continue;
          }
        }
        break;
      }
    }

    /** スクロールする入れ物（ふきだしの中身など）を探す */
    function scrollerOf(node) {
      for (let n = node.parentElement; n; n = n.parentElement) {
        const ov = getComputedStyle(n).overflowY;
        if ((ov === 'auto' || ov === 'scroll') && n.scrollHeight > n.clientHeight + 2) return n;
      }
      return null;
    }
    const scroller = scrollerOf(list);

    /* 上や下のはしまで持っていくと、ひとりでにスクロールする。
       これが無いと、控えの選手をいちばん上まで持ち上げられない */
    function tick() {
      if (!drag) { raf = 0; return; }
      const box = scroller
        ? scroller.getBoundingClientRect()
        : { top: 0, bottom: window.innerHeight };
      const margin = 64;
      let dir = 0;
      if (lastY < box.top + margin) dir = -1;
      else if (lastY > box.bottom - margin) dir = 1;
      if (dir) {
        if (scroller) scroller.scrollTop += dir * 14;
        else window.scrollBy(0, dir * 14);
        place();
        reorder();
      }
      raf = requestAnimationFrame(tick);
    }

    list.addEventListener('pointerdown', (e) => {
      const grip = e.target.closest('.lugrip');
      if (!grip) return;
      const row = grip.closest('.lurow');
      if (!row) return;
      drag = row;
      lastY = e.clientY;
      grabY = e.clientY - row.getBoundingClientRect().top;
      row.classList.add('is-dragging');
      list.classList.add('is-sorting');
      place();
      try { list.setPointerCapture(e.pointerId); } catch (_) { /* 古い端末では省く */ }
      if (!raf) raf = requestAnimationFrame(tick);
      e.preventDefault();
    });

    list.addEventListener('pointermove', (e) => {
      if (!drag) return;
      e.preventDefault();
      lastY = e.clientY;
      place();
      reorder();
    });

    const end = () => {
      if (!drag) return;
      drag.style.transform = '';
      drag.classList.remove('is-dragging');
      list.classList.remove('is-sorting');
      drag = null;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (opt.onDone) {
        opt.onDone(Array.from(list.children).map((n) => n.dataset.pid).filter(Boolean));
      }
    };
    list.addEventListener('pointerup', end);
    list.addEventListener('pointercancel', end);
  }

  /* ---------- オーダー編集 ----------
     野手13人をひとつづきの並びで出す。上から9人がスタメンで、
     残りが控え。控えの選手を上に持ち上げれば、そのままスタメンに入る。
     （だから「交代」のボタンはいらない） */

  function lineupEditor(team, onDone) {

    /* 打順の位置に守備位置がくっついている。選手が入れ替わっても
       1番の守備位置は1番に残る */
    let posOrder = team.lineup.map((sl) => sl.pos);

    function batterIds() {
      const inLine = team.lineup.map((sl) => sl.pid);
      const bench = team.batters.filter((p) => inLine.indexOf(p.id) < 0).map((p) => p.id);
      return inLine.concat(bench);
    }

    function batRow(pid, i) {
      const p = Team.find(team, pid);
      if (!p) return '';
      const bench = i >= 9;
      const pos = bench ? null : posOrder[i];
      const options = DATASET_POSITIONS.map((k) =>
        '<option value="' + k + '"' + (k === pos ? ' selected' : '') + '>' + posShort(k) + '</option>').join('');
      return '<li class="lurow' + (bench ? ' is-bench' : '') + '" data-pid="' + p.id + '">' +
        '<span class="lugrip" aria-hidden="true"><i></i><i></i><i></i></span>' +
        '<span class="luno">' + (bench ? '控' : (i + 1)) + '</span>' +
        '<span class="lupos">' +
          (bench ? '<span class="lupos__bench">' + posShort(p.pos) + '</span>'
                 : '<select class="possel" data-i="' + i + '">' + options + '</select>') +
        '</span>' +
        '<span class="lumain">' +
          '<button type="button" class="linkbtn pname" data-pid="' + p.id + '">' + esc(p.name) + '</button>' +
          '<span class="tiny">' + p.grade + '年 ' + handMark(p) +
            (bench || pos === 'DH' ? '' : '　適性' + p.apt[pos]) + '</span>' +
        '</span>' +
        '<span class="lustats">ミ' + rankNum(p.meet) + '　パ' + rankNum(p.power) +
          '　走' + rankNum(p.speed) + '　守' + rankNum(p.field) + '</span>' +
        '<span class="luarrow">' +
          '<button type="button" class="btn btn--tiny up" data-i="' + i + '">▲</button>' +
          '<button type="button" class="btn btn--tiny down" data-i="' + i + '">▼</button>' +
        '</span>' +
      '</li>';
    }

    function pitRow(pid, i) {
      const p = Team.find(team, pid);
      if (!p) return '';
      return '<li class="lurow" data-pid="' + p.id + '">' +
        '<span class="lugrip" aria-hidden="true"><i></i><i></i><i></i></span>' +
        '<span class="luno luno--wide">' + (i === 0 ? '先発' : (i + 1) + '番手') + '</span>' +
        '<span class="lumain">' +
          '<button type="button" class="linkbtn pname" data-pid="' + p.id + '">' + esc(p.name) + '</button>' +
          '<span class="tiny">' + p.grade + '年 ' + p.velo + 'km/h ' + handMark(p) + '</span>' +
        '</span>' +
        '<span class="lustats">制' + rankNum(p.control) + '　ス' + rankNum(p.stamina) + '</span>' +
        '<span class="luarrow">' +
          '<button type="button" class="btn btn--tiny pup" data-i="' + i + '">▲</button>' +
          '<button type="button" class="btn btn--tiny pdown" data-i="' + i + '">▼</button>' +
        '</span>' +
      '</li>';
    }

    function render() {
      return '<div class="lineup-edit">' +
        '<h3 class="modal__title">オーダー編集</h3>' +
        '<p class="note lineup-hint">左はしの取っ手をつまんで上下に動かすと、並べ替えられます。' +
          '<b>上の9人がスタメン</b>、残りが控えです。控えの選手を上に持ち上げれば、そのまま出場します。</p>' +
        '<ul class="lulist" id="lu-bat">' + batterIds().map(batRow).join('') + '</ul>' +
        '<h4 class="sub">投手の起用順<span class="sub__note">上から先発</span></h4>' +
        '<ul class="lulist" id="lu-pit">' + team.rotation.map(pitRow).join('') + '</ul>' +
        '<div class="actions actions--modal">' +
        '<button type="button" class="btn" id="lu-auto">おまかせ</button>' +
        '<button type="button" class="btn btn--primary" id="lu-done">決定</button>' +
        '</div></div>';
    }

    /* 動かしているあいだ、番号と守備位置の表示だけ付け替える */
    function relabel(list) {
      Array.from(list.children).forEach((li, i) => {
        const no = li.querySelector('.luno');
        if (!no) return;
        if (list.id === 'lu-pit') { no.textContent = i === 0 ? '先発' : (i + 1) + '番手'; return; }
        const bench = i >= 9;
        li.classList.toggle('is-bench', bench);
        no.textContent = bench ? '控' : (i + 1);
        const sel = li.querySelector('.possel');
        if (sel && !bench) sel.value = posOrder[i];
      });
    }

    function applyBatters(order) {
      team.lineup = order.slice(0, 9).map((pid, k) => ({ pid, pos: posOrder[k] }));
      /* 控えも並べた順に持っておく（次に開いたときも同じ並びで出す） */
      const byId = {};
      team.batters.forEach((p) => { byId[p.id] = p; });
      team.batters = order.map((pid) => byId[pid]).filter(Boolean)
        .concat(team.batters.filter((p) => order.indexOf(p.id) < 0));
      refresh();
    }

    function refresh() {
      html('modal-body', render());
      wire(el('modal-body'));
    }

    function wire(body) {
      const bat = body.querySelector('#lu-bat');
      if (bat) makeSortable(bat, { onMove: relabel, onDone: applyBatters });
      const pit = body.querySelector('#lu-pit');
      if (pit) makeSortable(pit, {
        onMove: relabel,
        onDone: (order) => { team.rotation = order.slice(); refresh(); },
      });

      const move = (list, i, d) => {
        const j = i + d;
        if (j < 0 || j >= list.length) return null;
        const next = list.slice();
        [next[i], next[j]] = [next[j], next[i]];
        return next;
      };
      body.querySelectorAll('.up').forEach((b) => b.addEventListener('click', () => {
        const next = move(batterIds(), +b.dataset.i, -1);
        if (next) applyBatters(next);
      }));
      body.querySelectorAll('.down').forEach((b) => b.addEventListener('click', () => {
        const next = move(batterIds(), +b.dataset.i, 1);
        if (next) applyBatters(next);
      }));
      body.querySelectorAll('.pup').forEach((b) => b.addEventListener('click', () => {
        const next = move(team.rotation, +b.dataset.i, -1);
        if (next) { team.rotation = next; refresh(); }
      }));
      body.querySelectorAll('.pdown').forEach((b) => b.addEventListener('click', () => {
        const next = move(team.rotation, +b.dataset.i, 1);
        if (next) { team.rotation = next; refresh(); }
      }));

      body.querySelectorAll('.possel').forEach((sel) => sel.addEventListener('change', () => {
        const i = +sel.dataset.i;
        const next = sel.value;
        /* 同じ守備位置が2人にならないよう、持っていた打順と入れ替える */
        const other = posOrder.findIndex((v, k) => k !== i && v === next);
        if (other >= 0) posOrder[other] = posOrder[i];
        posOrder[i] = next;
        team.lineup = team.lineup.map((sl, k) => ({ pid: sl.pid, pos: posOrder[k] }));
        refresh();
      }));

      body.querySelectorAll('.pname').forEach((b) => b.addEventListener('click', () => {
        const p = Team.find(team, b.dataset.pid);
        if (!p) return;
        openPlayer(p);
        closeModal.after = () => refresh();
      }));

      const auto = body.querySelector('#lu-auto');
      if (auto) auto.addEventListener('click', () => {
        Team.autoLineup(team);
        posOrder = team.lineup.map((sl) => sl.pos);
        refresh();
      });
      const done = body.querySelector('#lu-done');
      if (done) done.addEventListener('click', () => {
        closeModal.after = null; closeModal(); if (onDone) onDone();
      });
    }

    modal(render(), { kind: 'lineup', onOpen(body) { wire(body); } });
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
    avg, era, ipText, stat, rankSpan, rankNum, aptSpan, pullText, handMark,
    playerRow, rosterTable, playerDetail, openPlayer, lineupEditor, roleText, makeSortable,
    careerBatLine, careerPitLine, init,
  };
})();
