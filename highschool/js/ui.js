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

  /** 閉じる。戻り先（closeModal.back）が指定してあれば、そこへ戻るだけ */
  function closeModal() {
    if (closeModal.back) { const f = closeModal.back; closeModal.back = null; f(); return; }
    const m = el('modal');
    m.hidden = true;
    document.body.classList.remove('is-modal');
    if (closeModal.after) { const f = closeModal.after; closeModal.after = null; f(); }
  }

  /**
   * 「よろしいですか？」を聞く。
   * ブラウザの window.confirm は、このページのような枠（sandbox）の中では
   * 出ないことがあるので、自前のふきだしで聞く。
   */
  function confirmBox(opt, onYes) {
    modal(
      '<h3 class="modal__title">' + esc(opt.title || '確認') + '</h3>' +
      '<p class="confirmbox">' + esc(opt.body || '') + '</p>' +
      '<div class="actions actions--modal">' +
        '<button type="button" class="btn" id="cf-no">' + esc(opt.no || 'やめる') + '</button>' +
        '<button type="button" class="btn btn--danger" id="cf-yes">' + esc(opt.yes || 'はい') + '</button>' +
      '</div>',
      {
        kind: 'confirm',
        onOpen(body) {
          body.querySelector('#cf-no').addEventListener('click', () => {
            closeModal.back = null; closeModal.after = null; closeModal();
          });
          body.querySelector('#cf-yes').addEventListener('click', () => {
            closeModal.back = null; closeModal.after = null; closeModal();
            onYes();
          });
        },
      }
    );
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

  /* 守備適性は色を付けない。能力の評価（S〜G）と見分けがつかなくなるため */
  function aptSpan(letter) {
    return '<span class="apt-letter">' + letter + '</span>';
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
         /* 変化球は枠に入れて2つまで。残りは「+n」にして、
            球種の数で列の幅や行の高さが変わらないようにする
            （全部は選手の詳細で見られる） */
         '<td class="t-break">' + p.pitches.slice(0, 2).map((q) =>
           '<span class="luball">' + esc(q.name) + '<b>' + q.level + '</b></span>').join('') +
           (p.pitches.length > 2 ? '<span class="luball luball--more">+' + (p.pitches.length - 2) + '</span>' : '') +
         '</td>'].join('')
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
      /* 投手の一覧に「位置」の列はいらない（全員 投） */
      (isPit ? '' : '<td class="c">' + posShort(p.pos) + '</td>') +
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
      (isPit ? '' : '<th>位置</th>') + '<th class="hand">利き</th>' + head + '</tr></thead>' +
      '<tbody>' + players.map((p) => playerRow(p, opts)).join('') + '</tbody></table></div>';
  }

  /* ---------- 並び替えのできる選手一覧 ----------
     放出する選手を選ぶときなど、学年や役割で見たいことがあるので、
     表の上に並び替えのボタンを付けられるようにしてある。 */

  const SORTS = [
    { key: 'order',  label: '打順' },
    { key: 'grade',  label: '学年' },
    { key: 'rating', label: '能力' },
    { key: 'pos',    label: '守備位置' },
  ];

  function posRank(p) {
    const i = DATASET_POSITIONS.indexOf(p.pos);
    return i < 0 ? 99 : i;
  }

  function roleRank(team, p) {
    if (!team) return 50;
    if (p.kind === 'pitcher') {
      const i = (team.rotation || []).indexOf(p.id);
      return i < 0 ? 90 : i;
    }
    const i = (team.lineup || []).findIndex((sl) => sl.pid === p.id);
    return i < 0 ? 50 : i;
  }

  function sortPlayers(players, key, team) {
    const list = players.slice();
    const byRating = (a, b) => Player.rating(b) - Player.rating(a);
    if (key === 'grade') list.sort((a, b) => b.grade - a.grade || byRating(a, b));
    else if (key === 'rating') list.sort(byRating);
    else if (key === 'pos') list.sort((a, b) => posRank(a) - posRank(b) || byRating(a, b));
    else if (key === 'order') list.sort((a, b) => roleRank(team, a) - roleRank(team, b));
    return list;
  }

  /** 並び替えボタン付きの一覧。root（要素）に描く */
  function rosterPanel(root, players, opts) {
    opts = opts || {};
    let key = opts.sort || (opts.team ? 'order' : 'rating');
    function draw() {
      root.innerHTML =
        '<div class="sortbar"><span class="sortbar__label">並び替え</span>' +
        SORTS.filter((s2) => s2.key !== 'order' || opts.team)
          .filter((s2) => s2.key !== 'pos' || players[0].kind !== 'pitcher')
          .map((s2) => '<button type="button" class="sortbtn' + (s2.key === key ? ' is-on' : '') +
            '" data-sort="' + s2.key + '">' + s2.label + '</button>').join('') +
        '</div>' + rosterTable(sortPlayers(players, key, opts.team), opts);
      root.querySelectorAll('.sortbtn').forEach((b) => b.addEventListener('click', () => {
        key = b.dataset.sort; draw();
      }));
      if (opts.onRow) {
        root.querySelectorAll('tr.prow').forEach((tr) =>
          tr.addEventListener('click', () => opts.onRow(tr.dataset.pid, tr, root)));
      }
    }
    draw();
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
      abilities += '<div class="stat"><span class="stat__label">疲労</span>' +
        '<span class="stat__num stat__num--wide lufat lufat--' +
        ((p.fatigue || 0) >= 70 ? 'hi' : ((p.fatigue || 0) >= 40 ? 'mid' : 'lo')) + '">' +
        esc(Team.fatigueLabel(p)) + '</span></div>';
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
        (opts.team && opts.team.captainId === p.id ? '　<b class="capmark">主将</b>' : '') +
        (p.awakened ? '　<b class="awake">覚醒</b>' : '') + '</div>' +
        (p.from ? '<div class="pdetail__from">' + p.from.year + '年目に ' + esc(p.from.school) + ' から加入</div>' : '') +
      '</div>' +
      abilities +
      '<h4 class="sub">高校通算成績<span class="sub__note">練習試合を含む</span></h4>' +
      (isPit ? careerPitLine(p.career) : careerBatLine(p.career)) +
      hl +
      '</div>';
  }

  /** 名前の書き換えを受け付ける（詳細をどこに描いても使える） */
  /** 名前の書き換えを受け付ける（詳細をどこに描いても使える） */
  function wireRename(body, p, onRename) {
    const btn = body.querySelector('#pd-rename');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const holder = body.querySelector('#pd-name');
      holder.innerHTML =
        '<input type="text" class="field__input field__input--inline" id="pd-input" maxlength="12" value="' + esc(p.name) + '">' +
        '<button type="button" class="btn btn--small" id="pd-save">決定</button>';
      const input = body.querySelector('#pd-input');
      input.focus(); input.select();
      const save = () => {
        const v = input.value.trim();
        if (v) p.name = v.slice(0, 12);
        holder.textContent = p.name;
        btn.hidden = false;
        if (onRename) onRename(p);
      };
      body.querySelector('#pd-save').addEventListener('click', save);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      btn.hidden = true;
    });
  }

  /** 選手の詳細をふきだしで開く */
  function openPlayer(p, opts) {
    opts = opts || {};
    modal(playerDetail(p, opts), {
      kind: 'player',
      onOpen(body) { wireRename(body, p, opts.onRename); },
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

  /* ---------- オーダー変更 ----------
     野手13人をひとつづきの並びで出す。上から9人がスタメンで、
     残りが控え。控えの選手を上に持ち上げれば、そのままスタメンに入る。
     守備位置は選手について回るので、1人の守備位置を変えても
     他の選手は動かない。そのかわり重複したら決定を止める。 */

  function lineupEditor(team, onDone) {

    /* 選手ID → 守備位置。'BENCH' なら控え。
       スタメンかどうかは「並びの上から9人」ではなく、守備位置が付いているかで決まる。
       控えの選手に守備位置を付ければ、それだけでスタメンに入る。 */
    const BENCH = 'BENCH';
    const posOf = {};
    team.batters.forEach((p) => { posOf[p.id] = BENCH; });
    team.lineup.forEach((sl) => { posOf[sl.pid] = sl.pos; });

    /* 並び順（13人ぶん）。打順はこの並びのうち、守備位置が付いている人だけで数える */
    let order = team.lineup.map((sl) => sl.pid)
      .concat(team.batters.map((p) => p.id).filter((id) => !team.lineup.some((sl) => sl.pid === id)));

    let tab = 'bat';        // 'bat' か 'pit'
    let showBad = false;    // 決定を押すまでは赤くしない

    function batterIds() {
      /* 部員が入れ替わっていても落ちないように、毎回そろえ直す */
      const ids = team.batters.map((p) => p.id);
      order = order.filter((id) => ids.indexOf(id) >= 0)
        .concat(ids.filter((id) => order.indexOf(id) < 0));
      order.forEach((id) => { if (posOf[id] == null) posOf[id] = BENCH; });
      return order;
    }

    /** スタメン（守備位置が付いている人）を並び順で */
    function starters() { return batterIds().filter((id) => posOf[id] !== BENCH); }

    /** 守備位置の過不足を調べる */
    function problems() {
      const st = starters();
      const used = {}, dup = [];
      st.forEach((id) => {
        const k = posOf[id];
        if (used[k]) { if (dup.indexOf(k) < 0) dup.push(k); } else used[k] = true;
      });
      const missing = DATASET_POSITIONS.filter((k) => !used[k]);
      return { dup, missing, count: st.length };
    }

    function aptRow(p) {
      return FIELD_POSITIONS.map((k) =>
        '<span class="luapt"><i>' + posShort(k) + '</i>' + aptSpan(p.apt[k]) + '</span>').join('');
    }

    function batRow(pid, no, prob, i) {
      const p = Team.find(team, pid);
      if (!p) return '';
      const pos = posOf[pid];
      const bench = pos === BENCH;
      /* どの選手も同じ選び方。「控」を選べば外れ、守備位置を選べば入る */
      const options = ['<option value="' + BENCH + '"' + (bench ? ' selected' : '') + '>控</option>']
        .concat(DATASET_POSITIONS.map((k) =>
          '<option value="' + k + '"' + (k === pos ? ' selected' : '') + '>' + posShort(k) + '</option>')).join('');
      const bad = showBad && !bench && prob.dup.indexOf(pos) >= 0;
      return '<li class="lurow' + (bench ? ' is-bench' : '') + (bad ? ' is-bad' : '') + '" data-pid="' + p.id + '">' +
        '<span class="lugrip" aria-hidden="true"><i></i><i></i><i></i></span>' +
        '<span class="luno">' + (bench ? '控' : no) + '</span>' +
        '<span class="lupos">' +
          '<select class="possel' + (bench ? ' is-bench' : '') + '" data-pid="' + p.id + '">' +
            options + '</select>' +
        '</span>' +
        '<span class="lumain">' +
          '<button type="button" class="linkbtn pname" data-pid="' + p.id + '">' + esc(p.name) + '</button>' +
          '<span class="tiny">' + p.grade + '年 ' + handMark(p) + ' 弾道' + p.traj + '</span>' +
        '</span>' +
        '<span class="lustats">ミ' + rankNum(p.meet) + '　パ' + rankNum(p.power) +
          '　走' + rankNum(p.speed) + '　肩' + rankNum(p.arm) +
          '　守' + rankNum(p.field) + '　捕' + rankNum(p.catch) + '</span>' +
        '<span class="luapts">' + aptRow(p) + '</span>' +
        '<span class="luarrow">' +
          '<button type="button" class="btn btn--tiny up" data-i="' + i + '">▲</button>' +
          '<button type="button" class="btn btn--tiny down" data-i="' + i + '">▼</button>' +
        '</span>' +
      '</li>';
    }

    function pitRow(pid, i) {
      const p = Team.find(team, pid);
      if (!p) return '';
      const f = p.fatigue || 0;
      return '<li class="lurow" data-pid="' + p.id + '">' +
        '<span class="lugrip" aria-hidden="true"><i></i><i></i><i></i></span>' +
        '<span class="luno luno--wide">' + (i === 0 ? '先発' : (i + 1) + '番手') + '</span>' +
        '<span class="lumain">' +
          '<button type="button" class="linkbtn pname" data-pid="' + p.id + '">' + esc(p.name) + '</button>' +
          '<span class="tiny">' + p.grade + '年 ' + handMark(p) + '</span>' +
        '</span>' +
        '<span class="lustats">最速<b class="rankval">' + p.velo + '</b>　制' + rankNum(p.control) +
          '　ス' + rankNum(p.stamina) +
          '　<span class="lufat lufat--' + (f >= 70 ? 'hi' : (f >= 40 ? 'mid' : 'lo')) + '">' +
          esc(Team.fatigueLabel(p)) + '</span></span>' +
        '<span class="luapts lupitch">' + p.pitches.map((q) =>
          '<span class="luball">' + esc(q.name) + '<b>' + q.level + '</b></span>').join('') + '</span>' +
        '<span class="luarrow">' +
          '<button type="button" class="btn btn--tiny pup" data-i="' + i + '">▲</button>' +
          '<button type="button" class="btn btn--tiny pdown" data-i="' + i + '">▼</button>' +
        '</span>' +
      '</li>';
    }

    function render() {
      const ids = batterIds();
      const prob = problems();
      const msgs = [];
      if (prob.dup.length) msgs.push('守備位置が重なっています（' + prob.dup.map(posName).join('・') + '）');
      if (prob.missing.length) msgs.push('守る人がいません（' + prob.missing.map(posName).join('・') + '）');
      const warn = (showBad && msgs.length)
        ? '<p class="luwarn">' + msgs.join('。') + '。直してから決定してください。</p>' : '';
      const hint = tab === 'bat'
        ? '守備位置の欄で<b>「控」を選べば外れ、守備位置を選べばスタメンに入ります</b>。' +
          '打順は左はしの取っ手をつまんで並べ替えます。' +
          '9つの守備位置が1人ずつ埋まっていないと決定できません。'
        : '左はしの取っ手をつまんで、投げる順番を並べ替えられます。<b>いちばん上が先発</b>です。';
      let no = 0;
      const list = tab === 'bat'
        ? '<ul class="lulist" id="lu-bat">' + ids.map((pid, i) => {
            if (posOf[pid] !== BENCH) no++;
            return batRow(pid, no, prob, i);
          }).join('') + '</ul>'
        : '<ul class="lulist" id="lu-pit">' + team.rotation.map(pitRow).join('') + '</ul>';
      return '<div class="lineup-edit">' +
        '<h3 class="modal__title">オーダー変更</h3>' +
        '<div class="lutabs">' +
          '<button type="button" class="lutab' + (tab === 'bat' ? ' is-on' : '') + '" data-tab="bat">打線</button>' +
          '<button type="button" class="lutab' + (tab === 'pit' ? ' is-on' : '') + '" data-tab="pit">投手</button>' +
        '</div>' +
        '<p class="note lineup-hint">' + hint + '</p>' +
        warn + list +
        '<div class="actions actions--modal">' +
        '<button type="button" class="btn" id="lu-auto">おまかせ</button>' +
        '<button type="button" class="btn btn--primary" id="lu-done">決定</button>' +
        '</div></div>';
    }

    /* 動かしているあいだ、打順の番号だけ付け替える。
       控えかどうかは守備位置で決まるので、動かしても変わらない */
    function relabel(list) {
      let n = 0;
      Array.from(list.children).forEach((li, i) => {
        const no = li.querySelector('.luno');
        if (!no) return;
        if (list.id === 'lu-pit') { no.textContent = i === 0 ? '先発' : (i + 1) + '番手'; return; }
        if (posOf[li.dataset.pid] !== BENCH) { n++; no.textContent = n; }
        else no.textContent = '控';
      });
    }

    /** 並びを覚えて、チームに書き戻す（画面は描き直さない） */
    function commit(next) {
      if (next) order = next.slice();
      team.lineup = starters().map((pid) => ({ pid, pos: posOf[pid] }));
      /* 名簿の並びも、画面の並びに合わせておく */
      const byId = {};
      team.batters.forEach((p) => { byId[p.id] = p; });
      team.batters = batterIds().map((pid) => byId[pid]).filter(Boolean);
    }

    function applyBatters(next) { commit(next); refresh(); }

    function refresh() {
      closeModal.back = null;
      html('modal-body', render());
      wire(el('modal-body'));
    }

    /** 選手の詳細は、このふきだしの中で見せる（閉じてもオーダーに戻る） */
    function openDetail(pid) {
      const p = Team.find(team, pid);
      if (!p) return;
      html('modal-body', playerDetail(p, {}) +
        '<div class="actions actions--modal"><button type="button" class="btn" id="pd-back">オーダーに戻る</button></div>');
      const body = el('modal-body');
      wireRename(body, p, () => {});
      body.querySelector('#pd-back').addEventListener('click', refresh);
      closeModal.back = refresh;
    }

    function wire(body) {
      body.querySelectorAll('.lutab').forEach((b) => b.addEventListener('click', () => {
        tab = b.dataset.tab; refresh();
      }));
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

      /* 守備位置を変えるのは、その選手だけ。
         「控」を選べば外れ、守備位置を選べばスタメンに入る。
         重なりや不足は、決定を押したときにまとめて知らせる */
      body.querySelectorAll('.possel').forEach((sel) => sel.addEventListener('change', () => {
        posOf[sel.dataset.pid] = sel.value;
        showBad = false;
        applyBatters();
      }));

      body.querySelectorAll('.pname').forEach((b) =>
        b.addEventListener('click', () => openDetail(b.dataset.pid)));

      const auto = body.querySelector('#lu-auto');
      if (auto) auto.addEventListener('click', () => {
        Team.autoLineup(team);
        team.batters.forEach((p) => { posOf[p.id] = BENCH; });
        team.lineup.forEach((sl) => { posOf[sl.pid] = sl.pos; });
        order = team.lineup.map((sl) => sl.pid)
          .concat(team.batters.map((p) => p.id).filter((id) => posOf[id] === BENCH));
        showBad = false;
        refresh();
      });
      const done = body.querySelector('#lu-done');
      if (done) done.addEventListener('click', () => {
        /* 重なりと不足は、決定を押したときにはじめて知らせる */
        const prob = problems();
        if (prob.dup.length || prob.missing.length || prob.count !== 9) {
          showBad = true; tab = 'bat'; refresh(); return;
        }
        showBad = false;
        commit();
        closeModal.back = null; closeModal.after = null; closeModal();
        if (onDone) onDone();
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


  /* ---------- キャプテン ----------
     部を束ねる1人を決める。特訓に進む前に必ず決めてもらう。
     3年生が引退すると空くので、代替わりのたびに選び直すことになる。 */

  function captainPicker(team, onDone, opts) {
    opts = opts || {};
    /* オフシーズンでは、これから引退する3年生を候補から外す。
       選んでも次の画面で居なくなってしまうため */
    const skip = new Set(opts.exclude || []);
    const cap = Team.captain(team);
    /* 学年の高い順。同じ学年なら打順・起用順の早い順 */
    const order = {};
    team.lineup.forEach((s, i) => { order[s.pid] = i; });
    (team.rotation || []).forEach((id, i) => { if (order[id] == null) order[id] = 20 + i; });
    const list = Team.all(team).filter((p) => !skip.has(p.id)).sort((a, b) =>
      (b.grade - a.grade) ||
      ((order[a.id] == null ? 99 : order[a.id]) - (order[b.id] == null ? 99 : order[b.id])));

    const row = (p) => {
      const isPit = p.kind === 'pitcher';
      const meta = isPit
        ? (p.throws === 'L' ? '左' : '右') + '・' + p.velo + 'km/h　制球 ' + rankNum(p.control) +
          '　スタミナ ' + rankNum(p.stamina)
        : roleText(team, p) + '　ミート ' + rankNum(p.meet) + '　パワー ' + rankNum(p.power) +
          '　走力 ' + rankNum(p.speed);
      return '<button type="button" class="spick__item' +
        (cap && cap.id === p.id ? ' is-on' : '') + '" data-pid="' + p.id + '">' +
        '<span class="spick__nm">' + esc(p.name) + '</span>' +
        '<span class="spick__fat">' + p.grade + '年</span>' +
        '<span class="spick__meta">' + meta + '</span>' +
      '</button>';
    };

    modal(
      '<h3 class="modal__title">キャプテンを決める</h3>' +
      '<p class="time__where">部を束ねる1人を選んでください。学年は問いません。' +
        'キャプテンが引退したら、そのときに決め直します。' +
        'オフシーズンにはいつでも変えられます。</p>' +
      '<div class="spick__list capsel">' + list.map(row).join('') + '</div>',
      {
        kind: 'captain',
        onOpen(body) {
          body.querySelectorAll('.spick__item').forEach((b) =>
            b.addEventListener('click', () => {
              team.captainId = b.dataset.pid;
              closeModal.back = null; closeModal.after = null;
              closeModal();
              if (onDone) onDone();
            }));
        },
      }
    );
  }

  return {
    el, esc, html, show, currentScreen, curtain, modal, closeModal, confirmBox,
    avg, era, ipText, stat, rankSpan, rankNum, aptSpan, pullText, handMark,
    playerRow, rosterTable, rosterPanel, sortPlayers, playerDetail, openPlayer,
    lineupEditor, roleText, makeSortable, wireRename, captainPicker,
    careerBatLine, careerPitLine, init,
  };
})();
