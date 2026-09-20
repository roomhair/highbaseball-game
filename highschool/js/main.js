/* ==================================================
   高校野球  main.js

   進行の全体。どの画面の次がどの画面かは、ここだけを見れば分かる。

     チーム作り → 特訓 → 地方大会 → 全国大会 → オフシーズン → 特訓 → …

   ・state は丸ごと保存できる形（ただのオブジェクトと配列）にしてある。
     途中で閉じても、phase を見れば同じところから再開できる。
   ================================================== */
'use strict';

const Game = (() => {

  let state = null;
  /* 試合の中身は保存しない（大きいので）。勝敗画面から成績画面までのあいだ、
     ここに置いておくだけ */
  let lastSim = null;

  /* ---------- 状態 ---------- */

  function fresh() {
    return {
      year: 1,
      phase: 'pick-bat',
      settings: Storage.loadSettings(),
      team: null,
      tour: null,
      opponent: null,
      training: null,
      sets: null,          // いま選ばせているデータセット
      need: null,          // 新入生の必要人数
      usedSchools: [],     // 使った高校名（同じ名前を出さないため）
      history: [],
      mySide: 'home',
      lastResult: null,
      poachedFrom: null,
      returnScreen: 'screen-top',
    };
  }

  /* チームが出来る前は保存しない。設定だけ触って戻ったときに
     「続きから」が出てしまうため */
  function save() { if (state && state.team) Storage.save(state); }

  function tourLabel() {
    return state.tour && state.tour.kind === 'national'
      ? state.settings.nationalName : '地方大会';
  }

  /* ---------- チーム作り ---------- */

  function start() {
    state = fresh();
    Player.setSeq(1);
    pickBatters();
  }

  function pickBatters() {
    state.phase = 'pick-bat';
    state.sets = state.sets && state.sets.kind === 'bat' ? state.sets : { kind: 'bat', list: Dataset.make('batter', CONFIG.PICK_SETS) };
    save();
    Screens.pick({
      title: '野手を選ぶ',
      lead: '13人ひと組のチームが' + CONFIG.PICK_SETS + 'つ。どれか1つを選んでください。選手をタップすると詳しく見られます。',
      setLabel: 'チーム', pickLabel: 'このチームにする',
      sets: state.sets.list,
      onSelect(i) {
        const chosen = state.sets.list[i];
        const used = new Set(state.usedSchools);
        const name = state.settings.schoolName || NAMES.schoolName(used);
        state.usedSchools = Array.from(used);
        state.team = Team.create(name);
        state.team.batters = chosen;
        state.sets = null;
        pickPitchers();
      },
    });
  }

  function pickPitchers() {
    state.phase = 'pick-pit';
    state.sets = state.sets && state.sets.kind === 'pit' ? state.sets : { kind: 'pit', list: Dataset.make('pitcher', CONFIG.PICK_SETS) };
    save();
    Screens.pick({
      title: '投手を選ぶ',
      lead: '7人ひと組のチームが' + CONFIG.PICK_SETS + 'つ。どれか1つを選んでください。',
      setLabel: 'チーム', pickLabel: 'このチームにする',
      sets: state.sets.list,
      onSelect(i) {
        state.team.pitchers = state.sets.list[i];
        state.sets = null;
        Team.autoLineup(state.team);
        toReady();
      },
    });
  }

  function toReady() {
    state.phase = 'ready';
    save();
    Screens.ready(state);
  }

  /* ---------- 特訓 ---------- */

  function startTraining() {
    state.phase = 'training';
    state.training = Training.start(state.team);
    save();
    Screens.training(state);
  }

  function trainTake() {
    Training.choose(state.training, state.team);
    save();
    if (state.training.done) showTrainingResult();
    else Screens.training(state);
  }

  function trainPass() {
    Training.pass(state.training, state.team);
    save();
    Screens.training(state);
  }

  function showTrainingResult() {
    state.phase = 'training-result';
    save();
    Screens.trainingResult(state, '地方大会へ');
  }

  /* ---------- 大会 ---------- */

  function startTournament(kind) {
    /* 高校名の重複を避けるのはこの大会の中だけ。
       年をまたげば同じ常連校がまた出てくる */
    const used = new Set();
    /* 相手の強さは自軍に合わせて動かさない。決められた強さの相手が並ぶので、
       チームが強くなればそのぶん勝ち上がれる。
       年ごとに少しだけゆらぎを入れて、当たり年・外れ年を作る */
    const F = CONFIG.FIELD;
    let j = 1 + (Math.random() * 2 - 1) * F.yearJitter;
    /* まれに顔ぶれが大きく変わる。手薄な年に当たれば、
       まだ力の足りないチームにも勝ち上がる目が出る */
    if (RNG.chance(F.oddYear)) {
      const r = RNG.chance(0.5) ? F.weakYear : F.strongYear;
      j = r[0] + Math.random() * (r[1] - r[0]);
    }
    let from, to;
    if (kind === 'local') {
      from = F.local.from * j;
      to = F.local.to * j;
      state.localJitter = j;
    } else {
      /* 全国大会の1回戦は、地方大会の決勝と同じくらいの強さから */
      from = state.localFinalLevel || F.local.to * (state.localJitter || 1);
      to = Math.max(from * 1.15, F.national.to * (state.localJitter || 1));
    }
    state.tour = Tournament.create(kind, from, to, used);
    Growth.resetTour(state.team);
    state.phase = 'opening';
    save();
    /* 先に開幕画面を描いてから幕を下ろす。幕が開いたときに
       前の画面が残っていないようにするため */
    Screens.opening(state);
    UI.curtain(
      '<b>' + (kind === 'national' ? UI.esc(state.settings.nationalName) : '地方大会') + '</b><span>開幕</span>',
      function () {}
    );
  }

  function toPregame() {
    const r = Tournament.currentRound(state.tour);
    if (!r) { finishTournament(true); return; }
    if (!state.opponent || state.opponent.__round !== state.tour.index) {
      state.opponent = Tournament.buildOpponent(state.tour);
      state.opponent.__round = state.tour.index;
    }
    /* 先攻・後攻はその都度決める */
    state.mySide = RNG.chance(0.5) ? 'home' : 'away';
    state.phase = 'pregame';
    save();
    Screens.pregame(state);
  }

  function playGame() {
    const away = state.mySide === 'away' ? state.team : state.opponent;
    const home = state.mySide === 'away' ? state.opponent : state.team;
    const round = Tournament.currentRound(state.tour);
    /* 全国大会はコールドゲームなし。地方大会も決勝だけは行わない */
    const noCold = state.tour.kind === 'national' || (round && round.name === '決勝');
    const res = Sim.play(away, home, { noCold });
    state.phase = 'game';
    GameScreen.start({ away, home }, res, () => afterGame(res));
  }

  function afterGame(res) {
    const my = state.mySide === 'away' ? res.away : res.home;
    const op = state.mySide === 'away' ? res.home : res.away;
    const win = my.runs > op.runs;
    const round = Tournament.currentRound(state.tour);

    const ctx = {
      year: state.year,
      tourLabel: state.tour.kind,
      tourName: tourLabel(),
      roundName: round.name,
      oppName: state.opponent.name,
      win,
      walkoff: res.walkoff && state.mySide === 'home',
    };
    const report = Growth.afterGame(state.team, ctx);
    Growth.afterGame(state.opponent, Object.assign({}, ctx, { win: !win, oppName: state.team.name }));
    Growth.commitStats(state.team);
    Growth.commitStats(state.opponent);
    Team.restPitchers(state.team);
    Team.restPitchers(state.opponent);

    /* 成長画面で「誰が」を分かりやすくするため、いまの役割も添えておく */
    report.forEach((r) => {
      const p = Team.find(state.team, r.pid);
      r.role = p ? UI.roleText(state.team, p) : '';
    });

    state.tour.games++;
    state.tour.runsFor += my.runs;
    state.tour.runsAgainst += op.runs;
    state.lastResult = {
      win, myRuns: my.runs, opRuns: op.runs, round: round.name,
      oppName: state.opponent.name, tourName: tourLabel(),
      cold: res.cold, walkoff: ctx.walkoff,
      last: state.tour.index >= state.tour.rounds.length - 1,
    };
    state.lastReport = report;

    lastSim = { res, meta: { mySide: state.mySide, roundName: round.name, tourLabel: tourLabel(), report } };

    state.phase = 'verdict';
    save();
    Screens.verdict(state);
  }

  function toGrowth() {
    state.phase = 'growth';
    save();
    Screens.growth(state);
  }

  function toResult() {
    if (!lastSim) { afterResult(); return; }
    state.phase = 'result';
    save();
    const r = state.lastResult;
    const btn = UI.el('btn-result-next');
    btn.textContent = r.win
      ? (r.last
          ? (state.tour.kind === 'local' ? state.settings.nationalName + 'へ' : '優勝！')
          : '引き抜きへ')
      : 'オフシーズンへ';
    GameScreen.result(state, lastSim.res, lastSim.meta);
  }

  function afterResult() {
    if (state.lastResult.win) toPoach();
    else lose();
  }

  /* ---------- 引き抜き ---------- */

  function toPoach() {
    state.phase = 'poach';
    save();
    Screens.poachWin(state,
      (p) => {
        Screens.poachRelease(state, p,
          (out) => { doPoach(p, out); },
          () => toPoach());
      },
      () => advanceRound());
  }

  function doPoach(incoming, outgoing) {
    /* どこから来たのかを覚えておく。詳細画面と引退のときに出す */
    incoming.from = { year: state.year, school: state.opponent.name };
    incoming.fatigue = 0;

    const list = incoming.kind === 'pitcher' ? state.team.pitchers : state.team.batters;
    const idx = list.findIndex((x) => x.id === outgoing.id);
    /* 放出した選手がいた場所に、そのまま入れる。
       オーダーも投手の起用順も、その枠だけ差し替える（勝手に組み直さない） */
    if (idx >= 0) list.splice(idx, 1, incoming); else list.push(incoming);

    state.team.lineup = state.team.lineup.map((sl) =>
      (sl.pid === outgoing.id ? { pid: incoming.id, pos: sl.pos } : sl));
    state.team.rotation = (state.team.rotation || []).map((id) =>
      (id === outgoing.id ? incoming.id : id));
    if (incoming.kind === 'pitcher' && state.team.rotation.indexOf(incoming.id) < 0) {
      state.team.rotation.push(incoming.id);
    }
    advanceRound();
  }

  function advanceRound() {
    state.tour.index++;
    state.opponent = null;
    if (state.tour.index >= state.tour.rounds.length) { finishTournament(true); return; }
    /* いきなり試合前の画面に行かず、次に誰と当たるのかを一度見せる */
    state.phase = 'nextup';
    save();
    Screens.nextUp(state);
  }

  /* ---------- 大会の終わり ---------- */

  function finishTournament(won) {
    if (won && state.tour.kind === 'local') {
      state.localFinalLevel = state.tour.finalLevel;
      state.history.push({ year: state.year, tour: 'local', result: '優勝' });
      startTournament('national');
      return;
    }
    if (won && state.tour.kind === 'national') {
      state.history.push({ year: state.year, tour: 'national', result: '優勝' });
      state.phase = 'champion';
      save();
      Screens.champion(state);
      UI.curtain('<b>' + UI.esc(state.settings.nationalName) + '</b><span>優勝</span>', function () {});
      return;
    }
    toOffseason();
  }

  function lose() {
    const round = state.lastResult.round;
    state.history.push({
      year: state.year, tour: state.tour.kind,
      result: round + '敗退',
    });
    /* 負けたとき、設定が入っていれば一番いい選手を引き抜かれる。
       誰を取られたのかはオフシーズン画面の頭に出す（ふきだしだと
       読み込み直したときに出しそびれる） */
    if (state.settings.poach) {
      const best = Team.bestPlayer(state.team);
      if (best) {
        const list = best.kind === 'pitcher' ? state.team.pitchers : state.team.batters;
        const i = list.findIndex((x) => x.id === best.id);
        if (i >= 0) list.splice(i, 1);
        Team.repair(state.team);
        state.poachedFrom = { to: state.opponent.name, player: best };
      }
    }
    toOffseason();
  }

  /* ---------- オフシーズン ---------- */

  function toOffseason() {
    state.phase = 'offseason';
    state.opponent = null;
    Growth.offseasonPractice(state.team);
    Team.healPitchers(state.team);
    const retired = Offseason.retiring(state.team).map(Offseason.farewell);
    state.retiredCount = retired.length;
    save();
    Screens.offseason(state, retired);
  }

  function toNewcomers() {
    state.need = Offseason.graduate(state.team);
    state.year++;
    state.phase = 'new-bat';
    state.sets = null;
    save();
    newcomerBatters();
  }

  function newcomerBatters() {
    if (!state.need.bat) { state.phase = 'new-pit'; newcomerPitchers(); return; }
    state.phase = 'new-bat';
    state.sets = state.sets && state.sets.kind === 'nbat'
      ? state.sets : { kind: 'nbat', list: Dataset.make('batter', CONFIG.NEWCOMER_SETS, state.need.bat) };
    save();
    Screens.pick({
      title: '新入生（野手）',
      lead: state.need.bat + '人ひと組の候補が' + CONFIG.NEWCOMER_SETS + 'つ。入部させる組を選んでください。',
      setLabel: '候補', pickLabel: 'この新入生たちを迎える',
      sets: state.sets.list,
      onSelect(i) {
        Offseason.enroll(state.team, state.sets.list[i]);
        state.sets = null;
        state.phase = 'new-pit';
        newcomerPitchers();
      },
    });
  }

  function newcomerPitchers() {
    if (!state.need.pit) { afterNewcomers(); return; }
    state.sets = state.sets && state.sets.kind === 'npit'
      ? state.sets : { kind: 'npit', list: Dataset.make('pitcher', CONFIG.NEWCOMER_SETS, state.need.pit) };
    save();
    Screens.pick({
      title: '新入生（投手）',
      lead: state.need.pit + '人ひと組の候補が' + CONFIG.NEWCOMER_SETS + 'つ。入部させる組を選んでください。',
      setLabel: '候補', pickLabel: 'この新入生たちを迎える',
      sets: state.sets.list,
      onSelect(i) {
        Offseason.enroll(state.team, state.sets.list[i]);
        state.sets = null;
        afterNewcomers();
      },
    });
  }

  function afterNewcomers() {
    Team.autoLineup(state.team);
    state.poachedFrom = null;
    state.phase = 'train-intro';
    save();
    Screens.trainingIntro(state);
  }

  /* ---------- 再開 ---------- */

  function resume(loaded) {
    state = loaded;
    if (!state.settings) state.settings = Storage.loadSettings();
    applySettings();
    switch (state.phase) {
      case 'pick-bat': pickBatters(); break;
      case 'pick-pit': pickPitchers(); break;
      case 'ready': toReady(); break;
      case 'training': Screens.training(state); break;
      case 'training-result': Screens.trainingResult(state, '地方大会へ'); break;
      case 'opening': Screens.opening(state); break;
      case 'pregame': case 'game': Screens.pregame(state); break;
      /* 試合の中身は保存していないので、その次の処理から続ける */
      case 'verdict': case 'growth': case 'result':
        if (state.lastResult && state.lastResult.win) toPoach(); else lose();
        break;
      case 'nextup': Screens.nextUp(state); break;
      case 'poach': toPoach(); break;
      case 'champion': Screens.champion(state); break;
      case 'offseason':
        Screens.offseason(state, Offseason.retiring(state.team).map(Offseason.farewell)); break;
      case 'new-bat': newcomerBatters(); break;
      case 'new-pit': newcomerPitchers(); break;
      case 'train-intro': Screens.trainingIntro(state); break;
      default: UI.show('screen-top');
    }
  }

  /* ---------- 設定 ---------- */

  function openSettings() {
    state = state || fresh();
    state.returnScreen = UI.currentScreen();
    Screens.settings(state);
  }

  function saveSettings() {
    const nat = UI.el('set-national').value.trim();
    const school = UI.el('set-school').value.trim();
    state.settings.nationalName = nat || CONFIG.DEFAULTS.nationalName;
    state.settings.poach = UI.el('set-poach').checked;
    if (state.team && school) state.team.name = school.slice(0, 14);
    state.settings.schoolName = school;
    Storage.saveSettings(state.settings);
    save();
    applySettings();
    const back = state.returnScreen === 'screen-settings' ? 'screen-top' : state.returnScreen;
    UI.show(back);
    /* 名前を変えたら、いま出ている画面を描き直す */
    if (back === 'screen-ready') Screens.ready(state);
    if (back === 'screen-opening') Screens.opening(state);
    if (back === 'screen-pregame' && state.opponent) Screens.pregame(state);
  }

  /** 全国大会の名前を、画面に出ているところへまとめて反映する */
  function applySettings() {
    const name = (state && state.settings && state.settings.nationalName) || CONFIG.DEFAULTS.nationalName;
    document.querySelectorAll('[data-national]').forEach((n) => { n.textContent = name; });
  }

  function resetAll() {
    UI.confirmBox({
      title: '最初からやり直す',
      body: '保存されている記録がすべて削除されますが、よろしいですか？',
      yes: '削除して最初から',
    }, () => {
      Storage.clear();
      state = fresh();
      applySettings();
      showTopButtons();
      UI.show('screen-top');
    });
  }

  /** トップのボタンの出し方。記録があるかどうかで変わる */
  function showTopButtons() {
    const saved = Storage.load();
    UI.el('btn-continue').hidden = !saved;
    UI.el('btn-start').textContent = saved ? 'はじめから' : 'はじめる';
    UI.el('top-note').textContent = saved ? '前回の続きが残っています。' : '';
  }

  /* ---------- 起動 ---------- */

  function boot() {
    UI.init();
    GameScreen.init();
    state = fresh();
    applySettings();
    showTopButtons();

    const on = (id, fn) => { const n = UI.el(id); if (n) n.addEventListener('click', fn); };

    on('btn-start', () => {
      const begin = () => {
        Storage.clear();
        showTopButtons();
        start();
      };
      if (!Storage.load()) { begin(); return; }
      UI.confirmBox({
        title: 'はじめから',
        body: '保存されている記録が削除されますが、よろしいですか？',
        yes: '削除してはじめる',
      }, begin);
    });
    on('btn-continue', () => { const s = Storage.load(); if (s) resume(s); });
    on('btn-home', () => { showTopButtons(); UI.show('screen-top'); });
    on('btn-settings', openSettings);
    on('btn-settings-save', saveSettings);
    on('btn-settings-reset', resetAll);

    on('btn-ready-lineup', () => UI.lineupEditor(state.team, () => { save(); Screens.ready(state); }));
    on('btn-ready-next', () => startTraining());

    on('btn-train-take', trainTake);
    on('btn-train-pass', trainPass);
    on('btn-train-done', () => startTournament('local'));

    on('btn-open-start', toPregame);
    on('btn-open-lineup', () => UI.lineupEditor(state.team, () => { save(); Screens.opening(state); }));

    on('btn-play', playGame);
    on('btn-verdict-next', toGrowth);
    on('btn-growth-next', toResult);
    const nextup = UI.el('screen-nextup');
    if (nextup) nextup.addEventListener('click', () => {
      if (state && state.phase === 'nextup') toPregame();
    });
    on('btn-pregame-lineup', () => UI.lineupEditor(state.team, () => { save(); Screens.pregame(state); }));

    on('btn-skip', () => GameScreen.skip());
    on('btn-result-next', afterResult);
    on('btn-champion-next', toOffseason);
    const intro = UI.el('screen-trainintro');
    if (intro) intro.addEventListener('click', () => {
      if (state && state.phase === 'train-intro') startTraining();
    });
    on('btn-off-next', toNewcomers);

    if (typeof ADS !== 'undefined') ADS.init();
  }

  return { boot, start, resume, get state() { return state; } };
})();

document.addEventListener('DOMContentLoaded', Game.boot);
