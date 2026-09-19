/* ==================================================
   高校野球  screens.js

   試合以外の画面。描くのはここ、進行の判断は main.js。
   ================================================== */
'use strict';

const Screens = (() => {

  const esc = UI.esc;

  /* ---------- データセット選択 ---------- */

  function gradeText(byGrade) {
    return [1, 2, 3].filter((g) => byGrade[g]).map((g) => g + '年' + byGrade[g] + '人').join('・');
  }

  function pick(opt) {
    UI.el('pick-title').textContent = opt.title;
    UI.el('pick-lead').textContent = opt.lead || '';

    const html = opt.sets.map((players, i) => {
      const s = Dataset.summary(players);
      return '<article class="dataset">' +
        '<header class="dataset__head">' +
          '<h3 class="dataset__no">データセット ' + (i + 1) + '</h3>' +
          '<p class="dataset__meta">' + s.count + '人　' + gradeText(s.byGrade) +
            '　<span class="dataset__best">注目： ' + esc(s.best.name) + '（' + s.best.grade + '年）</span></p>' +
          '<button type="button" class="btn btn--primary dataset__pick" data-i="' + i + '">このメンバーにする</button>' +
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
      lineupCard(t) +
      '<h3 class="sub">野手</h3>' + UI.rosterTable(t.batters) +
      '<h3 class="sub">投手</h3>' + UI.rosterTable(t.pitchers) +
      '<label class="field field--check field--boxed">' +
        '<input type="checkbox" id="ready-poach"' + (state.settings.poach ? ' checked' : '') + '>' +
        '<span>敗戦時、相手チームに選手を引き抜かれる<i>（外すと引き抜かれません）</i></span>' +
      '</label>';
    UI.html('ready-body', html);
    const body = UI.el('ready-body');
    bindRows(body, (pid) => {
      const p = Team.find(t, pid);
      if (p) UI.openPlayer(p, { onRename: () => ready(state) });
    });
    body.querySelector('#ready-poach').addEventListener('change', (e) => {
      state.settings.poach = e.target.checked;
      Storage.saveSettings(state.settings);
    });
    UI.show('screen-ready');
  }

  /** スタメン9人と先発投手 */
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
        '<td class="c">' + UI.rankSpan(p.meet) + UI.rankSpan(p.power) + UI.rankSpan(p.speed) + '</td></tr>';
    }).join('');
    const sp = Team.find(t, t.rotation[0]);
    return '<div class="lineupcard' + (opts.compact ? ' is-compact' : '') + '">' +
      '<h3 class="lineupcard__title">' + esc(t.name) + '</h3>' +
      '<div class="tablewrap"><table class="lineup"><tbody>' + rows + '</tbody></table></div>' +
      (sp ? '<p class="lineupcard__p">先発　' + esc(sp.name) + '（' + sp.grade + '年・' +
        (sp.throws === 'L' ? '左' : '右') + '・' + sp.velo + 'km/h　制球' + rankOf(sp.control) +
        '　' + sp.pitches.map((q) => esc(q.name)).join('・') + '）</p>' : '') +
      '</div>';
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
      const lines = card.targets.map((t) => {
        const p = Team.find(state.team, t.pid);
        const cur = p ? currentValue(p, t) : '';
        return '<li class="cardline"><span class="cardline__name">' + esc(t.name) +
          '<i>' + (p ? p.grade + '年' : '') + '</i></span>' +
          '<span class="cardline__stat">' + esc(t.label) + '</span>' +
          '<span class="cardline__up">+' + t.amount + (t.unit ? esc(t.unit) : '') + '</span>' +
          '<span class="cardline__now">' + cur + '</span></li>';
      }).join('');
      UI.html('train-card',
        '<div class="traincard traincard--' + card.kind + '">' +
          '<p class="traincard__kind">' + esc(card.title) + '</p>' +
          '<ul class="traincard__list">' + lines + '</ul>' +
        '</div>');
    } else {
      UI.html('train-card', '');
    }

    const passBtn = UI.el('btn-train-pass');
    passBtn.disabled = !Training.canPass(st);
    UI.show('screen-training');
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
      ? '<div class="tablewrap"><table class="growth"><thead><tr><th class="nm">選手</th><th>年</th><th>項目</th><th>変化</th></tr></thead><tbody>' +
        rows.map((r) => '<tr><td class="nm">' + esc(r.name) + '</td><td class="c">' + r.grade + '</td>' +
          '<td>' + esc(r.label) + '</td>' +
          '<td class="c up">' + r.before + ' → <b>' + r.after + '</b>' + (r.unit ? esc(r.unit) : '') +
          ' <i>(+' + r.amount + ')</i></td></tr>').join('') +
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

  function pregame(state) {
    const r = Tournament.currentRound(state.tour);
    const label = (state.tour.kind === 'national' ? state.settings.nationalName : '地方大会');
    UI.el('pregame-title').textContent = label + '　' + r.name;
    const html =
      '<p class="section-lead vs">' + esc(state.team.name) + '　<i>対</i>　' + esc(state.opponent.name) +
        '<span class="tiny">（相手のチーム力 ' + Team.strength(state.opponent) + '）</span></p>' +
      '<div class="twocol">' + lineupCard(state.team) + lineupCard(state.opponent) + '</div>';
    UI.html('pregame-body', html);
    const body = UI.el('pregame-body');
    bindRows(body, (pid) => {
      const p = Team.find(state.team, pid) || Team.find(state.opponent, pid);
      if (p) UI.openPlayer(p, { rename: Team.find(state.team, pid) ? true : false, onRename: () => pregame(state) });
    });
    UI.show('screen-pregame');
  }

  /* ---------- 引き抜き ---------- */

  function poachWin(state, onTake, onSkip) {
    UI.el('poach-title').textContent = '引き抜き';
    UI.el('poach-lead').textContent =
      esc(state.opponent.name) + 'から1人、自校に引き抜けます。引き抜くと、同じ区分（野手／投手）の部員を1人放出します。';
    const html =
      '<h3 class="sub">' + esc(state.opponent.name) + '　野手</h3>' + UI.rosterTable(state.opponent.batters) +
      '<h3 class="sub">' + esc(state.opponent.name) + '　投手</h3>' + UI.rosterTable(state.opponent.pitchers);
    UI.html('poach-body', html);
    const body = UI.el('poach-body');
    body.querySelectorAll('tr.prow').forEach((tr) => tr.addEventListener('click', () => {
      const p = Team.find(state.opponent, tr.dataset.pid);
      if (p) onTake(p);
    }));
    UI.el('btn-poach-skip').hidden = false;
    UI.el('btn-poach-skip').onclick = onSkip;
    UI.show('screen-poach');
  }

  /** 引き抜いた選手と入れ替えに出す部員を選ぶ */
  function poachRelease(state, incoming, onRelease, onCancel) {
    UI.el('poach-title').textContent = esc(incoming.name) + ' を迎える';
    UI.el('poach-lead').textContent = '放出する' + (incoming.kind === 'pitcher' ? '投手' : '野手') + 'を1人選んでください。';
    const own = incoming.kind === 'pitcher' ? state.team.pitchers : state.team.batters;
    UI.html('poach-body',
      '<div class="incoming">' + UI.playerDetail(incoming, { rename: false }) + '</div>' +
      '<h3 class="sub">放出する選手を選ぶ</h3>' + UI.rosterTable(own));
    const body = UI.el('poach-body');
    body.querySelectorAll('tr.prow').forEach((tr) => tr.addEventListener('click', () => {
      const p = Team.find(state.team, tr.dataset.pid);
      if (p) onRelease(p);
    }));
    UI.el('btn-poach-skip').hidden = false;
    UI.el('btn-poach-skip').textContent = 'やめる';
    UI.el('btn-poach-skip').onclick = onCancel;
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
        return '<article class="retire">' +
          '<header class="retire__head"><h3>' + esc(p.name) + '</h3>' +
            '<span>' + (isPit ? '投手' : posName(p.pos)) + '　' + UI.handMark(p) +
            (p.awakened ? '　<b class="awake">覚醒</b>' : '') + '</span></header>' +
          '<p class="retire__abil">' + esc(abil) + '</p>' +
          (isPit ? UI.careerPitLine(p.career) : UI.careerBatLine(p.career)) +
          '<h4 class="sub">活躍シーン ベスト3</h4>' + top +
        '</article>';
      }).join('')
      : '<p class="note">今年は引退する3年生がいませんでした。</p>';

    UI.html('off-body',
      '<p class="section-lead">3年生が引退します。</p>' + cards);
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
  };
})();
