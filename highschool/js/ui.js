/* ==================================================
   高校野球  ui.js

   画面の出し入れと、どの画面からも使う部品。
   ・選手の詳細（能力・高校通算成績・名場面）とオーダー変更は
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

  /** 勝敗投手・セーブ・本塁打。verdict/result 両方の画面で使う。
      スポーツニュースの速報でよく見る「[勝]投手名」のような、
      色つきの短いラベルを頭に置く形にしてある。全部を1行に詰め込むと
      どのラベルの名前か分からなくなるので、1行1項目の左寄せにした。 */
  function decisionLines(r) {
    const who = (d) => esc(d.name);
    const row = (cls, badge, text) =>
      '<div class="decisions__row"><b class="decisions__badge decisions__badge--' + cls + '">' + badge + '</b>' +
      '<span class="decisions__name">' + text + '</span></div>';
    const rows = [];
    if (r.winPitcher) rows.push(row('win', '勝', who(r.winPitcher)));
    if (r.losePitcher) rows.push(row('lose', '敗', who(r.losePitcher)));
    if (r.savePitcher) rows.push(row('save', 'S', who(r.savePitcher)));
    if (r.homers && r.homers.length) {
      rows.push(row('hr', '本', r.homers.map((h) =>
        who(h) + (h.hr > 1 ? '×' + h.hr : '')).join('、')));
    }
    return rows.length ? '<div class="decisions">' + rows.join('') + '</div>' : '';
  }

  /* ---------- 画面の切り替え ---------- */

  let current = 'screen-top';

  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('is-active'));
    const n = el(id);
    if (n) n.classList.add('is-active');
    current = id;
    /* 「← 部屋」（部屋のトップへ戻るリンク）は、ゲームのトップ画面だけに出す。
       プレイ中の画面では、うっかり押して離れてしまわないよう隠す */
    const home = document.querySelector('.appbar__home');
    if (home) home.hidden = id !== 'screen-top';
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
    /* いちばん上から出す。閉じたときの位置が残っていると、
       オーダー変更を開き直したときに途中から始まってしまう。
       描き直し（refresh）はここを通らないので、
       並べ替えの最中に飛ばされることはない */
    const panel = m.querySelector('.modal__body');
    if (panel) panel.scrollTop = 0;
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
        '<button type="button" class="btn ' + (opt.yesClass || 'btn--danger') + '" id="cf-yes">' + esc(opt.yes || 'はい') + '</button>' +
      '</div>',
      {
        kind: 'confirm',
        onOpen(body) {
          body.querySelector('#cf-no').addEventListener('click', () => {
            closeModal.back = null; closeModal.after = null; closeModal();
            if (opt.onNo) opt.onNo();
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

  /** 能力ひとつ（S〜G と数字）。initial を渡すと「獲得時」の値も添える */
  function stat(label, value, unit, initial) {
    const r = rankOf(value);
    const init = (initial != null && initial !== value)
      ? '<span class="stat__init">獲得時 ' + initial + (unit ? esc(unit) : '') + '</span>' : '';
    return '<div class="stat"><span class="stat__label">' + esc(label) + '</span>' +
      '<span class="stat__rank rank-' + r + '">' + r + '</span>' +
      '<span class="stat__num' + (value >= 101 ? ' is-ss' : '') + '">' + value + (unit ? esc(unit) : '') + '</span>' + init + '</div>';
  }

  function rankSpan(value) {
    const r = rankOf(value);
    return '<span class="rank rank-' + r + '">' + r + '</span>';
  }

  /** 評価と素の数字を並べて出す（特訓の画面などで使う） */
  function rankNum(value) {
    const r = rankOf(value);
    return '<span class="rank rank-' + r + '">' + r + '</span><b class="rankval' + (value >= 101 ? ' is-ss' : '') + '">' + value + '</b>';
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

  /** 弾道。曲がっていない小さな矢印を、弾道の角度（1が低く、4が高い）で傾けて描き、
      横に数字を添える */
  function trajIcon(n, withNum) {
    const ang = { 1: 8, 2: 28, 3: 48, 4: 68 }[n] || 28;
    return '<span class="traj traj--' + n + '" title="弾道' + n + '">' +
      '<svg viewBox="0 0 18 14" aria-hidden="true"><g transform="rotate(' + (-ang) + ' 2 12)">' +
      '<line x1="2" y1="12" x2="14" y2="12"/><path d="M16.5 12 L12 9.6 V14.4Z"/></g></svg>' +
      (withNum === false ? '' : '<b>' + n + '</b>') + '</span>';
  }

  function handMark(p) {
    return (p.throws === 'L' ? '左' : '右') + '投' + Player.batsText(p);
  }

  /** 投手の番手の並び。試合前に先発を選んでも番手は動かさないので、
      並びを持っていればそれ、なければ起用順 */
  function pitOrderOf(team) {
    const ids = new Set((team.pitchers || []).map((p) => p.id));
    const base = ((team.pitcherOrder && team.pitcherOrder.length ? team.pitcherOrder : team.rotation) || [])
      .filter((id) => ids.has(id));
    (team.rotation || []).forEach((id) => { if (base.indexOf(id) < 0) base.push(id); });
    return base;
  }
  /** 並びを保存し、先発（いまの rotation[0]）を頭にした起用順を作る */
  function setPitOrder(team, order) {
    const starter = (team.rotation || [])[0];
    team.pitcherOrder = order.slice();
    team.rotation = order.indexOf(starter) < 0 ? order.slice()
      : [starter].concat(order.filter((id) => id !== starter));
  }

  /** その選手がオーダーのどこにいるか。控えなら「控え」 */
  function roleText(team, p) {
    if (!team) return '';
    if (p.kind === 'pitcher') {
      const i = pitOrderOf(team).indexOf(p.id);
      if (i < 0) return '投手';
      return (i + 1) + '番手' + ((team.rotation || [])[0] === p.id ? '・先発' : '');
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
         /* 変化球は全部出す。表は .tablewrap で横スクロールできるので、
            途中で切って「+n」にする必要はない */
         '<td class="t-break">' + Player.pitchesInOrder(p).map((q) =>
           '<span class="luball">' + esc(q.name) + '<b>' + q.level + '</b></span>').join('') +
         '</td>'].join('')
      : ['<td class="c">' + trajIcon(p.traj) + '</td>',
         '<td class="c">' + rankNum(p.meet) + '</td>',
         '<td class="c">' + rankNum(p.power) + '</td>',
         '<td class="c">' + rankNum(p.speed) + '</td>',
         '<td class="c">' + rankNum(p.arm) + '</td>',
         '<td class="c">' + rankNum(p.field) + '</td>',
         '<td class="c">' + rankNum(p.catch) + '</td>'].join('');
    /* 自分のチームを渡されたときは、打順・守備位置（控えなら「控え」）も出す */
    const role = opts.team ? '<td class="c role">' + roleText(opts.team, p) + '</td>' : '';
    const nm = opts.nameLink
      ? '<button type="button" class="linkbtn nmlink" data-pid="' + p.id + '">' + esc(p.name) + '</button>'
      : esc(p.name);
    return '<tr data-pid="' + p.id + '" class="prow' + (opts.mark ? ' is-' + opts.mark : '') + '">' +
      '<td class="c g' + p.grade + '">' + p.grade + '</td>' +
      '<td class="nm">' + (opts.showBody && p.regularLock ? '<span class="nm__lock" title="1年生からレギュラー確約が条件">※</span>' : '') + nm + (p.awakened ? '<em class="awake-dot" title="覚醒">◆</em>' : '') +
        /* チーム作り・新入生選びでは、名前の下に身長・体重を小さく添える */
        (opts.showBody && p.ht != null ? '<small class="nm__body">' + Math.round(p.ht) + 'cm・' + Math.round(p.wt) + 'kg</small>' : '') + '</td>' +
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
    const roleHead = opts.team ? '<th>役割</th>' : '';
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
      const i = pitOrderOf(team).indexOf(p.id);
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
    /* 投手に打順は無いので、投手の一覧は能力順から始め、「打順」のボタンも出さない */
    const isPit = players.length && players[0].kind === 'pitcher';
    let key = opts.sort || (opts.team && !isPit ? 'order' : 'rating');
    if (isPit && key === 'order') key = 'rating';
    function draw() {
      root.innerHTML =
        '<div class="sortbar"><span class="sortbar__label">並び替え</span>' +
        SORTS.filter((s2) => s2.key !== 'order' || (opts.team && !isPit))
          .filter((s2) => s2.key !== 'pos' || players[0].kind !== 'pitcher')
          .map((s2) => '<button type="button" class="sortbtn' + (s2.key === key ? ' is-on' : '') +
            '" data-sort="' + s2.key + '">' + s2.label + '</button>').join('') +
        '<button type="button" class="sortbtn sortbtn--body" data-bodylist="1">体格</button>' +
        '</div>' + rosterTable(sortPlayers(players, key, opts.team), opts);
      root.querySelectorAll('.sortbtn[data-sort]').forEach((b) => b.addEventListener('click', () => {
        key = b.dataset.sort; draw();
      }));
      root.querySelector('[data-bodylist]').addEventListener('click', () => openBodyList(opts.team, players));
      if (opts.onRow) {
        root.querySelectorAll('tr.prow').forEach((tr) =>
          tr.addEventListener('click', () => opts.onRow(tr.dataset.pid, tr, root)));
      }
      /* 選手名だけは、行の本来のクリック（選ぶ・放出するなど）とは別に、
         ステータスを見られるようにしておく */
      if (opts.nameLink) {
        root.querySelectorAll('.nmlink').forEach((btn) => btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const p = players.find((x) => x.id === btn.dataset.pid);
          if (p) openPlayer(p, { team: opts.team, rename: opts.nameLinkRename });
        }));
      }
    }
    draw();
  }

  /* ---------- 体格の一覧 ----------
     全選手の、名前・学年・投打・守備適性・能力・体格をひと目で見られる表 */
  function openBodyList(team, players) {
    const all = team ? Team.all(team) : players;
    const sortAll = (list) => list.slice().sort((a, b) => (b.grade - a.grade) || (Player.rating(b) - Player.rating(a)));
    const bats = sortAll(all.filter((p) => p.kind !== 'pitcher'));
    const pits = sortAll(all.filter((p) => p.kind === 'pitcher'));
    const apt = (p) => '<td class="bl__apt">' + FIELD_POSITIONS.map((k) =>
      '<b>' + ((p.apt && p.apt[k]) || 'G') + '</b>').join('') + '</td>';
    const body = (p) => '<td class="bl__body">' + (p.ht != null ? Math.round(p.ht) + 'cm<br>' + Math.round(p.wt) + 'kg' : '-') + '</td>';
    const head = (p) => '<td class="bl__g">' + p.grade + '</td><td class="bl__nm">' + esc(p.name) +
      (p.animal ? '<em class="bl__gen">動物</em>' : (p.genius ? '<em class="bl__gen">天才</em>' : '')) + '</td><td class="bl__h">' + esc(handMark(p)) + '</td>';
    const batRow = (p) => '<tr>' + head(p) + body(p) +
      [p.meet, p.power, p.speed, p.arm, p.field, p.catch].map((v) => '<td class="c">' + rankNum(v) + '</td>').join('') + apt(p) + '</tr>';
    const pitRow = (p) => '<tr>' + head(p) + body(p) +
      '<td class="c"><b class="rankval">' + p.velo + '</b></td><td class="c">' + rankNum(p.control) + '</td><td class="c">' + rankNum(p.stamina) + '</td>' +
      '<td class="bl__pit">' + esc(Player.pitchesInOrder(p).map((q) => q.name + q.level).join('・')) + '</td>' + apt(p) + '</tr>';
    const aptTh = '<th class="bl__apth">' + FIELD_POSITIONS.map((k) => '<span>' + posShort(k) + '</span>').join('') + '</th>';
    const table = (title, rows, ths) => rows.length
      ? '<h4 class="sub">' + title + '（' + rows.length + '人）</h4><div class="bl__wrap"><table class="bl">' +
        '<thead><tr><th>年</th><th>選手</th><th>投打</th><th>体格</th>' + ths + aptTh + '</tr></thead><tbody>' +
        rows.join('') + '</tbody></table></div>' : '';
    modal(
      '<h3 class="modal__title">体格・能力の一覧</h3>' +
      table('野手', bats.map(batRow), '<th>ミ</th><th>パ</th><th>走</th><th>肩</th><th>守</th><th>捕</th>') +
      table('投手', pits.map(pitRow), '<th>球速</th><th>制球</th><th>スタ</th><th>変化球</th>') +
      '<div class="actions actions--modal"><button type="button" class="btn btn--wide" data-close>閉じる</button></div>',
      { kind: 'bodylist', onOpen(b) {
        b.querySelectorAll('[data-close]').forEach((x) => x.addEventListener('click', () => closeModal()));
      } });
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

    const init = p.initial || {};
    let abilities = '<div class="stats">';
    if (isPit) {
      const veloInit = (init.velo != null && init.velo !== p.velo)
        ? '<span class="stat__init">獲得時 ' + init.velo + ' km/h</span>' : '';
      abilities += '<div class="stat"><span class="stat__label">最速</span><span class="stat__num stat__num--wide">' + p.velo + ' km/h</span>' + veloInit + '</div>';
      abilities += stat('制球', p.control, null, init.control) + stat('スタミナ', p.stamina, null, init.stamina);
      abilities += '<div class="stat"><span class="stat__label">体力</span>' +
        '<span class="stat__num stat__num--wide">' + Team.staminaGauge(p) + '</span></div>';
      abilities += '</div><h4 class="sub">変化球</h4><ul class="pitchlist">' +
        Player.pitchesInOrder(p).map((q) => {
          const iq = (init.pitches || []).find((x) => x.name === q.name);
          const initNote = (iq && iq.level !== q.level) ? '<span class="stat__init">獲得時 ' + iq.level + '</span>' : '';
          return '<li><span>' + esc(q.name) + '</span><b>' + q.level + '</b>' +
            '<i class="bar"><i style="width:' + (q.level / 7 * 100) + '%"></i></i>' + initNote + '</li>';
        }).join('') + '</ul>';
    } else {
      abilities += stat('ミート', p.meet, null, init.meet) + stat('パワー', p.power, null, init.power) +
        stat('走力', p.speed, null, init.speed) + stat('肩力', p.arm, null, init.arm) +
        stat('守備', p.field, null, init.field) + stat('捕球', p.catch, null, init.catch);
      abilities += '</div>';
      abilities += '<div class="minor"><span>弾道 ' + trajIcon(p.traj) + '</span>' +
        '<span>打球傾向 <b>' + pullText(p.pull) + '</b>（' + (p.pull > 0 ? '+' : '') + p.pull + '）</span></div>';
      abilities += '<h4 class="sub">守備適性</h4><div class="aptrow">' +
        FIELD_POSITIONS.map((k) => '<span class="apt"><i>' + posShort(k) + '</i>' + aptSpan(p.apt[k]) + '</span>').join('') +
        '</div>';
    }

    const top = (p.hl || []).filter((h) => !/打数0安打$/.test(h.line)).sort((a, b) => b.score - a.score).slice(0, 3);
    const hl = top.length
      ? '<h4 class="sub">活躍シーン</h4><ol class="hllist">' + top.map((h) =>
          '<li><span class="hl__where">' + esc(h.where) + '</span><span class="hl__line">' + esc(h.line) + '</span></li>').join('') + '</ol>'
      : '';

    return '<div class="pdetail">' +
      '<div class="pdetail__head">' +
        (p.animal ? '<span class="pdetail__genius">動物</span>'
          : (p.genius ? '<span class="pdetail__genius">天才：' + esc(Body.geniusLabel(p)) + '</span>' : '')) +
        '<div class="pdetail__name" id="pd-name">' + esc(p.name) + '</div>' +
        (opts.rename === false ? '' : '<button type="button" class="linkbtn" id="pd-rename">名前を変える</button>') +
        '<div class="pdetail__meta">' + p.grade + '年　' + (isPit ? '投手' : posName(p.pos)) + '　' +
        (opts.rename === false ? handMark(p) : '<button type="button" class="linkbtn handbtn" id="pd-hand">' + handMark(p) + '</button>') +
        (opts.team && opts.team.captainId === p.id ? '　<b class="capmark">主将</b>' : '') +
        (p.awakened ? '　<b class="awake">覚醒</b>' : '') + '</div>' +
        (p.ht != null
          ? '<div class="pdetail__body">' + esc(Body.label(p)) +
            (p.initial && p.initial.ht != null && !p.animal
              ? '<span class="pdetail__bodyinit">（獲得時 ' + Math.round(p.initial.ht) + 'cm・' + Math.round(p.initial.wt) + 'kg）</span>' : '') +
            '<button type="button" class="linkbtn bodylogbtn" id="pd-bodylog">体格の成長履歴</button>' +
            '</div>' : '') +
        (p.from ? '<div class="pdetail__from">' + p.from.year + '年目に ' + esc(p.from.school) + ' から加入</div>' : '') +
      '</div>' +
      abilities +
      '<h4 class="sub">高校通算成績<span class="sub__note">練習試合を含む</span></h4>' +
      (isPit ? careerPitLine(p.career) : careerBatLine(p.career)) +
      hl +
      '</div>';
  }

  /** 投打の書き換え。投打の文字を押すと、右投・左投、右打・左打・両打を選べる */
  function wireHand(body, p, onRename) {
    const btn = body.querySelector('#pd-hand');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const box = document.createElement('div');
      box.className = 'handpick';
      const row = (label, key, opts) =>
        '<div class="handpick__row"><span>' + label + '</span>' + opts.map((o) =>
          '<button type="button" class="btn btn--small' + (p[key] === o[0] ? ' is-on' : '') + '" data-k="' + key + '" data-v="' + o[0] + '">' + o[1] + '</button>').join('') + '</div>';
      const draw = () => {
        box.innerHTML = row('投げ', 'throws', [['R', '右投'], ['L', '左投']]) +
          row('打ち', 'bats', [['R', '右打'], ['L', '左打'], ['B', '両打']]) +
          '<p class="tiny">左投げは、捕手・二塁・三塁・遊撃の適性がGになります（右投げに戻せば元に戻ります）。</p>';
        box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
          if (b.dataset.k === 'throws') Player.setThrows(p, b.dataset.v); else p.bats = b.dataset.v;
          btn.textContent = handMark(p);
          draw();
          if (onRename) onRename(p);
        }));
      };
      draw();
      const old = body.querySelector('.handpick');
      if (old) { old.remove(); return; }
      btn.parentNode.appendChild(box);
    });
  }

  /* 体格の成長履歴（月ごと）。選手の詳細の上に重ねて出し、戻るボタンで詳細に戻る */
  const BODY_STAT_NAME = { meet: 'ミート', power: 'パワー', speed: '走力', arm: '肩力', field: '守備', catch: '捕球', control: '制球', stamina: 'スタミナ', velo: '最速' };
  function signed(v, unit) { return (v > 0 ? '+' : (v < 0 ? '−' : '±')) + Math.abs(v) + (unit || ''); }
  function bodyLogHtml(p) {
    const log = (p.bodyLog || []).slice().reverse();
    if (!log.length) return '<p class="note">まだ体格の記録はありません。月が進むと、ここに1か月ごとの変化が残ります。</p>';
    let lastYear = null;
    const rows = log.map((e) => {
      const y = Body.yearOf(e.t), m = Body.monthOf(e.t);
      const head = y !== lastYear ? '<li class="bodylog__year">' + y + '年</li>' : '';
      lastYear = y;
      const stats = Object.keys(e.s || {}).filter((k) => e.s[k]).map((k) =>
        '<span class="bodylog__st">' + BODY_STAT_NAME[k] + signed(e.s[k], k === 'velo' ? 'km/h' : '') + '</span>').join('');
      return head + '<li class="bodylog__row"><span class="bodylog__m">' + m + '月</span>' +
        '<span class="bodylog__b">身長' + signed(Math.round(e.dh * 10) / 10, 'cm') + '</span>' +
        '<span class="bodylog__b">体重' + signed(Math.round(e.dw * 10) / 10, 'kg') + '</span>' + stats + '</li>';
    }).join('');
    return '<ul class="bodylog">' + rows + '</ul>';
  }

  function wireBodyLog(body, p) {
    const btn = body.querySelector('#pd-bodylog');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const detail = body.querySelector('.pdetail');
      if (!detail) return;
      const prevBack = closeModal.back;
      const box = document.createElement('div');
      box.className = 'bodylogbox';
      box.innerHTML = '<h3 class="modal__title">' + esc(p.name) + '　体格の成長履歴</h3>' +
        '<p class="tiny">身長' + Math.round(p.ht * 10) / 10 + 'cm・体重' + Math.round(p.wt * 10) / 10 + 'kg（いま）</p>' +
        '<div class="bodylogscroll">' + bodyLogHtml(p) + '</div>' +
        '<div class="actions actions--modal"><button type="button" class="btn" id="bl-back">選手に戻る</button></div>';
      const back = () => {
        box.remove(); detail.hidden = false; closeModal.back = prevBack;
        const panel = document.querySelector('.modal__body');
        if (panel) panel.scrollTop = 0;
      };
      detail.hidden = true;
      detail.parentNode.insertBefore(box, detail.nextSibling);
      box.querySelector('#bl-back').addEventListener('click', back);
      closeModal.back = back;
      const panel = document.querySelector('.modal__body');
      if (panel) panel.scrollTop = 0;
    });
  }

  /** 名前の書き換えを受け付ける（詳細をどこに描いても使える） */
  function wireRename(body, p, onRename) {
    wireHand(body, p, onRename);
    wireBodyLog(body, p);
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
        if (next && next.classList.contains('lurow')) {
          const nr = next.getBoundingClientRect();
          if (mid > nr.top + nr.height / 2) {
            list.insertBefore(next, drag);
            place();
            if (opt.onMove) opt.onMove(list);
            continue;
          }
        }
        if (prev && prev.classList.contains('lurow')) {
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
     野手18人をひとつづきの並びで出す。上から9人がスタメンで、
     残りが控え。控えの選手を上に持ち上げれば、そのままスタメンに入る。
     守備位置は選手について回るので、1人の守備位置を変えても
     他の選手は動かない。そのかわり重複したら決定を止める。 */

  /** オーダー変更の選手名の下に添える、身長・体重 */
  function bodyTiny(p) {
    return p.ht != null ? ' ' + Math.round(p.ht) + 'cm・' + Math.round(p.wt) + 'kg' : '';
  }

  function lineupEditor(team, onDone) {

    /* 選手ID → 守備位置。'BENCH' なら控え。
       スタメンかどうかは「並びの上から9人」ではなく、守備位置が付いているかで決まる。
       控えの選手に守備位置を付ければ、それだけでスタメンに入る。 */
    const BENCH = 'BENCH';
    const posOf = {};
    team.batters.forEach((p) => { posOf[p.id] = BENCH; });
    team.lineup.forEach((sl) => { posOf[sl.pid] = sl.pos; });

    /* 並び順（18人ぶん）。打順はこの並びのうち、守備位置が付いている人だけで数える */
    let order = team.lineup.map((sl) => sl.pid)
      .concat(team.batters.map((p) => p.id).filter((id) => !team.lineup.some((sl) => sl.pid === id)));

    let picked = null;      // 入れ替えようとして選んだ選手（番号をタップ）
    let lockMsg = '';       // レギュラー確約の選手を外そうとしたときの知らせ
    let tab = 'bat';        // 'bat' か 'pit'

    /* レギュラー確約（regularLock）の選手は、スタメンから外せない。
       外れてしまう操作は、元に戻して知らせる */
    const lockedPlayers = () => team.batters.filter((p) => p.regularLock);
    const snapshot = () => ({ pos: Object.assign({}, posOf), order: order.slice() });
    const restore = (s) => {
      Object.keys(posOf).forEach((k) => { delete posOf[k]; });
      Object.assign(posOf, s.pos);
      order = s.order.slice();
    };
    /** fn で並びを動かし、確約の選手が控えになってしまったら元に戻す。戻したら false */
    const guarded = (fn) => {
      const snap = snapshot();
      fn();
      const bad = lockedPlayers().filter((p) => posOf[p.id] === BENCH);
      if (!bad.length) { lockMsg = ''; return true; }
      restore(snap);
      lockMsg = bad.map((p) => p.name).join('・') + 'は、1年生からレギュラー確約が条件なので、スタメンから外せません（試合中の交代はできます。3年生が引退したあとは控えにできます）。';
      return false;
    };
    let showBad = false;    // 決定を押すまでは赤くしない

    function batterIds() {
      /* 部員が入れ替わっていても落ちないように、毎回そろえ直す */
      const ids = team.batters.map((p) => p.id);
      order = order.filter((id) => ids.indexOf(id) >= 0)
        .concat(ids.filter((id) => order.indexOf(id) < 0));
      order.forEach((id) => { if (posOf[id] == null) posOf[id] = BENCH; });
      /* スタメン（打順どおり）を上、控えを下にそろえる */
      order = order.filter((id) => posOf[id] !== BENCH).concat(order.filter((id) => posOf[id] === BENCH));
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
      const missing = LINEUP_POSITIONS.filter((k) => !used[k]);
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
      const options = ['<option value="' + BENCH + '"' + (bench ? ' selected' : '') + (p.regularLock ? ' disabled' : '') + '>控</option>']
        .concat(LINEUP_POSITIONS.map((k) =>
          '<option value="' + k + '"' + (k === pos ? ' selected' : '') + '>' + posShort(k) + '</option>')).join('');
      const bad = showBad && !bench && prob.dup.indexOf(pos) >= 0;
      return '<li class="lurow' + (bench ? ' is-bench' : '') + (bad ? ' is-bad' : '') + (picked === p.id ? ' is-picked' : '') + '" data-pid="' + p.id + '">' +
        '<span class="lugrip" aria-hidden="true"><i></i><i></i><i></i></span>' +
        '<span class="luno luno--swap" role="button" tabindex="0" title="タップして入れ替え">' + (bench ? '控' : no) + '</span>' +
        '<span class="lupos">' +
          '<select class="possel' + (bench ? ' is-bench' : '') + '" data-pid="' + p.id + '">' +
            options + '</select>' +
        '</span>' +
        '<span class="lumain">' +
          '<button type="button" class="linkbtn pname" data-pid="' + p.id + '">' + esc(p.name) + '</button>' +
          '<span class="tiny">' + p.grade + '年 ' + handMark(p) + bodyTiny(p) + (p.regularLock ? ' <b class="lulock">確約</b>' : '') + '</span>' +
        '</span>' +
        '<span class="lustats lustats--row">' + trajIcon(p.traj) +
          [['ミ', p.meet], ['パ', p.power], ['走', p.speed], ['肩', p.arm], ['守', p.field], ['捕', p.catch]].map((x) =>
            '<span class="lus"><i>' + x[0] + '</i>' + rankNum(x[1]) + '</span>').join('') + '</span>' +
        '<span class="luapts">' + aptRow(p) + '</span>' +
        '<span class="luarrow">' +
          '<button type="button" class="btn btn--tiny up" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
          '<button type="button" class="btn btn--tiny down" data-i="' + i + '"' + (i === order.length - 1 ? ' disabled' : '') + '>▼</button>' +
        '</span>' +
      '</li>';
    }

    function pitRow(pid, i) {
      const p = Team.find(team, pid);
      if (!p) return '';
      return '<li class="lurow" data-pid="' + p.id + '">' +
        '<span class="lugrip" aria-hidden="true"><i></i><i></i><i></i></span>' +
        '<span class="luno luno--wide">' + (i + 1) + '番手' + (team.rotation[0] === p.id ? '<br><small>先発</small>' : '') + '</span>' +
        '<span class="lumain">' +
          '<button type="button" class="linkbtn pname" data-pid="' + p.id + '">' + esc(p.name) + '</button>' +
          '<span class="tiny">' + p.grade + '年 ' + handMark(p) + bodyTiny(p) + '</span>' +
        '</span>' +
        '<span class="lustats">最速<b class="rankval">' + p.velo + '</b>　制' + rankNum(p.control) +
          '　ス' + rankNum(p.stamina) +
          '　体力' + Team.staminaGauge(p) + '</span>' +
        '<span class="luapts lupitch">' + Player.pitchesInOrder(p).map((q) =>
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
      const lockNote = lockMsg ? '<p class="luwarn">' + esc(lockMsg) + '</p>' : '';
      const hint = tab === 'bat'
        ? (picked
          ? '<b>入れ替える相手の番号をタップ</b>してください（もう一度同じ番号をタップすると取り消し）。スタメンと控えを選べば、その打順にそのまま入ります。'
          : '<b>番号をタップして、別の番号をタップすると入れ替え</b>。左の取っ手をつまんで上下に動かすと打順を変えられます。守備位置の欄で「控」を選べば外れます。')
        : '左はしの取っ手をつまんで、投げる順番を並べ替えられます。先発は試合前の画面で選べます。';
      let no = 0, headed = false;
      const startCount = ids.filter((pid) => posOf[pid] !== BENCH).length;
      const list = tab === 'bat'
        ? '<ul class="lulist" id="lu-bat"><li class="luhead">スタメン（打順）</li>' + ids.map((pid, i) => {
            let head = '';
            if (posOf[pid] !== BENCH) no++;
            else if (!headed) { headed = true; head = '<li class="luhead luhead--bench">控え</li>'; }
            return head + batRow(pid, no, prob, i);
          }).join('') + (!headed && startCount ? '' : '') + '</ul>'
        : '<ul class="lulist" id="lu-pit">' + pitOrderOf(team).map(pitRow).join('') + '</ul>';
      return '<div class="lineup-edit">' +
        '<h3 class="modal__title">オーダー変更</h3>' +
        '<div class="lutabs">' +
          '<button type="button" class="lutab' + (tab === 'bat' ? ' is-on' : '') + '" data-tab="bat">打線</button>' +
          '<button type="button" class="lutab' + (tab === 'pit' ? ' is-on' : '') + '" data-tab="pit">投手</button>' +
        '</div>' +
        '<p class="note lineup-hint">' + hint + '</p>' +
        warn + lockNote + list +
        '<div class="actions actions--modal">' +
        '<button type="button" class="btn" id="lu-auto">' +
          (tab === 'bat' ? '野手をおまかせ' : '投手をおまかせ') + '</button>' +
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
        if (list.id === 'lu-pit') {
          no.innerHTML = (i + 1) + '番手' + (team.rotation[0] === li.dataset.pid ? '<br><small>先発</small>' : '');
          return;
        }
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
        onDone: (order) => { setPitOrder(team, order); refresh(); },
      });

      const move = (list, i, d) => {
        const j = i + d;
        if (j < 0 || j >= list.length) return null;
        /* 野手は、スタメンと控えの境目をまたいでは動かさない（入れ替えは番号のタップで） */
        if (list === order && (posOf[list[i]] === BENCH) !== (posOf[list[j]] === BENCH)) return null;
        const next = list.slice();
        [next[i], next[j]] = [next[j], next[i]];
        return next;
      };
      /* ▲▼。同じグループ（スタメンどうし・控えどうし）の中では1つ動かす。
         スタメンの最後の人の▼と、控えの先頭の人の▲は、そのまま入れ替え
         （控えがその打順と守備位置に入る） */
      const nudge = (i, d) => {
        const ids = batterIds().slice();
        const j = i + d;
        if (j < 0 || j >= ids.length) return;
        const a = posOf[ids[i]], b2 = posOf[ids[j]];
        guarded(() => {
          if ((a === BENCH) !== (b2 === BENCH)) { posOf[ids[i]] = b2; posOf[ids[j]] = a; }
        });
        if (!lockMsg) { [ids[i], ids[j]] = [ids[j], ids[i]]; } else { ids.splice(0, ids.length, ...batterIds()); }
        showBad = false;
        applyBatters(ids);
      };
      body.querySelectorAll('.up').forEach((b) => b.addEventListener('click', () => nudge(+b.dataset.i, -1)));
      body.querySelectorAll('.down').forEach((b) => b.addEventListener('click', () => nudge(+b.dataset.i, 1)));
      body.querySelectorAll('.pup').forEach((b) => b.addEventListener('click', () => {
        const next = move(pitOrderOf(team), +b.dataset.i, -1);
        if (next) { setPitOrder(team, next); refresh(); }
      }));
      body.querySelectorAll('.pdown').forEach((b) => b.addEventListener('click', () => {
        const next = move(pitOrderOf(team), +b.dataset.i, 1);
        if (next) { setPitOrder(team, next); refresh(); }
      }));

      /* 守備位置を変えるのは、その選手だけ。
         「控」を選べば外れ、守備位置を選べばスタメンに入る。
         重なりや不足は、決定を押したときにまとめて知らせる */
      body.querySelectorAll('.possel').forEach((sel) => sel.addEventListener('change', () => {
        guarded(() => { posOf[sel.dataset.pid] = sel.value; });
        showBad = false;
        applyBatters();
      }));

      /* 番号をタップして入れ替え。スタメンどうし・控えどうしは並びを、
         スタメンと控えの組なら、控えがその打順と守備位置にそのまま入る */
      body.querySelectorAll('.luno--swap').forEach((n) => {
        const act = () => {
          const pid = n.closest('.lurow').dataset.pid;
          if (!picked) { picked = pid; refresh(); return; }
          if (picked === pid) { picked = null; refresh(); return; }
          const ids = batterIds().slice();
          const i = ids.indexOf(picked), j = ids.indexOf(pid);
          const a = posOf[picked], b = posOf[pid];
          guarded(() => {
            if ((a === BENCH) !== (b === BENCH)) { posOf[picked] = b; posOf[pid] = a; }
          });
          if (!lockMsg) { [ids[i], ids[j]] = [ids[j], ids[i]]; } else { ids.splice(0, ids.length, ...batterIds()); }
          picked = null;
          showBad = false;
          applyBatters(ids);
        };
        n.addEventListener('click', act);
        n.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
      });

      body.querySelectorAll('.pname').forEach((b) =>
        b.addEventListener('click', () => openDetail(b.dataset.pid)));

      /* おまかせは、いま開いている面だけを組み直す。
         打線を直したいのに投げる順番まで変わってしまうと、
         せっかく決めた継投が消えてしまうため */
      const auto = body.querySelector('#lu-auto');
      if (auto) auto.addEventListener('click', () => {
        if (tab === 'pit') {
          Team.autoRotation(team);
          team.pitcherOrder = null;
        } else {
          /* autoLineup は投げる順番まで組み直すので、そこは戻しておく */
          const keep = (team.rotation || []).slice();
          const keepOrder = team.pitcherOrder ? team.pitcherOrder.slice() : null;
          lockMsg = '';
          Team.autoLineup(team);
          if (keep.length) team.rotation = keep;
          team.pitcherOrder = keepOrder;
          team.batters.forEach((p) => { posOf[p.id] = BENCH; });
          team.lineup.forEach((sl) => { posOf[sl.pid] = sl.pos; });
          order = team.lineup.map((sl) => sl.pid)
            .concat(team.batters.map((p) => p.id).filter((id) => posOf[id] === BENCH));
          showBad = false;
        }
        refresh();
      });
      const done = body.querySelector('#lu-done');
      if (done) done.addEventListener('click', () => {
        /* 重なりと不足は、決定を押したときにはじめて知らせる */
        const prob = problems();
        if (prob.dup.length || prob.missing.length || prob.count !== 9) {
          showBad = true; tab = 'bat'; refresh(); scrollTop(); return;
        }
        /* 決定は「ここまでの並びを確定する」だけで、画面は閉じない。
           打線を決めてから投手タブも見たい、ということがあるため。
           実際に閉じる（×・枠の外をタップ）ときに onDone を呼ぶ */
        showBad = false;
        commit();
        refresh();
        scrollTop();
      });
    }

    /* 決定（並びの確定、不備があるときの警告表示も含む）を押したら、
       一覧の下のほうを見ていても画面の先頭へ戻す */
    function scrollTop() {
      const panel = document.querySelector('.modal__body');
      if (panel) panel.scrollTop = 0;
    }

    closeModal.back = null;
    closeModal.after = () => { if (onDone) onDone(); };
    modal(render(), { kind: 'lineup', onOpen(body) { wire(body); } });
  }

  /** プロでの成績の表。新しい年が上、点線を挟んで最後に通算。タイトル級の数字は太字 */
  function proSection(x) {
    const pro = x.pro;
    if (!pro) return '';
    const isPit = x.player.kind === 'pitcher';
    const first = Body.START_YEAR + x.year;
    const head = '<h4 class="sub">プロでの成績<span class="sub__note">' + first + '年が1年目</span></h4>';
    const shown = pro.seasons.slice(0, x.shown || 0);
    if (!shown.length) {
      return head + '<p class="note">' + (x.year + 1) + '年目の秋の大会が終わると、プロ1年目（' + first + '年）の成績が見られます。</p>';
    }
    const cols = isPit
      ? [['試合', 'g'], ['投球回', 'ip'], ['勝', 'w'], ['敗', 'l'], ['防御率', 'era'], ['奪三振', 'so'], ['WAR', 'war']]
      : [['試合', 'g'], ['打席', 'pa'], ['打率', 'avg'], ['本塁打', 'hr'], ['打点', 'rbi'], ['OPS', 'ops'], ['盗塁', 'sb'], ['WAR', 'war']];
    const cell = (v, k, bold) => {
      const t = k === 'ip' ? ipText(v) : v;
      return '<td>' + (bold && bold[k] ? '<b class="pro__title">' + t + '</b>' : t) + '</td>';
    };
    const rows = shown.slice().reverse().map((s) => {
      const v = Pro.rowView(s, isPit);
      return '<tr><th scope="row">' + s.y + '</th>' + cols.map((c) => cell(v[c[1]], c[1], v.bold)).join('') + '</tr>';
    }).join('');
    const tv = Pro.totalView(shown, isPit);
    const total = '<tr class="pro__total"><th scope="row">通算</th>' + cols.map((c) => cell(tv[c[1]], c[1])).join('') + '</tr>';
    /* プロで取った個人タイトルと、その年（太字になった数字と同じ基準） */
    const TITLE_NAME = isPit
      ? [['w', '最多勝'], ['era', '最優秀防御率'], ['so', '最多奪三振']]
      : [['avg', '首位打者'], ['hr', '本塁打王'], ['rbi', '打点王'], ['sb', '盗塁王']];
    const titles = TITLE_NAME.map((t) => {
      const years = shown.filter((sn) => Pro.rowView(sn, isPit).bold[t[0]]).map((sn) => sn.y + '年');
      return years.length ? t[1] + '（' + years.join('・') + '）' : null;
    }).filter(Boolean);
    const titleLine = '<p class="pro__titles"><b>個人タイトル</b>　' +
      (titles.length ? titles.map(esc).join('　') : 'なし') + '</p>';
    const done = shown.length >= pro.seasons.length
      ? '<p class="tiny">' + shown[shown.length - 1].y + '年限りで現役を引退しました。</p>'
      : '<p class="tiny">毎年、秋の大会が終わると1年ぶん増えます。太字はタイトル級の数字です。</p>';
    return head + titleLine + '<div class="protable-wrap"><table class="protable"><thead><tr><th>年</th>' +
      cols.map((c) => '<th>' + c[0] + '</th>').join('') + '</tr></thead><tbody>' + rows + total + '</tbody></table></div>' + done;
  }

  /** プロ入りした選手の一覧（info から）。名前を押すと、能力・通算成績・活躍シーンが見られる */
  function prosList(list) {
    const sorted = list.slice().sort((a, b) => (a.year - b.year) || (a.round - b.round));
    const row = (x, i) => {
      const p = x.player;
      return '<li class="proslist__row"><button type="button" class="linkbtn pname" data-i="' + i + '">' + esc(p.name) + '</button>' +
        '<span class="proslist__meta">' + (p.kind === 'pitcher' ? '投手' : posName(p.pos)) + '　' + handMark(p) + '</span>' +
        '<em class="retire__draft">' + esc(x.text) + '</em>' +
        '<span class="proslist__sub">' + esc(x.school || '') + '　' + x.year + '年目</span></li>';
    };
    const show = () => {
      closeModal.back = null;
      html('modal-body',
        '<h3 class="modal__title">プロ入りした選手（' + sorted.length + '人）</h3>' +
        (sorted.length
          ? '<ul class="proslist">' + sorted.map(row).join('') + '</ul>'
          : '<p class="note">まだプロ入りした選手はいません。引退する3年生が、ドラフトで指名されると、ここに残ります。</p>'));
      el('modal-body').querySelectorAll('.pname').forEach((b) => b.addEventListener('click', () => {
        const x = sorted[+b.dataset.i];
        Body.ensure(x.player);
        html('modal-body',
          '<p class="proslist__tag"><em class="retire__draft">' + esc(x.text) + '</em>　' + esc(x.school || '') + '　' + x.year + '年目</p>' +
          playerDetail(x.player, { rename: false }) + proSection(x) +
          '<div class="actions actions--modal"><button type="button" class="btn" id="pl-back">一覧に戻る</button></div>');
        wireBodyLog(el('modal-body'), x.player);
        el('modal-body').querySelector('#pl-back').addEventListener('click', show);
        closeModal.back = show;
      }));
    };
    modal('', { kind: 'pros', onOpen() { show(); } });
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
    pitOrderOf,
    el, esc, html, show, currentScreen, curtain, modal, closeModal, confirmBox, prosList, decisionLines,
    avg, era, ipText, trajIcon, stat, rankSpan, rankNum, aptSpan, pullText, handMark,
    playerRow, rosterTable, rosterPanel, sortPlayers, playerDetail, openPlayer,
    lineupEditor, roleText, makeSortable, wireRename, captainPicker,
    careerBatLine, careerPitLine, init,
  };
})();
