/* ==================================================
   高校野球  screens.js

   試合以外の画面。描くのはここ、進行の判断は main.js。
   ================================================== */
'use strict';

const Screens = (() => {

  const esc = UI.esc;

  /* 進行を保存する合図。main.js が入れる。
     キャプテンのように画面の中で決まるものは、ここを通して保存する */
  let onChange = () => {};
  function setOnChange(fn) { onChange = fn || (() => {}); }

  /* ---------- データセット選択 ---------- */

  function gradeText(byGrade) {
    return [1, 2, 3].filter((g) => byGrade[g]).map((g) => g + '年' + byGrade[g] + '人').join('・');
  }

  function pick(opt) {
    UI.el('pick-title').textContent = opt.title;
    UI.el('pick-lead').textContent = opt.lead || '';
    /* 呼び方は画面ごとに変わる（チーム作りなら「チーム1」、新入生なら「候補1」） */
    const setLabel = opt.setLabel || 'チーム';
    const pickLabel = opt.pickLabel || 'このチームにする';

    const html = opt.sets.map((players, i) => {
      const s = Dataset.summary(players);
      return '<article class="dataset">' +
        '<header class="dataset__head">' +
          '<h3 class="dataset__no">' + esc(setLabel) + ' ' + (i + 1) + '</h3>' +
          '<p class="dataset__meta">' + s.count + '人　' + gradeText(s.byGrade) +
            '　<span class="dataset__best">注目： ' + esc(s.best.name) + '（' + s.best.grade + '年）</span></p>' +
          '<button type="button" class="btn btn--primary dataset__pick" data-i="' + i + '">' + esc(pickLabel) + '</button>' +
        '</header>' +
        UI.rosterTable(players) +
      '</article>';
    }).join('');
    UI.html('pick-list', html);

    const list = UI.el('pick-list');
    list.querySelectorAll('.dataset__pick').forEach((b) =>
      b.addEventListener('click', () => opt.onSelect(+b.dataset.i)));
    bindRows(list, (pid) => {
      for (const set of opt.sets) {
        const p = set.find((x) => x.id === pid);
        if (p) { UI.openPlayer(p, { rename: false }); return; }
      }
    });
    UI.show('screen-pick');
  }

  /** 表の行を押したら選手の詳細を開く */
  function bindRows(root, resolve) {
    root.querySelectorAll('tr.prow').forEach((tr) =>
      tr.addEventListener('click', () => resolve(tr.dataset.pid)));
  }

  /* ---------- チーム完成 ---------- */

  function ready(state) {
    const t = state.team;
    const html =
      '<p class="section-lead">' + esc(t.name) + '　部員' + Team.all(t).length + '人　' +
        'チーム力 <b>' + Team.strength(t) + '</b></p>' +
      captainBox(t) +
      lineupCard(t) +
      '<h3 class="sub">野手</h3><div id="ready-bat"></div>' +
      '<h3 class="sub">投手</h3><div id="ready-pit"></div>' +
      '<label class="field field--check field--boxed">' +
        '<input type="checkbox" id="ready-poach"' + (state.settings.poach ? ' checked' : '') + '>' +
        '<span>敗戦時、相手チームに選手を引き抜かれる<i>（外すと引き抜かれません）</i></span>' +
      '</label>';
    UI.html('ready-body', html);
    const body = UI.el('ready-body');
    const open = (pid) => {
      const p = Team.find(t, pid);
      if (p) UI.openPlayer(p, { team: t, onRename: () => ready(state) });
    };
    UI.rosterPanel(UI.el('ready-bat'), t.batters, { team: t, onRow: open });
    UI.rosterPanel(UI.el('ready-pit'), t.pitchers, { team: t, onRow: open });
    bindRows(body, open);
    body.querySelector('#ready-poach').addEventListener('change', (e) => {
      state.settings.poach = e.target.checked;
      Storage.saveSettings(state.settings);
    });
    wireCaptain(body, t, () => ready(state));
    gateTraining(t);
    UI.show('screen-ready');
  }

  /** キャプテンの欄。決まっていなければ赤くする。
      leaving を渡すと、そこに入っている選手は「これから引退する」扱いにする */
  function captainBox(t, leaving) {
    const cap = Team.captain(t);
    const out = cap && leaving && leaving.indexOf(cap.id) >= 0;
    const ok = cap && !out;
    return '<div class="capbox' + (ok ? '' : ' is-empty') + '">' +
      '<div class="capbox__label">キャプテン</div>' +
      (ok
        ? '<div class="capbox__name"><b>' + esc(cap.name) + '</b>' +
          '<span>' + cap.grade + '年・' + UI.roleText(t, cap) + '</span></div>'
        : (out
            ? '<div class="capbox__none"><b>' + esc(cap.name) + '</b> は引退します</div>'
            : '<div class="capbox__none">まだ決まっていません</div>')) +
      '<button type="button" class="btn btn--small" id="btn-captain">' +
        (ok ? '変える' : 'キャプテンを決める') + '</button>' +
    '</div>';
  }

  /** キャプテンの欄のボタンをつなぐ */
  function wireCaptain(root, team, onDone, exclude) {
    const b = root.querySelector('#btn-captain');
    if (b) b.addEventListener('click', () => UI.captainPicker(team, () => {
      onChange();          // 決めた時点で保存する
      if (onDone) onDone();
    }, { exclude: exclude }));
  }

  /** キャプテンが決まるまで「特訓へ」を押せなくする */
  function gateTraining(team) {
    const btn = UI.el('btn-ready-next');
    if (!btn) return;
    const ok = !!Team.captain(team);
    btn.disabled = !ok;
    btn.textContent = ok ? '特訓へ' : 'キャプテンを決めてください';
  }

  /** スタメン9人と先発投手。opts.pickable なら先発を選べるようにする */
  function lineupCard(t, opts) {
    opts = opts || {};
    const rows = t.lineup.map((s, i) => {
      const p = Team.find(t, s.pid);
      if (!p) return '';
      return '<tr class="prow" data-pid="' + p.id + '"><td class="c ord">' + (i + 1) + '</td>' +
        '<td class="c">' + posShort(s.pos) + '</td>' +
        '<td class="nm">' + esc(p.name) + '</td>' +
        '<td class="c tiny">' + p.grade + '年</td>' +
        '<td class="c tiny">' + UI.handMark(p) + '</td>' +
        '<td class="c tiny">' + UI.rankNum(p.meet) + ' ' + UI.rankNum(p.power) + ' ' + UI.rankNum(p.speed) + '</td></tr>';
    }).join('');
    /* 数字の列が何なのかは、見出しを付けないと分からない */
    const head =
      '<thead><tr>' +
        '<th class="c">打順</th><th class="c">守備</th><th class="nm">選手</th>' +
        '<th class="c tiny">学年</th><th class="c tiny">投打</th>' +
        '<th class="c tiny">ミート　パワー　走力</th>' +
      '</tr></thead>';
    const sp = Team.find(t, t.rotation[0]);
    return '<div class="lineupcard' + (opts.compact ? ' is-compact' : '') + '">' +
      '<h3 class="lineupcard__title">' + esc(t.name) + '</h3>' +
      '<div class="tablewrap"><table class="lineup">' + head + '<tbody>' + rows + '</tbody></table></div>' +
      (sp ? '<p class="lineupcard__p">先発　' +
        '<button type="button" class="linkbtn pitname" data-pid="' + sp.id + '">' + esc(sp.name) + '</button>' +
        '<span class="spmeta">' +
          sp.grade + '年・' + (sp.throws === 'L' ? '左' : '右') +
          '　球速 <b class="rankval">' + sp.velo + '</b>km/h' +
          '　制球 ' + UI.rankNum(sp.control) +
          '　スタミナ ' + UI.rankNum(sp.stamina) +
          '　<span class="spfat' + (sp.fatigue >= 40 ? ' is-tired' : '') + '">' +
            esc(Team.fatigueLabel(sp)) + '</span>' +
        '</span>' +
        '<span class="spballs">' + pitchText(sp) + '</span></p>' : '') +
      (opts.pickable ? starterPicker(t) : '') +
      '</div>';
  }

  /** 変化球を「名前＋切れ味」で並べる */
  function pitchText(p) {
    if (!p.pitches || !p.pitches.length) return '―';
    return p.pitches.map((q) =>
      '<span class="pball">' + esc(q.name) + '<b>' + q.level + '</b></span>').join('');
  }

  /** 先発を選ぶ列。試合前の画面だけに出す */
  function starterPicker(t) {
    const rot = (t.rotation || []).map((id) => Team.find(t, id)).filter(Boolean);
    if (rot.length < 2) return '';
    return '<div class="spick">' +
      '<div class="spick__head">先発を選ぶ</div>' +
      '<div class="spick__list">' + rot.map((p, i) =>
        '<button type="button" class="spick__item' + (i === 0 ? ' is-on' : '') + '" data-pid="' + p.id + '">' +
          '<span class="spick__nm">' + esc(p.name) + '</span>' +
          '<span class="spick__fat' + (p.fatigue >= 40 ? ' is-tired' : '') + '">' +
            esc(Team.fatigueLabel(p)) + '</span>' +
          '<span class="spick__meta">' + p.grade + '年・' + (p.throws === 'L' ? '左' : '右') +
            '　球速 <b class="rankval">' + p.velo + '</b>km/h' +
            '　制球 ' + UI.rankNum(p.control) + '　スタミナ ' + UI.rankNum(p.stamina) + '</span>' +
          '<span class="spick__balls">' + pitchText(p) + '</span>' +
        '</button>').join('') +
      '</div></div>';
  }

  /* ---------- 特訓期間 ---------- */

  function trainingIntro(state) {
    const t = state.team;
    const cap = Team.captain(t);
    UI.html('trainintro-body',
      '<p class="nextup__eyebrow">' + state.year + '年目</p>' +
      '<h2 class="nextup__title">特訓期間</h2>' +
      '<p class="nextup__vs">新入生を迎えた' + esc(t.name) + 'の、夏までの練習が始まる。</p>' +
      captainBox(t) +
      /* キャプテンが決まるまでは先へ進ませない。
         画面をタップすると特訓に入るので、注意書きも出す */
      (cap
        ? '<p class="taphint taphint--static">タップで特訓へ</p>'
        : '<p class="capwarn">キャプテンを決めると特訓に進めます</p>'));
    wireCaptain(UI.el('trainintro-body'), t, () => trainingIntro(state));
    UI.show('screen-trainintro');
  }

  /* ---------- 特訓 ---------- */

  function training(state) {
    const st = state.training;
    UI.el('train-picks').textContent = st.picks;
    UI.el('train-picks-max').textContent = CONFIG.TRAINING.PICKS;
    UI.el('train-passes').textContent = st.passes;
    UI.el('train-passes-max').textContent = CONFIG.TRAINING.PASSES;

    const card = st.card;
    if (card) {
      /* 並びはオーダー順。カードの中で誰が主力なのか分かりやすくする。
         複数の能力が上がるカードでは同じ選手が2行に分かれるので、先にまとめる */
      const order = orderIndex(state.team);
      const groups = [];
      const seen = new Map();
      card.targets.forEach((t) => {
        if (!seen.has(t.pid)) { const g = { pid: t.pid, ups: [] }; seen.set(t.pid, g); groups.push(g); }
        seen.get(t.pid).ups.push(t);
      });
      groups.sort((a, b) =>
        (order[a.pid] == null ? 99 : order[a.pid]) - (order[b.pid] == null ? 99 : order[b.pid]));
      const lines = groups.map((g) => {
        const p = Team.find(state.team, g.pid);
        if (!p) return '';
        const ups = g.ups.map((t) =>
          esc(t.label) + ' +' + t.amount + (t.unit ? esc(t.unit) : '')).join('　');
        return '<li class="tcard">' +
          '<div class="tcard__head"><b>' + esc(p.name) + '</b>' +
            '<span>' + p.grade + '年・' + UI.roleText(state.team, p) + '</span>' +
            '<em class="tcard__up">' + ups + '</em>' +
          '</div>' +
          '<div class="tcard__stats">' + statChips(p, g.ups) + '</div>' +
        '</li>';
      }).join('');
      UI.html('train-card',
        '<div class="traincard traincard--' + card.tier + (card.multi ? ' is-multi' : '') + '">' +
          '<p class="traincard__kind">' + esc(card.title) +
            '<span class="traincard__n">' + groups.length + '人</span>' +
            (card.multi ? '<span class="traincard__multi">複数</span>' : '') +
            (card.tierLabel ? '<span class="traincard__tier">' + esc(card.tierLabel) + '</span>' : '') +
          '</p>' +
          '<ul class="traincard__list">' + lines + '</ul>' +
        '</div>');
    } else {
      UI.html('train-card', '');
    }

    const passBtn = UI.el('btn-train-pass');
    const left = CONFIG.TRAINING.PASSES - st.passes;
    passBtn.disabled = !Training.canPass(st);
    passBtn.textContent = left > 0 ? '見送る（あと' + left + '回）' : '見送れません';
    UI.show('screen-training');
  }

  /** 選手ID → オーダーでの並び順。控えと投手は後ろに回す */
  function orderIndex(team) {
    const map = {};
    team.lineup.forEach((sl, i) => { map[sl.pid] = i; });
    (team.rotation || []).forEach((id, i) => { if (map[id] == null) map[id] = 20 + i; });
    team.batters.forEach((p) => { if (map[p.id] == null) map[p.id] = 10; });
    return map;
  }

  /**
   * 能力をひと通り並べる。上がるものだけ「いま → 上がったあと」で出し、
   * 残りはいまの値をそのまま添える。能力の評価には色を付ける。
   */
  /** ups は「この選手が今回上がるぶん」の一覧（「複数」のカードでは2つ入る） */
  function statChips(p, ups) {
    const list = Array.isArray(ups) ? ups : [ups];
    /* その能力が上がるなら上がり幅、上がらないなら null */
    const amt = (key) => {
      const t = list.find((x) => x.key === key);
      return t ? t.amount : null;
    };
    const chip = (label, key, now, after, unit) => {
      const up = after != null && after !== now;
      const body = up
        ? UI.rankNum(now) + '<em>→</em>' + UI.rankNum(after)
        : UI.rankNum(now);
      return '<span class="ts' + (up ? ' is-up' : '') + '"><i>' + esc(label) + '</i>' + body + '</span>';
    };
    const plain = (label, now, after, unit) => {
      const up = after != null && after !== now;
      return '<span class="ts' + (up ? ' is-up' : '') + '"><i>' + esc(label) + '</i>' +
        '<b class="rankval">' + now + '</b>' + (up ? '<em>→</em><b class="rankval">' + after + '</b>' : '') +
        (unit ? esc(unit) : '') + '</span>';
    };

    if (p.kind === 'pitcher') {
      const vUp = amt('velo');
      const out = [
        plain('最速', p.velo, vUp == null ? null : Math.min(168, p.velo + vUp), 'km/h'),
        chip('制球', 'control', p.control,
          amt('control') == null ? null : RNG.stat(p.control + amt('control'))),
        chip('スタミナ', 'stamina', p.stamina,
          amt('stamina') == null ? null : RNG.stat(p.stamina + amt('stamina'))),
      ];
      p.pitches.forEach((q) => {
        const t = list.find((x) => x.key === 'pitch' && x.pitch === q.name);
        out.push(plain(q.name, q.level, t ? Math.min(7, q.level + t.amount) : null));
      });
      const np = list.find((x) => x.key === 'newpitch');
      if (np) out.push('<span class="ts is-up"><i>' + esc(np.pitch) + '</i><b class="rankval">新</b><em>→</em><b class="rankval">' + np.amount + '</b></span>');
      return out.join('');
    }

    const stat = (label, key) =>
      chip(label, key, p[key], amt(key) == null ? null : RNG.stat(p[key] + amt(key)));
    const trUp = amt('traj');
    return [
      stat('ミート', 'meet'), stat('パワー', 'power'), stat('走力', 'speed'),
      stat('肩力', 'arm'), stat('守備', 'field'), stat('捕球', 'catch'),
      plain('弾道', p.traj, trUp == null ? null : Math.min(4, p.traj + trUp)),
    ].join('');
  }

  /** いまの能力をひと並びに。特訓で「誰を伸ばすか」を決める材料 */
  function abilityLine(p) {
    if (p.kind === 'pitcher') {
      return '最速<b class="rankval">' + p.velo + '</b>km/h　制球' + UI.rankNum(p.control) +
        '　スタミナ' + UI.rankNum(p.stamina) +
        '　' + esc(p.pitches.map((q) => q.name + q.level).join('・'));
    }
    return 'ミート' + UI.rankNum(p.meet) + '　パワー' + UI.rankNum(p.power) +
      '　走力' + UI.rankNum(p.speed) + '　肩' + UI.rankNum(p.arm) +
      '　守備' + UI.rankNum(p.field) + '　捕球' + UI.rankNum(p.catch) +
      '　弾道<b class="rankval">' + p.traj + '</b>';
  }

  function currentValue(p, t) {
    if (t.key === 'traj') return '弾道 ' + p.traj + ' → ' + Math.min(4, p.traj + t.amount);
    if (t.key === 'velo') return p.velo + ' → ' + Math.min(168, p.velo + t.amount) + 'km/h';
    if (t.key === 'pitch') {
      const q = p.pitches.find((x) => x.name === t.pitch);
      return q ? q.level + ' → ' + Math.min(7, q.level + t.amount) : '';
    }
    if (t.key === 'newpitch') return '新しく習得';
    return rankOf(p[t.key]) + ' ' + p[t.key] + ' → ' + rankOf(Math.min(100, p[t.key] + t.amount)) + ' ' + Math.min(100, p[t.key] + t.amount);
  }

  function trainingResult(state, nextLabel) {
    const rows = Training.summarize(state.training);
    const html = rows.length
      ? '<div class="tablewrap"><table class="growth"><thead><tr><th class="nm">選手</th><th>年</th><th>項目</th><th>上がり幅</th><th>変化</th></tr></thead><tbody>' +
        rows.map((r) => '<tr><td class="nm">' + esc(r.name) + '</td><td class="c">' + r.grade + '</td>' +
          '<td>' + esc(r.label) + '</td>' +
          '<td class="c up"><b class="gr__up">+' + r.amount + (r.unit ? esc(r.unit) : '') + '</b></td>' +
          '<td class="c">' + upText(r) + '</td></tr>').join('') +
        '</tbody></table></div>'
      : '<p class="note">今回は伸びた選手がいませんでした。</p>';
    UI.html('train-result', html);
    UI.el('btn-train-done').textContent = nextLabel;
    UI.show('screen-training-result');
  }

  /* ---------- 大会開幕 ---------- */

  function opening(state) {
    const isNational = state.tour.kind === 'national';
    const name = isNational ? state.settings.nationalName : '地方大会';
    UI.el('opening-year').textContent = state.year + '年目';
    UI.el('opening-title').textContent = name + ' 開幕';
    UI.el('opening-lead').textContent = isNational
      ? '全国の頂点まであと7つ。' + esc(state.team.name) + '、初戦へ。'
      : esc(state.team.name) + '、夏の地方大会へ。勝ち上がれば' + state.settings.nationalName + '。';
    UI.show('screen-opening');
  }

  /* ---------- 試合開始前 ---------- */

  function pregame(state, opts) {
    const r = Tournament.currentRound(state.tour);
    const label = (state.tour.kind === 'national' ? state.settings.nationalName : '地方大会');
    UI.el('pregame-title').textContent = label + '　' + r.name;
    const html =
      /* 相手のチーム力は出さない。オーダーと能力を見て、自分で見積もってもらう */
      '<p class="section-lead vs">' + esc(state.team.name) + '　<i>対</i>　' + esc(state.opponent.name) + '</p>' +
      '<div class="twocol">' + lineupCard(state.team, { pickable: true }) +
        lineupCard(state.opponent) + '</div>';
    UI.html('pregame-body', html);
    const body = UI.el('pregame-body');
    const open = (pid) => {
      const p = Team.find(state.team, pid) || Team.find(state.opponent, pid);
      if (p) UI.openPlayer(p, { team: state.team, rename: !!Team.find(state.team, pid), onRename: () => pregame(state, opts) });
    };
    bindRows(body, open);
    body.querySelectorAll('.pitname').forEach((b) =>
      b.addEventListener('click', () => open(b.dataset.pid)));
    /* 先発を選ぶ。押された投手を起用順のいちばん前に持ってくる */
    body.querySelectorAll('.spick__item').forEach((b) => {
      b.addEventListener('click', () => {
        const pid = b.dataset.pid;
        const rot = state.team.rotation.slice();
        const i = rot.indexOf(pid);
        if (i <= 0) return;
        rot.splice(i, 1); rot.unshift(pid);
        state.team.rotation = rot;
        if (opts && opts.onChange) opts.onChange();
        pregame(state, opts);
      });
    });
    UI.show('screen-pregame');
  }

  /* ---------- 勝敗 ---------- */

  function verdict(state) {
    const r = state.lastResult;
    const win = r.win;
    UI.html('verdict-body',
      '<div class="verdict__box' + (win ? ' is-win' : ' is-lose') + '">' +
        '<p class="verdict__where">' + esc(r.tourName) + '　' + esc(r.round) + '</p>' +
        '<h2 class="verdict__word">' + (win ? '勝利' : '敗戦') + '</h2>' +
        '<p class="verdict__score">' + esc(state.team.name) + ' <b>' + r.myRuns + '</b>' +
          ' - <b>' + r.opRuns + '</b> ' + esc(r.oppName) + '</p>' +
        (r.cold ? '<p class="verdict__note">コールドゲーム</p>' :
          (r.walkoff ? '<p class="verdict__note">サヨナラ</p>' : '')) +
        (win
          ? (r.last ? '<p class="verdict__lead">' + esc(r.tourName) + '　優勝。</p>'
                    : '<p class="verdict__lead">次の試合へ進む。</p>')
          : '<p class="verdict__lead">ここで終わり。オフシーズンへ。</p>') +
      '</div>');
    UI.show('screen-verdict');
  }

  /* ---------- 試合後の成長 ---------- */

  /** 「いくつ上がって、いくつになったか」。能力なら評価の文字も添える */
  function upText(u) {
    if (u.key === 'newpitch') {
      return '<span class="gr__to">習得（' + u.after + '）</span>';
    }
    if (u.key === 'velo') {
      return '<span class="gr__from">' + u.before + '</span>→<span class="gr__to">' + u.after + '</span>km/h';
    }
    if (u.key === 'traj') {
      return '<span class="gr__from">' + u.before + '</span>→<span class="gr__to">' + u.after + '</span>';
    }
    if (u.key === 'pitch') {
      return '<span class="gr__from">' + u.before + '</span>→<span class="gr__to">' + u.after + '</span>';
    }
    return '<span class="gr__from">' + rankOf(u.before) + ' ' + u.before + '</span>→' +
      '<span class="gr__to">' + UI.rankNum(u.after) + '</span>';
  }

  function growth(state) {
    const report = (state.lastReport || []).filter((r) => r.ups && r.ups.length);
    const awake = report.filter((r) => r.awakened);
    const grew = report.filter((r) => !r.awakened);

    const card = (r) => '<article class="gr' + (r.awakened ? ' is-awake' : '') + '">' +
      '<header class="gr__head"><b>' + esc(r.name) + '</b>' +
        '<span>' + r.grade + '年・' + esc(r.role || '') + '</span>' +
        (r.awakened ? '<em class="gr__awake">覚醒</em>' : '') + '</header>' +
      '<ul class="gr__list">' + r.ups.map((u) =>
        '<li><span class="gr__label">' + esc(u.label) + '</span>' +
        '<span class="gr__up">+' + u.amount + (u.unit ? esc(u.unit) : '') + '</span>' +
        '<span class="gr__val">' + upText(u) + '</span></li>').join('') +
      '</ul></article>';

    const html =
      (awake.length
        ? '<div class="awakebox"><h4 class="awakebox__title">覚醒</h4>' +
          awake.map((r) => '<p class="awakebox__line"><b>' + esc(r.name) + '</b>（' + r.grade +
            '年）が覚醒した！</p>').join('') + '</div>'
        : '') +
      (report.length
        ? '<div class="grlist">' + awake.map(card).join('') + grew.map(card).join('') + '</div>'
        : '<p class="note">今回は伸びた選手がいませんでした。</p>');
    UI.html('growth-body', html);
    UI.show('screen-growth');
  }

  /* ---------- 次の試合のお知らせ ---------- */

  function nextUp(state) {
    const r = Tournament.currentRound(state.tour);
    const label = state.tour.kind === 'national' ? state.settings.nationalName : '地方大会';
    UI.html('nextup-body',
      '<p class="nextup__eyebrow">次の試合</p>' +
      '<h2 class="nextup__title">' + esc(label) + '　' + esc(r.name) + '</h2>' +
      '<p class="nextup__vs">' + esc(state.team.name) + '　対　<b>' + esc(r.schoolName) + '</b></p>');
    UI.show('screen-nextup');
  }

  /* ---------- 引き抜き ---------- */

  function poachWin(state, onTake, onSkip) {
    let picked = null;
    UI.el('poach-title').textContent = '引き抜き';
    UI.el('poach-lead').textContent =
      esc(state.opponent.name) + 'から1人、自校に引き抜けます。選手を選んでから下のボタンを押してください。' +
      '引き抜くと、同じ区分（野手／投手）の部員を1人放出します。';
    UI.html('poach-body',
      '<h3 class="sub">' + esc(state.opponent.name) + '　野手</h3><div id="poach-bat"></div>' +
      '<h3 class="sub">' + esc(state.opponent.name) + '　投手</h3><div id="poach-pit"></div>');

    /* 決勝のあとには次の試合が無いので、そのときだけ言い方を変える */
    const more = state.tour.index < state.tour.rounds.length - 1;
    const ok = UI.el('btn-poach-ok');
    const skip = UI.el('btn-poach-skip');
    ok.textContent = more ? '引き抜いて次の試合へ' : '引き抜いて次へ';
    ok.hidden = false;
    ok.disabled = true;
    skip.hidden = false;
    skip.textContent = more ? '引き抜かず次の試合へ' : '引き抜かず次へ';

    const body = UI.el('poach-body');
    const choose = (pid) => {
      body.querySelectorAll('tr.prow').forEach((x) => x.classList.remove('is-picked'));
      body.querySelectorAll('tr.prow[data-pid="' + pid + '"]').forEach((x) => x.classList.add('is-picked'));
      picked = Team.find(state.opponent, pid);
      ok.disabled = !picked;
      if (picked) UI.el('poach-lead').textContent =
        picked.name + '（' + picked.grade + '年・' +
        (picked.kind === 'pitcher' ? '投手' : posName(picked.pos)) + '）を引き抜きます。';
    };
    UI.rosterPanel(UI.el('poach-bat'), state.opponent.batters, { team: state.opponent, onRow: choose });
    UI.rosterPanel(UI.el('poach-pit'), state.opponent.pitchers, { team: state.opponent, onRow: choose });
    ok.onclick = () => { if (picked) onTake(picked); };
    skip.onclick = onSkip;
    UI.show('screen-poach');
  }

  /** 引き抜いた選手と入れ替えに出す部員を選ぶ */
  function poachRelease(state, incoming, onRelease, onCancel) {
    let picked = null;
    UI.el('poach-title').textContent = esc(incoming.name) + ' を迎える';
    UI.el('poach-lead').textContent = '放出する' + (incoming.kind === 'pitcher' ? '投手' : '野手') + 'を1人選んでください。';
    const own = incoming.kind === 'pitcher' ? state.team.pitchers : state.team.batters;
    UI.html('poach-body',
      '<div class="incoming">' + UI.playerDetail(incoming, { rename: false }) + '</div>' +
      '<h3 class="sub">放出する選手を選ぶ</h3><div id="poach-own"></div>');

    const more = state.tour.index < state.tour.rounds.length - 1;
    const ok = UI.el('btn-poach-ok');
    const skip = UI.el('btn-poach-skip');
    ok.textContent = more ? '放出して次の試合へ' : '放出して次へ';
    ok.hidden = false;
    ok.disabled = true;
    skip.hidden = false;
    skip.textContent = '選び直す';

    const body = UI.el('poach-body');
    UI.rosterPanel(UI.el('poach-own'), own, {
      team: state.team,
      onRow: (pid) => {
        body.querySelectorAll('tr.prow').forEach((x) => x.classList.remove('is-picked'));
        body.querySelectorAll('tr.prow[data-pid="' + pid + '"]').forEach((x) => x.classList.add('is-picked'));
        picked = Team.find(state.team, pid);
        ok.disabled = !picked;
        if (picked) UI.el('poach-lead').textContent =
          picked.name + '（' + UI.roleText(state.team, picked) + '）を放出します。';
      },
    });
    ok.onclick = () => { if (picked) onRelease(picked); };
    skip.onclick = onCancel;
    UI.show('screen-poach');
  }

  /* ---------- 全国優勝 ---------- */

  function champion(state) {
    const t = state.team;
    const best = Team.all(t).slice().sort((a, b) => Player.rating(b) - Player.rating(a)).slice(0, 3);
    UI.html('champion-body',
      '<div class="champ">' +
        '<p class="champ__eyebrow">' + state.year + '年目</p>' +
        '<h2 class="champ__title">' + esc(state.settings.nationalName) + ' 優勝</h2>' +
        '<p class="champ__school">' + esc(t.name) + '</p>' +
        '<div class="champ__rays" aria-hidden="true"></div>' +
        '<p class="champ__lead">深紅の大優勝旗が、' + esc(t.name) + 'へ。</p>' +
        '<ul class="champ__stars">' + best.map((p) =>
          '<li><b>' + esc(p.name) + '</b><span>' + p.grade + '年・' +
          (p.kind === 'pitcher' ? '投手' : posName(p.pos)) + '</span></li>').join('') + '</ul>' +
      '</div>');
    UI.show('screen-champion');
  }

  /* ---------- オフシーズン ---------- */

  function offseason(state, retired) {
    UI.el('off-title').textContent = state.year + '年目　オフシーズン';
    const cards = retired.length
      ? retired.map((f) => {
        const p = f.player;
        const isPit = p.kind === 'pitcher';
        const abil = isPit
          ? ['最速 ' + p.velo + 'km/h', '制球 ' + rankOf(p.control), 'スタミナ ' + rankOf(p.stamina),
             p.pitches.map((q) => q.name + q.level).join('・')].join('　')
          : ['ミート ' + rankOf(p.meet), 'パワー ' + rankOf(p.power), '走力 ' + rankOf(p.speed),
             '肩 ' + rankOf(p.arm), '守備 ' + rankOf(p.field), '捕球 ' + rankOf(p.catch),
             '弾道 ' + p.traj].join('　');
        const top = f.top.length
          ? '<ol class="hllist">' + f.top.map((h) =>
              '<li><span class="hl__where">' + esc(h.where) + '</span><span class="hl__line">' + esc(h.line) + '</span></li>').join('') + '</ol>'
          : '<p class="note">目立った記録は残せませんでした。</p>';
        return '<article class="retire' + (f.draft ? ' is-draft' : '') + '">' +
          '<header class="retire__head">' +
            '<h3><button type="button" class="linkbtn retire__name" data-pid="' + p.id + '">' + esc(p.name) + '</button></h3>' +
            '<span>' + (isPit ? '投手' : posName(p.pos)) + '　' + UI.handMark(p) +
            (p.awakened ? '　<b class="awake">覚醒</b>' : '') + '</span>' +
            (f.draft ? '<em class="retire__draft">' + esc(f.draft.text) + '</em>' : '') + '</header>' +
          (p.from ? '<p class="retire__from">' + p.from.year + '年目に ' + esc(p.from.school) + ' から加入</p>' : '') +
          '<p class="retire__abil">' + esc(abil) + '</p>' +
          (isPit ? UI.careerPitLine(p.career) : UI.careerBatLine(p.career)) +
          '<h4 class="sub">活躍シーン ベスト3</h4>' + top +
        '</article>';
      }).join('')
      : '<p class="note">今年は引退する3年生がいませんでした。</p>';

    /* 負けて引き抜かれていたら、誰を取られたのかを頭に出す。
       名前とポジションだけでは分からないので、学年も能力も通算成績も並べる */
    const taken = state.poachedFrom && state.poachedFrom.player
      ? (function () {
          const q = state.poachedFrom.player;
          return '<section class="taken">' +
            '<h3 class="taken__title">引き抜き</h3>' +
            '<p class="taken__lead">' + esc(state.poachedFrom.to) + 'に <b>' + esc(q.name) + '</b>（' +
              q.grade + '年・' + (q.kind === 'pitcher' ? '投手' : posName(q.pos)) + '・' +
              UI.handMark(q) + '）を引き抜かれた。</p>' +
            UI.playerDetail(q, { rename: false }) +
            '<p class="note">空いた枠には、新入生が1人多く入る。</p>' +
          '</section>';
        })()
      : '';

    /* キャプテンはここでも変えられる。引退して空いたときだけでなく、
       続けられる場合でも、気が変わったら替えられるようにしておく。
       強制はしない（このまま先へ進んでもよい） */
    const leaving = retired.map((f) => f.player.id);
    const cap = Team.captain(state.team);
    const capOut = cap && leaving.indexOf(cap.id) >= 0;
    const capPart =
      '<h3 class="sub">キャプテン</h3>' +
      captainBox(state.team, leaving) +
      '<p class="note">' +
        (!cap ? 'キャプテンが決まっていません。'
              : (capOut ? '引退するので、新しいキャプテンを決めてください。'
                        : '続けてもらうならこのままで構いません。気が変わったらここで変えられます。')) +
        '学年は問いません。引退する3年生は選べません。</p>';

    UI.html('off-body',
      taken + '<p class="section-lead">3年生が引退します。名前を押すと能力を見られます。</p>' +
      cards + capPart);
    const body = UI.el('off-body');
    const all = retired.map((f) => f.player).concat(
      state.poachedFrom && state.poachedFrom.player ? [state.poachedFrom.player] : []);
    body.querySelectorAll('.retire__name').forEach((b) =>
      b.addEventListener('click', () => {
        const q = all.find((x) => x.id === b.dataset.pid);
        if (q) UI.openPlayer(q, { team: state.team, rename: false });
      }));
    wireCaptain(body, state.team, () => offseason(state, retired), leaving);
    UI.show('screen-offseason');
  }

  /* ---------- 設定 ---------- */

  function settings(state) {
    UI.el('set-national').value = state.settings.nationalName;
    UI.el('set-school').value = state.team ? state.team.name : (state.settings.schoolName || '');
    UI.el('set-poach').checked = !!state.settings.poach;
    UI.show('screen-settings');
  }

  return {
    pick, ready, training, trainingResult, opening, pregame,
    poachWin, poachRelease, champion, offseason, settings, lineupCard, bindRows,
    abilityLine, pitchText, verdict, growth, nextUp, trainingIntro, setOnChange,
  };
})();
