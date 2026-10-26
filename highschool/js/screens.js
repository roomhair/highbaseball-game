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
      (sp ? '<p class="lineupcard__p">先発' + oppRankText(t, sp) + '　' +
        '<button type="button" class="linkbtn pitname" data-pid="' + sp.id + '">' + esc(sp.name) + '</button>' +
        '<span class="spmeta">' +
          sp.grade + '年・' + (sp.throws === 'L' ? '左' : '右') +
          '　球速 <b class="rankval">' + sp.velo + '</b>km/h' +
          '　制球 ' + UI.rankNum(sp.control) +
          '　スタミナ ' + UI.rankNum(sp.stamina) +
          '　<span class="spfat' + (Team.staminaTier(sp) !== 'lo' ? ' is-tired' : '') + '">' +
            esc(Team.staminaLabel(sp)) + '</span>' +
        '</span>' +
        '<span class="spballs">' + pitchText(sp) + '</span></p>' : '') +
      (opts.pickable ? starterPicker(t, opts.pitcherOrder) : '') +
      '</div>';
  }

  /** 相手校の先発が、投手陣の何番手にあたるか（力の順）。自校は先発を選べるので出さない */
  function oppRankText(t, sp) {
    if (t === (Game.state && Game.state.team)) return '';
    const rank = t.pitchers.slice().sort((a, b) => Player.rating(b) - Player.rating(a)).map((x) => x.id).indexOf(sp.id);
    return rank >= 0 ? '（' + (rank + 1) + '番手）' : '';
  }

  /** 変化球を「名前＋切れ味」で並べる */
  function pitchText(p) {
    if (!p.pitches || !p.pitches.length) return '―';
    return p.pitches.map((q) =>
      '<span class="pball">' + esc(q.name) + '<b>' + q.level + '</b></span>').join('');
  }

  /** 先発を選ぶ列。試合前の画面だけに出す。
      order を渡すと、そこに並んだ順で固定して表示する
      （選ぶたびに並びが入れ替わると選びにくいため。先発かどうかは
      ハイライトと色だけで示す） */
  function starterPicker(t, order) {
    const ids = (order && order.length ? order : (t.rotation || []));
    const rot = ids.map((id) => Team.find(t, id)).filter(Boolean);
    if (rot.length < 2) return '';
    const starterId = t.rotation[0];
    return '<div class="spick">' +
      '<div class="spick__head">先発を選ぶ</div>' +
      '<div class="spick__list">' + rot.map((p) =>
        '<button type="button" class="spick__item' + (p.id === starterId ? ' is-on' : '') + '" data-pid="' + p.id + '">' +
          '<span class="spick__nm">' + esc(p.name) + '</span>' +
          '<span class="spick__fat' + (Team.staminaTier(p) !== 'lo' ? ' is-tired' : '') + '">' +
            esc(Team.staminaLabel(p)) + '</span>' +
          '<span class="spick__meta">' + p.grade + '年・' + (p.throws === 'L' ? '左' : '右') +
            '　球速 <b class="rankval">' + p.velo + '</b>km/h' +
            '　制球 ' + UI.rankNum(p.control) + '　スタミナ ' + UI.rankNum(p.stamina) + '</span>' +
          '<span class="spick__balls">' + pitchText(p) + '</span>' +
        '</button>').join('') +
      '</div></div>';
  }

  /* ---------- 特訓期間 ---------- */

  /** 特訓の入口に出す一言。state.trainingNext（次に進む先）で変える */
  function trainingIntroLead(state) {
    switch (state.trainingNext) {
      /* 3年生が引退した直後。学年はまだ上がらず、新入生もまだいない */
      case 'fallPref': return '3年生が引退した今のチームの、秋までの練習が始まる。';
      case 'springOrNextSummer':
        return state.springQualified ? '春までの練習が始まる。' : '来年の夏までの練習が始まる。';
      /* センバツ相当まで終わり、学年が上がって新入生を迎えた直後 */
      case 'nextSummer': return '新入生を迎えた新チームの、夏までの練習が始まる。';
      default: return '新入生を迎えたチームの、夏までの練習が始まる。';
    }
  }

  function trainingIntro(state) {
    const t = state.team;
    const cap = Team.captain(t);
    UI.html('trainintro-body',
      '<p class="nextup__eyebrow">' + state.year + '年目</p>' +
      '<h2 class="nextup__title">特訓期間</h2>' +
      '<p class="nextup__vs">' + esc(t.name) + '。' + esc(trainingIntroLead(state)) + '</p>' +
      captainBox(t) +
      /* キャプテンが決まるまでは先へ進ませない（ボタンを押せなくして、注意書きも出す） */
      (cap ? '' : '<p class="capwarn">キャプテンを決めると特訓に進めます</p>') +
      '<div class="actions"><button type="button" class="btn btn--primary btn--wide" id="btn-trainintro-go"' +
        (cap ? '' : ' disabled') + '>特訓へ</button></div>');
    wireCaptain(UI.el('trainintro-body'), t, () => trainingIntro(state));
    UI.show('screen-trainintro');
  }

  /* ---------- 特訓 ---------- */

  function training(state) {
    const st = state.training;
    /* 「いま何回目か」を1始まりで見せる。最初のカードで1/5、
       最後のカードでも（使い切った6/5にならないよう）5/5のまま */
    UI.el('train-picks').textContent = Math.min(st.picks + 1, st.pickLimit);
    UI.el('train-picks-max').textContent = st.pickLimit;
    UI.el('train-passes').textContent = st.passes;
    UI.el('train-passes-max').textContent = st.passLimit;

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
      /* 「走力 +16　ミート +20」の並びも、ふだんの能力の並び（ミート・パワー・走力…）に合わせる */
      groups.forEach((g) => g.ups.sort((a, b) => statOrder(a.key) - statOrder(b.key)));
      const lines = groups.map((g) => {
        const p = Team.find(state.team, g.pid);
        if (!p) return '';
        const ups = g.ups.map((t) =>
          esc(t.label) + ' +' + t.amount + (t.unit ? esc(t.unit) : '')).join('　');
        return '<li class="tcard">' +
          '<div class="tcard__head"><button type="button" class="linkbtn tcard__name" data-pid="' + p.id + '">' + esc(p.name) + '</button>' +
            '<span>' + p.grade + '年・' + UI.roleText(state.team, p) + '・' +
              (p.kind === 'pitcher' ? (p.throws === 'L' ? '左投' : '右投') : UI.handMark(p)) + '</span>' +
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
      /* 名前を押すと選手の詳細が開く */
      UI.el('train-card').querySelectorAll('.tcard__name').forEach((b) => b.addEventListener('click', () => {
        const p = Team.find(state.team, b.dataset.pid);
        if (p) UI.openPlayer(p, { team: state.team, onRename: () => training(state) });
      }));
    } else {
      UI.html('train-card', '');
    }

    const passBtn = UI.el('btn-train-pass');
    const left = st.passLimit - st.passes;
    passBtn.disabled = !Training.canPass(st);
    passBtn.textContent = left > 0 ? '見送る（あと' + left + '回）' : '見送れません';
    UI.show('screen-training');
  }

  /** 選手ID → オーダーでの並び順。控えと投手は後ろに回す */
  function orderIndex(team) {
    const map = {};
    team.lineup.forEach((sl, i) => { map[sl.pid] = i; });
    /* 投手は番手の順（先発に選んでも番手は動かさない） */
    UI.pitOrderOf(team).forEach((id, i) => { if (map[id] == null) map[id] = 20 + i; });
    team.batters.forEach((p) => { if (map[p.id] == null) map[p.id] = 10; });
    return map;
  }

  /**
   * 能力をひと通り並べる。上がるものだけ「いま → 上がったあと」で出し、
   * 残りはいまの値をそのまま添える。能力の評価には色を付ける。
   */
  /** ups は「この選手が今回上がるぶん」の一覧（「複数」のカードでは2つ入る） */
  /** 能力の並び順（ふだんの表示と同じ）。特訓で上がる項目を並べるのに使う */
  const STAT_ORDER = ['velo', 'control', 'stamina', 'pitch', 'newpitch', 'meet', 'power', 'speed', 'arm', 'field', 'catch', 'traj'];
  function statOrder(key) {
    const i = STAT_ORDER.indexOf(key);
    return i < 0 ? STAT_ORDER.length : i;
  }

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

  /** 大会開幕の見出し下に出す一言。大会の種類ごとに変える */
  function openingLead(state) {
    const t = esc(state.team.name);
    switch (state.tour.kind) {
      case 'national': return '全国の頂点をめざす戦いが始まる。' + t + '、初戦へ。';
      case 'fallPref': return t + '、新チームで秋の大会へ。';
      case 'fallDistrict': return t + '、地区大会へ。';
      case 'fallJingu': return t + '、全国の強豪が集う舞台へ。';
      case 'spring': return t + '、春の全国大会へ。';
      default: return t + '、夏の県大会へ。';
    }
  }

  function opening(state) {
    UI.el('opening-year').textContent = state.year + '年目';
    UI.el('opening-title').textContent = Game.tourLabel() + ' 開幕';
    UI.el('opening-lead').textContent = openingLead(state);
    UI.show('screen-opening');
  }

  /* ---------- 試合開始前 ---------- */

  function pregame(state, opts) {
    const r = Tournament.currentRound(state.tour);
    UI.el('pregame-title').textContent = Game.tourLabel() + '　' + r.name;
    /* 相手のチーム力は出さない。オーダーと能力を見て、自分で見積もってもらう */
    UI.html('pregame-body',
      '<p class="section-lead vs">' + esc(state.team.name) + '　<i>対</i>　' + esc(state.opponent.name) + '</p>' +
      '<div class="twocol"><div id="pregame-my"></div><div id="pregame-opp"></div></div>');
    const open = (pid) => {
      const p = Team.find(state.team, pid) || Team.find(state.opponent, pid);
      if (p) UI.openPlayer(p, { team: state.team, rename: !!Team.find(state.team, pid), onRename: () => pregame(state, opts) });
    };

    /* 相手カードは試合が始まるまで変わらないので、一度だけ描く */
    UI.html('pregame-opp', lineupCard(state.opponent));
    const oppBody = UI.el('pregame-opp');
    bindRows(oppBody, open);
    oppBody.querySelectorAll('.pitname').forEach((b) => b.addEventListener('click', () => open(b.dataset.pid)));

    /* 先発を選ぶ列に並べる順番は、この画面を開いたときのまま固定する。
       選ぶたびに並び替えてしまうと、ボタンの位置が毎回入れ替わって
       選びにくいため。実際の先発（rotation[0]）はハイライトと
       色の変化だけで示す */
    /* さらに、次の試合でこの画面を開いたときも並びが変わらないよう、
       並びそのものをチームに持たせておく（先発を選んだ投手が、
       次の試合で先頭の位置に来てしまわないようにする）。
       いない投手は外し、新しく加わった投手は最後に足す */
    const pitcherOrder = (state.team.pitcherOrder || state.team.rotation || [])
      .filter((id) => state.team.pitchers.some((p) => p.id === id));
    (state.team.rotation || []).forEach((id) => { if (pitcherOrder.indexOf(id) < 0) pitcherOrder.push(id); });
    state.team.pitcherOrder = pitcherOrder.slice();

    /* 自軍カードは先発を選ぶたびに描き直す。ここだけ関数にしておき、
       画面全体（UI.show）は動かさないようにする。
       先発を選ぶたびに画面全体を描き直すと、UI.show が呼ぶ
       window.scrollTo(0,0) でスクロール位置が先頭に戻ってしまい、
       「リロードされた」ように見えてしまっていたため */
    function renderMyCard() {
      UI.html('pregame-my', lineupCard(state.team, { pickable: true, pitcherOrder: pitcherOrder }));
      const myBody = UI.el('pregame-my');
      bindRows(myBody, open);
      myBody.querySelectorAll('.pitname').forEach((b) => b.addEventListener('click', () => open(b.dataset.pid)));
      myBody.querySelectorAll('.spick__item').forEach((b) => {
        b.addEventListener('click', () => {
          const pid = b.dataset.pid;
          /* 先発（継投の順番の先頭）だけを入れ替える。以降の継投順は
             そのまま保つ。表示の並びはここでは変えない */
          const rot = state.team.rotation.slice();
          const i = rot.indexOf(pid);
          if (i <= 0) return;
          rot.splice(i, 1); rot.unshift(pid);
          state.team.rotation = rot;
          if (opts && opts.onChange) opts.onChange();
          renderMyCard();
        });
      });
    }
    renderMyCard();

    UI.el('btn-pregame-lineup').hidden = false;
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
        UI.decisionLines(r) +
        (r.cold ? '<p class="verdict__note">コールドゲーム</p>' :
          (r.walkoff ? '<p class="verdict__note">サヨナラ</p>' : '')) +
        (win
          ? (r.last ? '<p class="verdict__lead">' + esc(r.tourName) + '　優勝。</p>'
                    : '<p class="verdict__lead">次の試合へ進む。</p>')
          : '<p class="verdict__lead">' + esc(r.loseNext || 'オフシーズンへ') + '。</p>') +
      '</div>');
    UI.el('btn-verdict-share').hidden = false;
    UI.el('btn-verdict-save').hidden = false;
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
    if (u.apt) {
      /* 守備適性は数値ではなく、もともと評価の文字（G〜A）で入っている */
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
      '<header class="gr__head"><b><button type="button" class="linkbtn gr__name" data-pid="' + r.pid + '">' + esc(r.name) + '</button></b>' +
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
          awake.map((r) => '<p class="awakebox__line"><b><button type="button" class="linkbtn gr__name" data-pid="' + r.pid + '">' + esc(r.name) + '</button></b>（' + r.grade +
            '年）が覚醒した！</p>').join('') + '</div>'
        : '') +
      (report.length
        ? '<div class="grlist">' + awake.map(card).join('') + grew.map(card).join('') + '</div>'
        : '<p class="note">今回は伸びた選手がいませんでした。</p>');
    UI.html('growth-body', html);
    UI.el('growth-body').querySelectorAll('.gr__name').forEach((b) =>
      b.addEventListener('click', () => {
        const q = Team.find(state.team, b.dataset.pid);
        if (q) UI.openPlayer(q, { team: state.team, rename: false });
      }));
    UI.show('screen-growth');
  }

  /* ---------- 次の試合のお知らせ ---------- */

  function nextUp(state) {
    const r = Tournament.currentRound(state.tour);
    UI.html('nextup-body',
      '<p class="nextup__eyebrow">次の試合</p>' +
      '<h2 class="nextup__title">' + esc(Game.tourLabel()) + '　' + esc(r.name) + '</h2>' +
      '<p class="nextup__vs">' + esc(state.team.name) + '　対　<b>' + esc(r.schoolName) + '</b></p>');
    UI.show('screen-nextup');
  }

  /* ---------- 引き抜き ---------- */

  /** 引き抜きの画面の、いまの手順を示す。見た目だけで、進み方には関わらない。
      stage は pick（相手を選ぶ）・release（放出する選手を選ぶ）・win / lose（結果） */
  function poachStage(stage) {
    const step = { pick: 0, release: 1, win: 2, lose: 2 }[stage];
    UI.el('screen-poach').dataset.stage = stage;
    UI.el('poach-steps').querySelectorAll('li').forEach((li, i) => {
      li.classList.toggle('is-done', i < step);
      li.classList.toggle('is-now', i === step);
      if (i === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
  }

  function poachWin(state, onTake, onSkip) {
    let picked = null;
    poachStage('pick');
    UI.el('poach-title').textContent = '引き抜きチャレンジ';
    UI.el('poach-warn').hidden = true;
    UI.el('poach-title').classList.remove('is-win', 'is-lose');
    UI.el('poach-lead').textContent =
      esc(state.opponent.name) + 'から1人、引き抜きに挑戦できます（必ず成功するとは限りません）。' +
      '選手を選んでから下のボタンを押してください。成功すると、同じ区分（野手／投手）の部員を1人放出します。';
    UI.html('poach-body',
      '<h3 class="sub">' + esc(state.opponent.name) + '　野手</h3><div id="poach-bat"></div>' +
      '<h3 class="sub">' + esc(state.opponent.name) + '　投手</h3><div id="poach-pit"></div>');

    /* 決勝のあとには次の試合が無いので、そのときだけ言い方を変える */
    const more = state.tour.index < state.tour.rounds.length - 1;
    const ok = UI.el('btn-poach-ok');
    const skip = UI.el('btn-poach-skip');
    ok.textContent = more ? '引き抜きチャレンジへ' : '引き抜きチャレンジ';
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
        (picked.kind === 'pitcher' ? '投手' : posName(picked.pos)) + '）の引き抜きに挑戦します。';
    };
    UI.rosterPanel(UI.el('poach-bat'), state.opponent.batters,
      { team: state.opponent, onRow: choose, nameLink: true, nameLinkRename: false });
    UI.rosterPanel(UI.el('poach-pit'), state.opponent.pitchers,
      { team: state.opponent, onRow: choose, nameLink: true, nameLinkRename: false });
    ok.onclick = () => { if (picked) onTake(picked); };
    skip.onclick = onSkip;
    UI.show('screen-poach');
  }

  /** 挑戦する前に、入れ替えに出す部員を選んでおく。
      （成功してから放出を選ばせると、放出できる選手がいない事態が
      起こりうるため、挑戦そのものより前に選ばせる） */
  function poachRelease(state, incoming, onRelease, onCancel) {
    let picked = null;
    poachStage('release');
    UI.el('poach-title').textContent = '放出する選手を選ぶ';
    UI.el('poach-title').classList.remove('is-win', 'is-lose');
    UI.el('poach-lead').textContent =
      esc(incoming.name) + 'の引き抜きに挑戦する前に、迎える代わりに放出する' +
      (incoming.kind === 'pitcher' ? '投手' : '野手') + 'を1人選んでください。';
    const own = incoming.kind === 'pitcher' ? state.team.pitchers : state.team.batters;
    UI.html('poach-body',
      '<div class="incoming">' + UI.playerDetail(incoming, { rename: false }) + '</div>' +
      '<h3 class="sub">放出する選手を選ぶ</h3><div id="poach-own"></div>');

    const more = state.tour.index < state.tour.rounds.length - 1;
    const warn = UI.el('poach-warn');
    warn.hidden = true; warn.textContent = '';
    const ok = UI.el('btn-poach-ok');
    const skip = UI.el('btn-poach-skip');
    ok.textContent = more ? 'この内容で引き抜きチャレンジへ' : 'この内容で引き抜きチャレンジ';
    ok.hidden = false;
    ok.disabled = true;
    skip.hidden = false;
    skip.textContent = '選び直す';

    const body = UI.el('poach-body');
    UI.rosterPanel(UI.el('poach-own'), own, {
      team: state.team,
      nameLink: true,
      onRow: (pid) => {
        body.querySelectorAll('tr.prow').forEach((x) => x.classList.remove('is-picked'));
        body.querySelectorAll('tr.prow[data-pid="' + pid + '"]').forEach((x) => x.classList.add('is-picked'));
        picked = Team.find(state.team, pid);
        /* 3年生を迎えるために1・2年生を放出すると、引退のあとに野手が
           足りなくなる。1・2年生の野手が10人を下回る引き抜きはできない */
        const short = !!picked && incoming.kind !== 'pitcher' && incoming.grade >= 3 &&
          picked.grade < 3 && own.filter((x) => x.grade < 3).length <= 10;
        ok.disabled = !picked || short;
        /* 放出できないときの理由は、押せなくなったボタンのすぐ下に赤字で出す */
        warn.hidden = !short;
        warn.textContent = short
          ? '1・2年生の野手が10人を下回るため、' + picked.name + 'は放出できません。他の選手を選んでください。' : '';
        if (picked && !short) UI.el('poach-lead').textContent =
          picked.name + '（' + UI.roleText(state.team, picked) + '）を放出して、挑戦します。';
      },
    });
    ok.onclick = () => { if (picked) onRelease(picked); };
    skip.onclick = onCancel;
    UI.show('screen-poach');
  }

  /** 引き抜きに成功したとき。放出はすでに選んであるので、結果を伝えるだけ */
  function poachSuccess(state, incoming, outgoing, onNext) {
    poachStage('win');
    UI.el('poach-title').textContent = '引き抜き成功！';
    UI.el('poach-warn').hidden = true;
    UI.el('poach-title').classList.remove('is-lose');
    UI.el('poach-title').classList.add('is-win');
    UI.el('poach-lead').textContent =
      esc(incoming.name) + 'の引き抜きに成功した。代わりに' + esc(outgoing.name) + 'を放出した。';
    UI.html('poach-body', '<div class="incoming">' + UI.playerDetail(incoming, { rename: false }) + '</div>');

    const more = state.tour.index < state.tour.rounds.length - 1;
    const ok = UI.el('btn-poach-ok');
    const skip = UI.el('btn-poach-skip');
    ok.textContent = more ? '次の試合へ' : '次へ';
    ok.hidden = false;
    ok.disabled = false;
    skip.hidden = true;
    ok.onclick = () => onNext();
    UI.show('screen-poach');
  }

  /** 引き抜きに失敗したとき。相手に引き止められ、何も変わらずに次へ進む */
  function poachFailed(state, incoming, onNext) {
    poachStage('lose');
    UI.el('poach-title').textContent = '引き抜き失敗';
    UI.el('poach-warn').hidden = true;
    UI.el('poach-title').classList.remove('is-win');
    UI.el('poach-title').classList.add('is-lose');
    UI.el('poach-lead').textContent = esc(state.opponent.name) + 'に引き止められてしまった。';
    UI.html('poach-body', '<div class="incoming">' + UI.playerDetail(incoming, { rename: false }) + '</div>');

    const more = state.tour.index < state.tour.rounds.length - 1;
    const ok = UI.el('btn-poach-ok');
    const skip = UI.el('btn-poach-skip');
    ok.textContent = more ? '次の試合へ' : '次へ';
    ok.hidden = false;
    ok.disabled = false;
    skip.hidden = true;
    ok.onclick = () => onNext();
    UI.show('screen-poach');
  }

  /* ---------- 全国優勝 ---------- */

  /** その大会の戦いぶりを短くまとめる */
  function tourLine(state) {
    const t = state.tour;
    const games = (t && t.games) || 0;
    const rf = (t && t.runsFor) || 0, ra = (t && t.runsAgainst) || 0;
    const r = state.lastResult;
    const lines = [];
    if (r) lines.push('決勝 ' + r.myRuns + '−' + r.opRuns + '（' + esc(r.oppName) + '）');
    if (games) lines.push('1試合平均 ' + (rf / games).toFixed(1) + '得点 ' + (ra / games).toFixed(1) + '失点');
    return lines.join('<br>');
  }

  /** 活躍した3人。大会成績の良い順 */
  function tourStars(t) {
    const score = (p) => p.kind === 'pitcher'
      ? (p.tour.outs || 0) / 3 * 1.1 + (p.tour.so || 0) * 0.3 - (p.tour.er || 0) * 0.8
      : (p.tour.h || 0) * 1.0 + (p.tour.hr || 0) * 2.2 + (p.tour.rbi || 0) * 0.6;
    return Team.all(t).slice().sort((a, b) => score(b) - score(a)).slice(0, 3);
  }

  /** 優勝画面の紙吹雪。純粋な飾りなので、乱数の種には触れない
      （Math.random を直接使う） */
  function confetti(n, colors) {
    let out = '';
    for (let i = 0; i < n; i++) {
      const left = Math.floor(Math.random() * 100);
      const delay = (Math.random() * 0.7).toFixed(2);
      const dur = (1.9 + Math.random() * 1.3).toFixed(2);
      const rot = Math.floor(Math.random() * 360);
      const color = colors[i % colors.length];
      out += '<i class="confetti__piece" style="left:' + left + '%;' +
        '--delay:' + delay + 's;--dur:' + dur + 's;--rot:' + rot + 'deg;' +
        'background:' + color + '"></i>';
    }
    return '<div class="champ__confetti" aria-hidden="true">' + out + '</div>';
  }

  function starList(t) {
    return '<ul class="champ__stars">' + tourStars(t).map((p) => {
      const s = p.tour;
      const line = p.kind === 'pitcher'
        ? Math.floor((s.outs || 0) / 3) + '回 ' + (s.er || 0) + '失点 ' + (s.so || 0) + '奪三振'
        : (s.h || 0) + '安打' + (s.hr ? ' ' + s.hr + '本塁打' : '') + ' ' + (s.rbi || 0) + '打点';
      return '<li><b>' + esc(p.name) + '</b>' +
        '<span>' + p.grade + '年・' + (p.kind === 'pitcher' ? '投手' : posName(p.pos)) + '</span>' +
        '<span class="champ__stat">' + line + '</span></li>';
    }).join('') + '</ul>';
  }

  /** 地方大会を勝ち切ったとき。ここから全国大会へ進む */
  function localWin(state) {
    const t = state.team;
    UI.html('localwin-body',
      '<div class="champ champ--local">' +
        confetti(18, ['#1f9447', '#ffd43b', '#7cc4ff', '#ffffff']) +
        '<p class="champ__eyebrow">' + state.year + '年目</p>' +
        '<h2 class="champ__title">県大会 優勝</h2>' +
        '<p class="champ__school">' + esc(t.name) + '</p>' +
        '<div class="champ__rays" aria-hidden="true"></div>' +
        '<p class="champ__record">' + tourLine(state) + '</p>' +
        '<p class="champ__lead">' + esc(t.name) + 'が県の代表として、' +
          esc(state.settings.nationalName) + 'へ駒を進めた。</p>' +
        starList(t) +
      '</div>');
    UI.show('screen-localwin');
  }

  function champion(state) {
    const t = state.team;
    UI.html('champion-body',
      '<div class="champ champ--grand">' +
        confetti(28, ['#ffd43b', '#ffffff', '#ff5a6e', '#7cc4ff', '#5fd67e']) +
        '<p class="champ__eyebrow">' + state.year + '年目</p>' +
        '<h2 class="champ__title">' + esc(state.settings.nationalName) + ' 優勝</h2>' +
        '<p class="champ__school">' + esc(t.name) + '</p>' +
        '<div class="champ__rays" aria-hidden="true"></div>' +
        '<p class="champ__record">' + tourLine(state) + '</p>' +
        '<p class="champ__lead">深紅の大優勝旗が、' + esc(t.name) + 'へ。</p>' +
        starList(t) +
        '<p class="champ__note">' + state.year + '年目の夏、日本一。</p>' +
      '</div>');
    UI.show('screen-champion');
  }

  /** 大会に優勝した試合のあと、いちばん最初に出す画面（そのあと勝敗・成長・試合結果の順） */
  function celebrate(state) {
    const t = state.team;
    UI.html('celebrate-body',
      '<div class="champ champ--grand">' +
        confetti(28, ['#ffd43b', '#ffffff', '#ff5a6e', '#7cc4ff', '#5fd67e']) +
        '<p class="champ__eyebrow">' + state.year + '年目</p>' +
        '<h2 class="champ__title">' + esc(Game.tourLabel()) + ' 優勝</h2>' +
        '<p class="champ__school">' + esc(t.name) + '</p>' +
        '<div class="champ__rays" aria-hidden="true"></div>' +
        '<p class="champ__record">' + tourLine(state) + '</p>' +
      '</div>');
    UI.show('screen-celebrate');
  }

  /** 秋の大会がすべて終わったあと、センバツ相当に出られるかどうかの発表。
      出られる年は少しだけ華やかに、出られない年は淡々と伝える */
  function springResult(state, qualified) {
    const t = state.team;
    const name = state.settings.springName;
    const body = qualified
      ? '<div class="champ champ--spring">' +
          confetti(16, ['#7cc4ff', '#ffffff', '#ffd43b', '#3b82ea']) +
          '<p class="champ__eyebrow">' + state.year + '年目</p>' +
          '<h2 class="champ__title">' + esc(name) + ' 出場決定</h2>' +
          '<p class="champ__school">' + esc(t.name) + '</p>' +
          '<div class="champ__rays" aria-hidden="true"></div>' +
          '<p class="champ__lead">秋の大会の成績が認められ、来年の' + esc(name) + 'への出場が決まった。</p>' +
        '</div>'
      : '<div class="champ champ--miss">' +
          '<p class="champ__eyebrow">' + state.year + '年目</p>' +
          '<h2 class="champ__title">' + esc(name) + ' 出場ならず</h2>' +
          '<p class="champ__school">' + esc(t.name) + '</p>' +
          '<p class="champ__lead">来年の' + esc(name) + 'への出場はかなわなかった。新入生を迎え、来年の夏に備える。</p>' +
        '</div>';
    UI.html('spring-result-body', body);
    UI.el('btn-spring-result-next').textContent = qualified ? (name + 'へ') : '新入生の入部';
    UI.show('screen-spring-result');
  }

  /* ---------- オフシーズン ---------- */

  function offseason(state, retired) {
    UI.el('off-title').textContent = state.year + '年目　オフシーズン';
    const cards = retired.length
      ? retired.map((f) => {
        const p = f.player;
        const isPit = p.kind === 'pitcher';
        const abil = isPit
          ? ['最速 ' + p.velo + 'km/h', '制球 ' + rankOf(p.control) + ' ' + p.control,
             'スタミナ ' + rankOf(p.stamina) + ' ' + p.stamina,
             p.pitches.map((q) => q.name + q.level).join('・')].join('　')
          : ['ミート ' + rankOf(p.meet) + ' ' + p.meet, 'パワー ' + rankOf(p.power) + ' ' + p.power,
             '走力 ' + rankOf(p.speed) + ' ' + p.speed, '肩 ' + rankOf(p.arm) + ' ' + p.arm,
             '守備 ' + rankOf(p.field) + ' ' + p.field, '捕球 ' + rankOf(p.catch) + ' ' + p.catch,
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
          '<h4 class="sub">活躍シーン</h4>' + top +
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
            '<p class="note">空いた枠には、次に新入生を迎えるときに1人多く入る。</p>' +
          '</section>';
        })()
      : '';

    UI.html('off-body',
      taken + '<p class="section-lead">3年生が引退します。</p>' +
      cards);
    const body = UI.el('off-body');
    const all = retired.map((f) => f.player).concat(
      state.poachedFrom && state.poachedFrom.player ? [state.poachedFrom.player] : []);
    body.querySelectorAll('.retire__name').forEach((b) =>
      b.addEventListener('click', () => {
        const q = all.find((x) => x.id === b.dataset.pid);
        if (q) UI.openPlayer(q, { team: state.team, rename: false });
      }));
    UI.show('screen-offseason');
  }

  /* ---------- 設定 ---------- */

  function settings(state) {
    UI.el('set-national').value = state.settings.nationalName;
    UI.el('set-school').value = state.team ? state.team.name : (state.settings.schoolName || '');
    UI.el('set-jingu').value = state.settings.jinguName;
    UI.el('set-spring').value = state.settings.springName;
    UI.el('set-poach').checked = !!state.settings.poach;
    UI.show('screen-settings');
  }

  /* ---------- サッカー部（野球部のコールド負けのあとの第二の物語） ----------
     流れも画面も野球に合わせてある。能力は7つ（攻撃・守備・パス・スピード・
     フィジカル・スタミナ・GK）で、どこでも名前を押せば詳細が開く。 */

  const SOC_POS_ORDER = { GK: 0, DF: 1, MF: 2, FW: 3 };

  /** サッカー部員の表。FCと同じ6つの主要能力で見せる（GKだけ専用の表）。行を押すと詳細が開く */
  function socTable(S, rows, opts) {
    opts = opts || {};
    const part = (list, gk) => {
      if (!list.length) return '';
      const heads = (gk ? Soccer.MAIN_GK : Soccer.MAIN_FIELD).map((x) => '<th>' + esc(x.label) + '</th>').join('');
      const body = list.map((x) => {
        const p = x.p;
        const vals = Soccer.mainList({ soc: p.soc }).map((v) => '<td class="c">' + UI.rankNum(v.value) + '</td>').join('');
        const rate = opts.noRate ? '' : '<td class="c hl">' + Math.round(Soccer.rateFor(p.soc, x.pos || p.soc.pos)) + '</td>';
        return '<tr' + (opts.noClick ? '' : ' class="prow" data-pid="' + p.id + '"') + '><td class="c">' + esc(x.pos || p.soc.pos) + '</td>' +
          '<td class="nm">' + esc(p.name) + '</td>' + (p.grade === '' || p.grade == null ? '' : '<td class="c">' + p.grade + '</td>') + vals + rate + '</tr>';
      }).join('');
      const hasGrade = list[0].p.grade !== '' && list[0].p.grade != null;
      return '<div class="tablewrap"><table class="growth"><thead><tr><th>位置</th><th class="nm">' + (gk ? 'GK' : '選手') + '</th>' +
        (hasGrade ? '<th>年</th>' : '') + heads + (opts.noRate ? '' : '<th>評価</th>') + '</tr></thead><tbody>' + body + '</tbody></table></div>';
    };
    return part(rows, false);
  }

  /** サッカー選手の詳細（FCと同じ主要能力と、細かい能力） */
  function socDetail(p) {
    const c = p.socCareer || { g: 0, goals: 0, assists: 0, cs: 0 };
    const isGK = p.soc.pos === 'GK';
    const mainsHtml = '<div class="stats">' +
      Soccer.mainList(p).filter((m) => isGK || m.key !== 'gk').map((m) => UI.stat(m.label, m.value)).join('') + '</div>';
    const subHtml = '';
    return '<div class="pdetail">' +
      '<div class="pdetail__head"><div class="pdetail__name">' + esc(p.name) + '</div>' +
      '<div class="pdetail__meta">' + p.grade + '年　' + esc(Soccer.POS_NAME[p.soc.pos] || '') +
      '　総合 <b>' + Soccer.rating(p) + '</b></div>' +
      (p.from ? '<div class="pdetail__from">' + p.from.year + '年目に ' + esc(p.from.school) + ' から加入</div>' : '') +
      '</div><h4 class="sub">能力</h4>' + mainsHtml + subHtml +
      '<h4 class="sub">サッカー部での成績</h4>' +
      '<p class="note">' + c.g + '試合　得点 ' + c.goals + '　アシスト ' + (c.assists || 0) + '　無失点 ' + c.cs + '</p>' +
      (p.career
        ? '<h4 class="sub">高校野球での通算成績</h4>' +
          (p.kind === 'pitcher' ? UI.careerPitLine(p.career) : UI.careerBatLine(p.career))
        : '') +
      '</div>';
  }

  /** 表や一覧の名前（data-pid）を押したら詳細を開く */
  function bindSocRows(root, S, extraPlayers) {
    root.querySelectorAll('[data-pid]').forEach((el) => el.addEventListener('click', () => {
      const pid = el.dataset.pid;
      let p = Soccer.findP(S, pid);
      if (!p && extraPlayers) p = extraPlayers.find((x) => x.id === pid);
      if (p) UI.modal(socDetail(p), { kind: 'player' });
    }));
  }

  function socLineupRows(S) {
    return S.lineup.slice().sort((a, b) => SOC_POS_ORDER[a.pos] - SOC_POS_ORDER[b.pos])
      .map((x) => ({ p: Soccer.findP(S, x.pid), pos: x.pos })).filter((x) => x.p);
  }

  function socBenchRows(S) {
    const used = new Set(S.lineup.map((x) => x.pid));
    return S.players.filter((p) => !used.has(p.id)).sort((a, b) => Soccer.rating(b) - Soccer.rating(a))
      .map((p) => ({ p, pos: p.soc.pos }));
  }

  function socSection(S, title, rows) {
    return '<h3 class="sub">' + esc(title) + '</h3>' + (rows.length ? socTable(S, rows) : '<p class="note">該当する選手はいません。</p>');
  }

  function socShow(state, eyebrow, title, bodyHtml, primary, secondary) {
    const S = state.soccer;
    UI.el('soccer-eyebrow').textContent = eyebrow;
    UI.el('soccer-title').textContent = title;
    UI.html('soccer-body', bodyHtml);
    UI.el('btn-soccer-primary').textContent = primary;
    const sec = UI.el('btn-soccer-secondary');
    sec.hidden = !secondary;
    if (secondary) sec.textContent = secondary;
    bindSocRows(UI.el('soccer-body'), S);
    UI.show('screen-soccer');
  }

  function soccerStart(state) {
    const S = state.soccer;
    const fall = S.convertedFrom === 'fallPref';
    socShow(state, state.year + '年目', 'サッカー転向',
      '<p class="section-lead">' + (fall ? '秋' : '夏') + 'の県大会でコールド負け。' + esc(S.schoolName) +
      '野球部の部員たちはすっかりやる気を無くし、サッカーを始めてしまった。</p>' +
      '<p class="section-lead">部員はそのままサッカー部に加わり、新しい挑戦が始まる。</p>' +
      socSection(S, '部員（名前を押すと能力が見られます）', socLineupRows(S).concat(socBenchRows(S))),
      fall ? '特訓へ' : 'オフシーズンへ');
  }

  /** 大会開幕（野球の開幕画面と同じ） */
  function soccerOpening(state) {
    const S = state.soccer;
    const label = Game.soccerLabel(S.tour.kind);
    UI.el('opening-year').textContent = state.year + '年目';
    UI.el('opening-title').textContent = label + ' 開幕';
    UI.el('opening-lead').textContent = S.schoolName + 'サッカー部、' + label + 'へ。';
    UI.show('screen-opening');
  }

  function socOppRows(S) {
    return Soccer.buildOpp(S).side.map((x) => ({ p: { id: x.pid, name: x.name, grade: '', soc: x.s, num: x.num }, pos: x.pos }));
  }

  /** 相手チームの表（相手は能力だけ。学年は無い） */
  function socOppTable(rows) {
    return socTable(null, rows.map((x) => ({ p: { id: x.p.id || '', name: x.p.name, grade: '', soc: x.p.soc }, pos: x.pos })), { noClick: true });
  }

  /** 試合開始前（野球の試合前画面と同じ並び：自軍と相手の先発） */
  function soccerPregame(state) {
    const S = state.soccer;
    const round = Soccer.currentRound(S.tour);
    const opp = Soccer.buildOpp(S);
    UI.el('pregame-title').textContent = Game.soccerLabel(S.tour.kind) + '　' + round.name;
    UI.html('pregame-body',
      '<p class="section-lead vs">' + esc(S.schoolName) + '　<i>対</i>　' + esc(opp.name || round.schoolName || '相手校') + '</p>' +
      '<div class="twocol"><div id="pregame-my">' +
        '<div class="lineupcard"><h3 class="lineupcard__title">' + esc(S.schoolName) + '　先発11人（' + esc(S.formation || '4-4-2') + '）</h3>' +
        socTable(S, socLineupRows(S)) + '</div>' +
        socSection(S, '控え', socBenchRows(S)) + '</div>' +
      '<div id="pregame-opp"><div class="lineupcard"><h3 class="lineupcard__title">' + esc(opp.name || '相手校') + '</h3>' +
        socOppTable(socOppRows(S)) + '</div></div></div>');
    bindSocRows(UI.el('pregame-my'), S);
    UI.el('btn-play').textContent = '試合開始';
    UI.el('btn-pregame-lineup').hidden = false;
    UI.el('btn-pregame-lineup').hidden = false;
    UI.show('screen-pregame');
  }

  /** サッカーのオーダー変更。フォーメーションを選び、選手ごとに位置（GK・DF・MF・FW・控え）を決める。
      人数が合わないうちは決定できない */
  function soccerLineupEditor(state, onDone) {
    const S = state.soccer;
    let formation = S.formation || '4-4-2';
    const posOf = {};
    S.players.forEach((p) => { posOf[p.id] = 'BENCH'; });
    S.lineup.forEach((x) => { posOf[x.pid] = x.pos; });
    let showBad = false;

    const current = () => S.players.filter((p) => posOf[p.id] !== 'BENCH').map((p) => ({ pid: p.id, pos: posOf[p.id] }));

    function render() {
      const probs = Soccer.lineupProblems(formation, current());
      const F = Soccer.FORMATIONS[formation];
      const cnt = { GK: 0, DF: 0, MF: 0, FW: 0 };
      current().forEach((x) => { cnt[x.pos]++; });
      const chips = Object.keys(Soccer.FORMATIONS).map((f) =>
        '<button type="button" class="spick__item soc-form' + (f === formation ? ' is-on' : '') + '" data-f="' + f + '">' + f + '</button>').join('');
      const count = Soccer.POS.map((k) =>
        '<span class="soc-cnt' + (cnt[k] !== F[k] ? ' is-bad' : '') + '">' + k + ' ' + cnt[k] + '/' + F[k] + '</span>').join('');
      const order = { GK: 0, DF: 1, MF: 2, FW: 3, BENCH: 4 };
      const rows = S.players.slice().sort((a, b) =>
        (order[posOf[a.id]] - order[posOf[b.id]]) || (Soccer.rating(b) - Soccer.rating(a))).map((p) => {
        const pos = posOf[p.id];
        const opts = ['BENCH'].concat(Soccer.POS).map((k) =>
          '<option value="' + k + '"' + (k === pos ? ' selected' : '') + '>' + (k === 'BENCH' ? '控' : k) + '</option>').join('');
        const rate = pos === 'BENCH' ? '―' : Math.round(Soccer.rateFor(p.soc, pos));
        return '<tr class="' + (pos === 'BENCH' ? 'is-bench' : '') + '">' +
          '<td class="c"><select class="possel soc-pos" data-pid="' + p.id + '">' + opts + '</select></td>' +
          '<td class="nm">' + esc(p.name) + '</td><td class="c">' + p.grade + '</td>' +
          '<td class="c">' + esc(p.soc.pos) + '</td>' +
          Soccer.mainList(p).map((v) => '<td class="c">' + UI.rankNum(v.value) + '</td>').join('') +
          '<td class="c hl">' + rate + '</td></tr>';
      }).join('');
      const warn = showBad && probs.length
        ? '<p class="luwarn">人数が合いません（' + probs.map((x) => x.pos + ' ' + x.now + '/' + x.need).join('・') + '）。直してから決定してください。</p>' : '';
      return '<h3 class="modal__title">オーダー変更</h3>' +
        '<p class="note">フォーメーションを選び、位置の欄で GK・DF・MF・FW・控 を決めます。評価は、いま選んでいる位置での強さです。</p>' +
        '<div class="spick soc-forms">' + chips + '</div>' +
        '<p class="soc-cnts">' + count + '</p>' + warn +
        '<div class="tablewrap"><table class="growth"><thead><tr><th>位置</th><th class="nm">選手</th><th>年</th><th>適性</th>' +
          Soccer.STATS.map((x) => '<th>' + esc(x.label) + '</th>').join('') + '<th>評価</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<div class="actions actions--modal">' +
          '<button type="button" class="btn" id="soc-auto">おまかせ</button>' +
          '<button type="button" class="btn btn--primary" id="soc-done">決定</button>' +
        '</div>';
    }

    function refresh() {
      UI.html('modal-body', render());
      wire(UI.el('modal-body'));
    }

    function wire(body) {
      body.querySelectorAll('.soc-form').forEach((b) => b.addEventListener('click', () => { formation = b.dataset.f; refresh(); }));
      body.querySelectorAll('.soc-pos').forEach((sel) => sel.addEventListener('change', () => { posOf[sel.dataset.pid] = sel.value; refresh(); }));
      body.querySelector('#soc-auto').addEventListener('click', () => {
        const tmp = { players: S.players, formation, lineup: [] };
        Soccer.autoLineup(tmp, formation);
        S.players.forEach((p) => { posOf[p.id] = 'BENCH'; });
        tmp.lineup.forEach((x) => { posOf[x.pid] = x.pos; });
        showBad = false;
        refresh();
      });
      body.querySelector('#soc-done').addEventListener('click', () => {
        if (!Soccer.setLineup(S, formation, current())) { showBad = true; refresh(); return; }
        UI.closeModal();
        if (onDone) onDone();
      });
    }

    UI.modal(render(), { kind: 'lineup', onOpen: wire });
  }

  /** 勝敗（野球の勝敗画面と同じ形） */
  function soccerVerdict(state, res) {
    const S = state.soccer;
    const label = Game.soccerLabel(S.tour.kind);
    const isLast = S.tour.index >= S.tour.rounds.length - 1;
    const myKey = res.home ? 'home' : 'away';
    const goals = res.events.filter((e) => e.kind === 'goal' && e.side === myKey);
    const scorers = {};
    goals.forEach((e) => { scorers[e.name] = (scorers[e.name] || 0) + 1; });
    const lead = res.win
      ? (isLast ? label + '　優勝。' : '次の試合へ進む。')
      : ((S.tour.kind === 'fallPref' && isLast) ? '秋季地区大会へ。' : (S.tour.kind === 'local' || S.tour.kind === 'national' ? 'オフシーズンへ。' : (S.tour.kind === 'spring' ? '新入生の入部へ。' : '特訓へ。')));
    UI.html('verdict-body',
      '<div class="verdict__box' + (res.win ? ' is-win' : ' is-lose') + '">' +
        '<p class="verdict__where">' + esc(label) + '　' + esc(res.roundName) + '</p>' +
        '<h2 class="verdict__word">' + (res.win ? '勝利' : '敗戦') + '</h2>' +
        '<p class="verdict__score">' + esc(S.schoolName) + ' <b>' + res.my + '</b> - <b>' + res.op + '</b> ' + esc(res.oppName) + '</p>' +
        (res.pk ? '<p class="verdict__note">PK戦 ' + (res.home ? res.pk.home : res.pk.away) + '−' + (res.home ? res.pk.away : res.pk.home) + '</p>'
          : (res.extra ? '<p class="verdict__note">延長戦</p>' : '')) +
        (Object.keys(scorers).length
          ? '<p class="verdict__lead">得点　' + Object.keys(scorers).map((n) => esc(n) + (scorers[n] > 1 ? '×' + scorers[n] : '')).join('　') + '</p>' : '') +
        '<p class="verdict__lead">' + esc(lead) + '</p>' +
      '</div>');
    UI.el('btn-verdict-share').hidden = false;
    UI.el('btn-verdict-save').hidden = false;
    UI.show('screen-verdict');
  }

  /** 試合後の成長（野球と同じ画面） */
  function soccerGrowth(state, res) {
    const ups = res.ups || [];
    UI.html('growth-body', ups.length
      ? '<div class="grlist">' + ups.map((r) =>
        '<article class="gr"><header class="gr__head"><b>' + esc(r.name) + '</b><span>' + r.grade + '年・' + esc(r.pos) + '</span></header>' +
        '<ul class="gr__list">' + r.ups.map((u) =>
          '<li><span class="gr__label">' + esc(u.label) + '</span><span class="gr__up">+' + u.amount + '</span>' +
          '<span class="gr__val"><span class="gr__from">' + UI.rankSpan(u.before).replace('</span>', ' ' + u.before + '</span>') +
          '</span>→<span class="gr__to">' + UI.rankSpan(u.after).replace('</span>', ' ' + u.after + '</span>') + '</span></span></li>').join('') +
        '</ul></article>').join('') + '</div>'
      : '<p class="note">今回は伸びた選手がいませんでした。</p>');
    UI.show('screen-growth');
  }

  /** 試合結果（野球と同じ画面：スコアボード・得点経過・出場選手・相手チーム） */
  function soccerMatchResult(state, res) {
    const S = state.soccer;
    const label = Game.soccerLabel(S.tour.kind);
    const myKey = res.home ? 'home' : 'away';
    UI.el('result-title').textContent = label + '　' + res.roundName + '　' + (res.win ? '勝利' : '敗戦');
    // 前半・後半・延長ごとの得点
    const periods = [['前半', 1, res.half], ['後半', res.half + 1, res.total]];
    if (res.extra) periods.push(['延長', res.total + 1, res.total + 20]);
    const per = (side) => periods.map(([, a, b]) => res.events.filter((e) => e.kind === 'goal' && e.side === side && e.min >= a && e.min <= b).length);
    const row = (name, side) => {
      const g = per(side);
      return '<tr><th class="sb-team">' + esc(name) + '</th>' + g.map((n) => '<td>' + n + '</td>').join('') +
        '<td class="sb-tot">' + g.reduce((a, b) => a + b, 0) + '</td>' +
        (res.pk ? '<td>' + res.pk[side] + '</td>' : '') + '</tr>';
    };
    const board = '<div class="tablewrap"><table class="scoreboard"><thead><tr><th class="sb-team"></th>' +
      periods.map(([n]) => '<th>' + n + '</th>').join('') + '<th class="sb-tot">計</th>' + (res.pk ? '<th>PK</th>' : '') +
      '</tr></thead><tbody>' + row(S.schoolName, myKey) + row(res.oppName, myKey === 'home' ? 'away' : 'home') + '</tbody></table></div>';
    const goalLines = res.events.filter((e) => e.kind === 'goal').map((e) => {
      const mine = e.side === myKey;
      const ast = e.assist ? (res.myLineup.concat(res.oppLineup).find((p) => p.pid === e.assist) || {}).name : '';
      return '<li class="soccer-log__item soccer-log__item--goal' + (mine ? ' is-mine' : '') + '"><span class="soccer-log__min">' + e.min + '分</span>' +
        '<span class="soccer-log__text">' + esc(e.name) + '（' + esc(mine ? S.schoolName : res.oppName) + '）' + (ast ? '　アシスト ' + esc(ast) : '') + '</span></li>';
    }).join('');
    // 自軍の出場選手の内訳（得点・アシスト）
    const stat = res.myLineup.map((p) => {
      const g = res.events.filter((e) => e.kind === 'goal' && e.side === myKey && e.pid === p.pid).length;
      const a = res.events.filter((e) => e.kind === 'goal' && e.side === myKey && e.assist === p.pid).length;
      const sh = res.events.filter((e) => e.side === myKey && e.pid === p.pid).length;
      return '<tr class="prow" data-pid="' + p.pid + '"><td class="c">' + p.num + '</td><td class="c">' + esc(p.pos) + '</td><td class="nm">' + esc(p.name) +
        '</td><td class="c">' + sh + '</td><td class="c">' + g + '</td><td class="c">' + a + '</td></tr>';
    }).join('');
    UI.html('result-body',
      '<p class="result-score' + (res.win ? ' is-win' : ' is-lose') + '">' + esc(S.schoolName) + ' <b>' + res.my + '</b> - <b>' + res.op + '</b> ' + esc(res.oppName) +
        (res.pk ? '<i>（PK戦）</i>' : (res.extra ? '<i>（延長）</i>' : '')) + '</p>' +
      board +
      '<h4 class="sub">得点の経過</h4>' + (goalLines ? '<ul class="soccer-log__list">' + goalLines + '</ul>' : '<p class="note">得点はありませんでした。</p>') +
      '<h4 class="sub">' + esc(S.schoolName) + '　出場選手</h4>' +
      '<div class="tablewrap"><table class="growth"><thead><tr><th>番号</th><th>位置</th><th class="nm">選手</th><th>シュート</th><th>得点</th><th>アシスト</th></tr></thead><tbody>' + stat + '</tbody></table></div>' +
      '<details class="rosterbox"><summary>' + esc(res.oppName) + 'の選手</summary>' +
        socOppTable(res.oppLineup.map((x) => ({ p: { name: x.name, soc: x.s }, pos: x.pos }))) + '</details>');
    bindSocRows(UI.el('result-body'), S);
    const isLast = S.tour.index >= S.tour.rounds.length - 1;
    UI.el('btn-result-next').textContent = res.win
      ? (isLast ? '次へ' : '次の試合へ')
      : ((S.tour.kind === 'local' || S.tour.kind === 'national') ? 'オフシーズンへ'
        : (S.tour.kind === 'fallPref' && isLast ? '秋季地区大会へ' : (S.tour.kind === 'spring' ? '新入生の入部へ' : '特訓へ')));
    UI.show('screen-result');
  }

  /** 県大会優勝・全国大会優勝（野球と同じ画面を使う） */
  function soccerCelebrate(state, kind) {
    const S = state.soccer;
    const year = '<p class="champ__eyebrow">' + state.year + '年目</p>';
    if (kind === 'national') {
      UI.html('champion-body',
        '<div class="champ champ--grand">' +
          confetti(28, ['#ffd43b', '#ffffff', '#ff5a6e', '#7cc4ff', '#5fd67e']) + year +
          '<h2 class="champ__title">' + esc(state.settings.nationalName) + ' 優勝</h2>' +
          '<p class="champ__school">' + esc(S.schoolName) + ' サッカー部</p>' +
          '<div class="champ__rays" aria-hidden="true"></div>' +
          '<p class="champ__lead">サッカー部が、全国の頂点に立った。</p>' +
          '<p class="champ__note">' + state.year + '年目の夏、日本一。</p>' +
        '</div>');
      UI.show('screen-champion');
    } else {
      UI.html('localwin-body',
        '<div class="champ champ--local">' +
          confetti(18, ['#1f9447', '#ffd43b', '#7cc4ff', '#ffffff']) + year +
          '<h2 class="champ__title">県大会 優勝</h2>' +
          '<p class="champ__school">' + esc(S.schoolName) + ' サッカー部</p>' +
          '<div class="champ__rays" aria-hidden="true"></div>' +
          '<p class="champ__lead">サッカー部が県の代表として、' + esc(state.settings.nationalName) + 'へ駒を進めた。</p>' +
        '</div>');
      UI.show('screen-localwin');
    }
  }

  /** 夏のあとのオフシーズン。3年生の引退（能力つき） */
  function soccerOffseason(state, canRevive) {
    const S = state.soccer;
    const out = Soccer.retiring(S).sort((a, b) => Soccer.rating(b) - Soccer.rating(a))
      .map((p) => ({ p, pos: p.soc.pos }));
    const rest = S.players.filter((p) => p.grade < 3).sort((a, b) => Soccer.rating(b) - Soccer.rating(a))
      .map((p) => ({ p, pos: p.soc.pos }));
    socShow(state, state.year + '年目　オフシーズン', S.schoolName + '　サッカー部',
      (S.lastChampion ? '<p class="section-lead">サッカー部として優勝した！</p>' : '') +
      '<p>サッカー部として' + S.seasons + 'シーズン目の夏を終えた。' + (S.titles ? '（優勝' + S.titles + '回）' : '') + '</p>' +
      socSection(S, '引退する3年生（' + out.length + '人）', out) +
      socSection(S, '残る部員', rest) +
      (canRevive ? '<p class="section-lead">野球部を復活させられる。</p>' : ''),
      '特訓へ', canRevive ? '野球部を復活させる' : '');
  }

  /** 特訓の画面（野球と同じ画面。誰がどの能力で上がるかを、いまの能力と並べて見せる） */
  function soccerTraining(state) {
    const S = state.soccer;
    const st = S.training;
    UI.el('train-picks').textContent = Math.min(st.picks + 1, st.pickLimit);
    UI.el('train-picks-max').textContent = st.pickLimit;
    UI.el('train-passes').textContent = st.passes;
    UI.el('train-passes-max').textContent = st.passLimit;
    const card = st.card;
    if (card) {
      const groups = [];
      const seen = new Map();
      card.targets.forEach((t) => {
        if (!seen.has(t.pid)) { const g = { pid: t.pid, ups: [] }; seen.set(t.pid, g); groups.push(g); }
        seen.get(t.pid).ups.push(t);
      });
      const lines = groups.map((g) => {
        const p = Soccer.findP(S, g.pid);
        if (!p) return '';
        const sorder = (k) => Soccer.STATS.findIndex((x) => x.key === k);
        const ups = g.ups.slice().sort((a, b) => sorder(a.key) - sorder(b.key))
          .map((t) => esc(t.label) + ' +' + t.amount).join('　');
        const keys = p.soc.pos === 'GK' ? Soccer.GK_KEYS : Soccer.FIELD_KEYS;
        const chips = Soccer.STATS.filter((stt) => keys.indexOf(stt.key) >= 0).map((stt) => {
          const t = g.ups.find((x) => x.key === stt.key);
          const now = p.soc[stt.key];
          const after = t ? RNG.stat(now + t.amount) : null;
          const up = after != null && after !== now;
          return '<span class="ts' + (up ? ' is-up' : '') + '"><i>' + esc(stt.label) + '</i>' +
            (up ? UI.rankNum(now) + '<em>→</em>' + UI.rankNum(after) : UI.rankNum(now)) + '</span>';
        }).join('');
        return '<li class="tcard">' +
          '<div class="tcard__head"><button type="button" class="linkbtn tcard__name" data-pid="' + p.id + '">' + esc(p.name) + '</button>' +
            '<span>' + p.grade + '年・' + esc(p.soc.pos) + '</span>' +
            '<em class="tcard__up">' + ups + '</em></div>' +
          '<div class="tcard__stats">' + chips + '</div></li>';
      }).join('');
      UI.html('train-card',
        '<div class="traincard traincard--' + card.tier + (card.multi ? ' is-multi' : '') + '">' +
          '<p class="traincard__kind">' + esc(card.title) +
            '<span class="traincard__n">' + groups.length + '人</span>' +
            (card.multi ? '<span class="traincard__multi">複数</span>' : '') +
            (card.tierLabel ? '<span class="traincard__tier">' + esc(card.tierLabel) + '</span>' : '') +
          '</p><ul class="traincard__list">' + lines + '</ul></div>');
      bindSocRows(UI.el('train-card'), S);
    } else {
      UI.html('train-card', '');
    }
    const passBtn = UI.el('btn-train-pass');
    const left = st.passLimit - st.passes;
    passBtn.disabled = !Soccer.canPass(st);
    passBtn.textContent = left > 0 ? '見送る（あと' + left + '回）' : '見送れません';
    UI.show('screen-training');
  }

  function soccerTrainingResult(state, nextLabel) {
    const rows = Soccer.trainingSummary(state.soccer.training);
    UI.html('train-result', rows.length
      ? '<div class="tablewrap"><table class="growth"><thead><tr><th class="nm">選手</th><th>年</th><th>項目</th><th>上がり幅</th><th>変化</th></tr></thead><tbody>' +
        rows.map((r) => '<tr><td class="nm">' + esc(r.name) + '</td><td class="c">' + r.grade + '</td>' +
          '<td>' + esc(r.label) + '</td><td class="c up"><b class="gr__up">+' + r.amount + '</b></td>' +
          '<td class="c">' + UI.rankNum(r.before) + '<em>→</em>' + UI.rankNum(r.after) + '</td></tr>').join('') +
        '</tbody></table></div>'
      : '<p class="note">今回は伸びた選手がいませんでした。</p>');
    UI.el('btn-train-done').textContent = nextLabel;
    UI.show('screen-training-result');
  }

  /** 春の大会に出られるかどうかの発表（野球と同じ） */
  function soccerSpringResult(state, qualified) {
    const S = state.soccer;
    const name = state.settings.springName;
    const body = qualified
      ? '<div class="champ champ--spring">' +
          confetti(16, ['#7cc4ff', '#ffffff', '#ffd43b', '#3b82ea']) +
          '<p class="champ__eyebrow">' + state.year + '年目</p>' +
          '<h2 class="champ__title">' + esc(name) + ' 出場決定</h2>' +
          '<p class="champ__school">' + esc(S.schoolName) + ' サッカー部</p>' +
          '<div class="champ__rays" aria-hidden="true"></div>' +
          '<p class="champ__lead">秋の大会の成績が認められ、来年の' + esc(name) + 'への出場が決まった。</p></div>'
      : '<div class="champ champ--miss"><p class="champ__eyebrow">' + state.year + '年目</p>' +
          '<h2 class="champ__title">' + esc(name) + ' 出場ならず</h2>' +
          '<p class="champ__school">' + esc(S.schoolName) + ' サッカー部</p>' +
          '<p class="champ__lead">今回は選ばれなかった。新しい仲間を迎えて、また夏を目指そう。</p></div>';
    UI.html('spring-result-body', body);
    UI.el('btn-spring-result-next').textContent = qualified ? (name + 'へ') : '新入生の入部';
    UI.show('screen-spring-result');
  }

  /** 新入生の候補（野球と同じ、何組かから1組を選ぶ） */
  function soccerNewcomers(state, onSelect) {
    const S = state.soccer;
    UI.el('pick-title').textContent = '新入生（サッカー部）';
    UI.el('pick-lead').textContent = S.need + '人ひと組の候補が' + S.sets.length + 'つ。入部させる組を選んでください。';
    const html = S.sets.map((players, i) =>
      '<article class="dataset"><header class="dataset__head">' +
        '<h3 class="dataset__no">候補 ' + (i + 1) + '</h3>' +
        '<p class="dataset__meta">' + players.length + '人　注目： ' + esc(players[0].name) + '</p>' +
        '<button type="button" class="btn btn--primary dataset__pick" data-i="' + i + '">この新入生たちを迎える</button>' +
      '</header>' + socTable(S, players.map((p) => ({ p, pos: p.soc.pos }))) + '</article>').join('');
    UI.html('pick-list', html);
    const list = UI.el('pick-list');
    list.querySelectorAll('.dataset__pick').forEach((b) => b.addEventListener('click', () => onSelect(+b.dataset.i)));
    bindSocRows(list, S, [].concat.apply([], S.sets));
    UI.show('screen-pick');
  }

  return {
    pick, ready, training, trainingResult, opening, pregame,
    poachWin, poachRelease, poachSuccess, poachFailed, champion, celebrate, springResult, offseason, settings, lineupCard, bindRows,
    abilityLine, pitchText, verdict, growth, nextUp, trainingIntro, setOnChange,
    localWin, soccerStart, soccerOpening, soccerPregame, soccerVerdict, soccerGrowth, soccerMatchResult, soccerLineupEditor, soccerCelebrate, soccerOffseason,
    soccerTraining, soccerTrainingResult, soccerSpringResult, soccerNewcomers,
  };
})();
