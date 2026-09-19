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
    state.sets = state.sets && state.sets.kind === 'bat' ? state.sets : { kind: 'bat', list: Dataset.make('batter', 5) };
    save();
    Screens.pick({
      title: '野手を選ぶ',
      lead: '13人ひと組のデータセットが5つ。どれか1つを選んでください。選手をタップすると詳しく見られます。',
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
    state.sets = state.sets && state.sets.kind === 'pit' ? state.sets : { kind: 'pit', list: Dataset.make('pitcher', 5) };
    save();
    Screens.pick({
      title: '投手を選ぶ',
      lead: '7人ひと組のデータセットが5つ。どれか1つを選んでください。',
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
    const used = new Set(state.usedSchools);
    /* 地方大会の初戦は、自分のチーム力より少し下から。
       全国大会の初戦は、地方大会の決勝と同じくらいの強さにする。 */
    const base = kind === 'local'
      ? Math.max(16, Math.round(Team.strength(state.team) * 0.52))
      : Math.max(30, state.localFinalLevel || Math.round(Team.strength(state.team) * 1.1));
    state.tour = Tournament.create(kind, base, used);
    state.usedSchools = Array.from(used);
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
    const res = Sim.play(away, home);
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

    state.tour.games++;
    state.tour.runsFor += my.runs;
    state.tour.runsAgainst += op.runs;
    state.lastResult = { win, myRuns: my.runs, opRuns: op.runs, round: round.name };

    state.phase = 'result';
    save();

    const btn = UI.el('btn-result-next');
    btn.textContent = win
      ? (state.tour.index >= state.tour.rounds.length - 1
          ? (state.tour.kind === 'local' ? state.settings.nationalName + 'へ' : '優勝！')
          : '引き抜きへ')
      : 'オフシーズンへ';

    GameScreen.result(state, res, {
      mySide: state.mySide, roundName: round.name, tourLabel: tourLabel(), report,
    });
  }

  function afterResult() {
    if (state.lastResult.win) toPoach();
    else lose();
  }

  /* ---------- 引き抜き ---------- */

  function toPoach() {
    state.phase = 'poach';
    save();
    UI.el('btn-poach-skip').textContent = '引き抜かない';
    Screens.poachWin(state,
      (p) => {
        Screens.poachRelease(state, p,
          (out) => { doPoach(p, out); },
          () => toPoach());
      },
      () => advanceRound());
  }

  function doPoach(incoming, outgoing) {
    const list = incoming.kind === 'pitcher' ? state.team.pitchers : state.team.batters;
    const idx = list.findIndex((x) => x.id === outgoing.id);
    if (idx >= 0) list.splice(idx, 1);
    list.push(incoming);
    Team.repair(state.team);
    Team.autoLineup(state.team);
    advanceRound();
  }

  function advanceRound() {
    state.tour.index++;
    state.opponent = null;
    if (state.tour.index >= state.tour.rounds.length) { finishTournament(true); return; }
    save();
    toPregame();
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
    /* 負けたとき、設定が入っていれば一番いい選手を引き抜かれる */
    if (state.settings.poach) {
      const best = Team.bestPlayer(state.team);
      if (best) {
        const list = best.kind === 'pitcher' ? state.team.pitchers : state.team.batters;
        const i = list.findIndex((x) => x.id === best.id);
        if (i >= 0) list.splice(i, 1);
        Team.repair(state.team);
        state.poachedFrom = { name: best.name, kind: best.kind, to: state.opponent.name };
        UI.modal(
          '<div class="pdetail"><h3 class="modal__title">引き抜き</h3>' +
          '<p class="note">' + UI.esc(state.opponent.name) + 'に <b>' + UI.esc(best.name) + '</b>' +
          '（' + (best.kind === 'pitcher' ? '投手' : '野手') + '）を引き抜かれた。</p>' +
          '<p class="note">空いた枠には、来年の新入生が1人多く入る。</p>' +
          '<div class="actions actions--modal"><button type="button" class="btn btn--primary" id="pm-ok">オフシーズンへ</button></div></div>',
          { onOpen(body) { body.querySelector('#pm-ok').addEventListener('click', () => { UI.closeModal(); toOffseason(); }); } }
        );
        return;
      }
    }
    toOffseason();
  }

  /* ---------- オフシーズン ---------- */

  function toOffseason() {
    state.phase = 'offseason';
    state.opponent = null;
    Growth.offseasonPractice(state.team);
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
      ? state.sets : { kind: 'nbat', list: Dataset.make('batter', 5, state.need.bat) };
    save();
    Screens.pick({
      title: '新入生（野手）',
      lead: state.need.bat + '人ひと組が5つ。入部させる組を選んでください。',
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
      ? state.sets : { kind: 'npit', list: Dataset.make('pitcher', 5, state.need.pit) };
    save();
    Screens.pick({
      title: '新入生（投手）',
      lead: state.need.pit + '人ひと組が5つ。入部させる組を選んでください。',
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
    startTraining();
  }

  /* ---------- 再開 ---------- */

  function resume(loaded) {
    state = loaded;
    if (!state.settings) state.settings = Storage.loadSettings();
    switch (state.phase) {
      case 'pick-bat': pickBatters(); break;
      case 'pick-pit': pickPitchers(); break;
      case 'ready': toReady(); break;
      case 'training': Screens.training(state); break;
      case 'training-result': Screens.trainingResult(state, '地方大会へ'); break;
      case 'opening': Screens.opening(state); break;
      case 'pregame': case 'game': Screens.pregame(state); break;
      /* 結果画面そのものは残していないので、その次の処理から続ける */
      case 'result':
        if (state.lastResult && state.lastResult.win) toPoach(); else lose();
        break;
      case 'poach': toPoach(); break;
      case 'champion': Screens.champion(state); break;
      case 'offseason':
        Screens.offseason(state, Offseason.retiring(state.team).map(Offseason.farewell)); break;
      case 'new-bat': newcomerBatters(); break;
      case 'new-pit': newcomerPitchers(); break;
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

  function applySettings() {
    const n = UI.el('flow-national');
    if (n) n.textContent = (state && state.settings ? state.settings.nationalName : CONFIG.DEFAULTS.nationalName);
  }

  function resetAll() {
    if (!window.confirm('保存されている進行をすべて消して、最初からやり直します。よろしいですか？')) return;
    Storage.clear();
    state = fresh();
    applySettings();
    UI.show('screen-top');
    UI.el('btn-continue').hidden = true;
  }

  /* ---------- 起動 ---------- */

  function boot() {
    UI.init();
    const saved = Storage.load();
    state = fresh();
    applySettings();
    if (saved) {
      UI.el('btn-continue').hidden = false;
      UI.el('top-note').textContent = '前回の続きが残っています。';
    }

    const on = (id, fn) => { const n = UI.el(id); if (n) n.addEventListener('click', fn); };

    on('btn-start', () => {
      if (Storage.load() && !window.confirm('保存されている進行を消して、最初から始めます。よろしいですか？')) return;
      Storage.clear();
      start();
    });
    on('btn-continue', () => { const s = Storage.load(); if (s) resume(s); });
    on('btn-home', () => UI.show('screen-top'));
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
    on('btn-pregame-lineup', () => UI.lineupEditor(state.team, () => { save(); Screens.pregame(state); }));

    on('btn-skip', () => GameScreen.skip());
    on('btn-result-next', afterResult);
    on('btn-champion-next', toOffseason);
    on('btn-off-next', toNewcomers);

    if (typeof ADS !== 'undefined') ADS.init();
  }

  return { boot, start, resume, get state() { return state; } };
})();

document.addEventListener('DOMContentLoaded', Game.boot);
