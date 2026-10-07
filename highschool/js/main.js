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

  /* 特訓の「選択・見送り」の回数。夏と秋の間・（出場した年の）センバツ相当と
     夏の間は選べる回数を絞ってある。秋とセンバツ相当（出なければ夏）の間は
     もとの仕様のまま */
  const TRAIN_LIMITS = {
    normal: { picks: CONFIG.TRAINING.PICKS, passes: CONFIG.TRAINING.PASSES },
    short: { picks: CONFIG.TRAINING.SHORT_PICKS, passes: CONFIG.TRAINING.SHORT_PASSES },
  };

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
      /* 次の特訓が終わったら、どこへ進むか（'local'・'fallPref'・
         'springOrNextSummer'・'nextSummer'）。チーム作り直後は夏の大会へ */
      trainingNext: 'local',
      trainLimits: null,
      /* 秋の地区大会で2位以内に入ったか（センバツ相当に出られるか） */
      springQualified: false,
      /* 学校の「格」の内部スコア（ユーザーには見せない。効果は新入生の強さだけ） */
      prestigeScore: 0,
      /* 夏の地方大会1回戦で負けた連続回数。2になると野球部が解散する */
      firstRoundLosses: 0,
      mode: 'baseball',    // 'baseball' か 'soccer'
      soccer: null,
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
     「続きから」が出てしまうため（サッカー部のときは team が無いので別に見る） */
  function save() { if (state && (state.team || state.mode === 'soccer')) Storage.save(state); }

  /** 学校の格の内部スコアを動かす（勝敗・大会出場・プロ入りなどで呼ぶ）。
      ユーザーには見せない。範囲を超えないようにだけクランプする */
  function addPrestige(delta) {
    const R = CONFIG.SCHOOL_RANK;
    state.prestigeScore = RNG.clamp((state.prestigeScore || 0) + delta, R.MIN, R.MAX);
  }
  /* 画面の中で決まるもの（キャプテンなど）も保存できるようにしておく */
  Screens.setOnChange(save);

  function tourLabel() {
    if (!state.tour) return '地方大会';
    switch (state.tour.kind) {
      case 'national': return state.settings.nationalName;
      case 'fallPref': return '秋季県大会';
      case 'fallDistrict': return '秋季地区大会';
      case 'fallJingu': return state.settings.jinguName;
      case 'spring': return state.settings.springName;
      default: return '地方大会';
    }
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
    /* キャプテンが決まっていなければ進ませない。
       画面側でも押せないようにしてあるが、入口はここ1つなので念のため */
    if (!Team.captain(state.team)) {
      UI.captainPicker(state.team, () => { save(); startTraining(); });
      return;
    }
    state.phase = 'training';
    state.training = Training.start(state.team, state.trainLimits);
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
    Screens.trainingResult(state, trainingNextLabel());
  }

  /** 特訓が終わったあと、どこへ進むかの文言。state.trainingNext で決まる */
  function trainingNextLabel() {
    switch (state.trainingNext) {
      case 'fallPref': return '秋の大会へ';
      /* センバツに出られない場合も、この特訓のあとに向かう先は
         夏そのものではなく、学年を上げて新入生を迎える手続きなので、
         文言もそれに合わせる */
      case 'springOrNextSummer':
        return state.springQualified ? (state.settings.springName + 'へ') : '新入生入部へ';
      /* 新入生を迎えたあとの特訓が終わったら、次はいよいよ夏の大会 */
      case 'nextSummer': return '夏の大会へ';
      default: return '地方大会へ';
    }
  }

  /** 特訓が終わったら実際に次へ進む */
  function trainingDone() {
    switch (state.trainingNext) {
      case 'fallPref': startTournament('fallPref'); break;
      case 'springOrNextSummer':
        /* センバツに出ないと決まった場合も、学年を上げて新入生を迎える
           タイミングは「センバツ相当が終わったあと」と同じ扱いにする */
        if (state.springQualified) startTournament('spring'); else toNewSeason();
        break;
      case 'nextSummer': startTournament('local'); break;
      default: startTournament('local');
    }
  }

  /** 特訓の入口へ。next は特訓が終わったあとに進む先のタグ、
      limits は「選択・見送り」の回数（省略すると今までと同じ回数） */
  function toTrainingPhase(next, limits) {
    state.trainingNext = next;
    state.trainLimits = limits || null;
    state.phase = 'train-intro';
    save();
    Screens.trainingIntro(state);
  }

  /** 秋の大会（県大会・地区大会・神宮大会相当）がすべて終わったあとの特訓。
      今までの特訓と同じ仕様（選択5回・見送り3回）のまま */
  function toPostFallTraining() {
    toTrainingPhase('springOrNextSummer', TRAIN_LIMITS.normal);
  }

  /** センバツ相当が終わったあと。新しい年度として学年を上げ、
      新入生を迎える（その後の特訓は夏と秋の間と同じく選択を絞る） */
  function toPostSpringTraining() {
    toNewSeason();
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
    let from;
    if (kind === 'local') {
      from = F.local.from * j;
      state.localJitter = j;
    } else if (kind === 'national') {
      /* 全国大会の1回戦は、地方大会の決勝の続きから。
         ここだけは相手の強さの期待値を動かさない（rollDrift は平均0）。
         決勝より少し楽な初戦になる年も、少し重い年もある。
         bonus はその上にさらに乗せるぶんで、いまは0 */
      j = state.localJitter || 1;
      from = (state.localFinalLevel || F.local.from * j) +
             (F.national.bonus + Tournament.rollDrift()) * j;
    } else if (kind === 'fallPref') {
      /* 秋は新チーム（3年生引退後）で、県大会から新しいゆらぎで始まる */
      state.fallJitter = j;
      from = F.fallPref.from * j;
    } else if (kind === 'fallDistrict') {
      j = state.fallJitter || 1;
      from = (state.fallPrefFinalLevel || F.fallPref.from * j) + F.fallDistrict.bonus * j;
    } else if (kind === 'fallJingu') {
      j = state.fallJitter || 1;
      from = (state.fallDistrictFinalLevel || 0) + F.fallJingu.bonus * j;
    } else if (kind === 'spring') {
      /* 選抜相当は地方予選が無く、最初から全国区の相手なので独立に始まる */
      state.springJitter = j;
      from = F.spring.from * j;
    }
    state.tour = Tournament.create(kind, from, j, used);
    Growth.resetTour(state.team);
    /* 大きな大会に出場したこと自体で、学校の格が少し上がる */
    const R = CONFIG.SCHOOL_RANK;
    if (kind === 'national') addPrestige(R.NATIONAL_BONUS);
    else if (kind === 'fallJingu') addPrestige(R.JINGU_BONUS);
    else if (kind === 'spring') addPrestige(R.SPRING_BONUS);
    state.phase = 'opening';
    save();
    /* 先に開幕画面を描いてから幕を下ろす。幕が開いたときに
       前の画面が残っていないようにするため */
    Screens.opening(state);
    UI.curtain('<b>' + UI.esc(tourLabel()) + '</b><span>開幕</span>', function () {});
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
    Screens.pregame(state, { onChange: save });
  }

  const clone = (v) => JSON.parse(JSON.stringify(v));

  function playGame() {
    const round = Tournament.currentRound(state.tour);
    /* 全国大会（夏・春・神宮大会相当）はコールドゲームなし。
       地方大会・秋の県大会・地区大会も決勝だけは行わない */
    const BIG_STAGE = ['national', 'spring', 'fallJingu'];
    const noCold = BIG_STAGE.indexOf(state.tour.kind) >= 0 || (round && round.name === '決勝');
    /* この試合ぶんの乱数の種と、試合開始時点の両チームを控えておく。
       これが無いと、途中でブラウザを閉じて開き直したときに試合前まで戻り、
       負けそうな試合を何度でもやり直せてしまう。
       種を決めておけば、開き直しても同じ試合が同じように進む */
    state.liveGame = {
      seed: RNG.newSeed(), noCold, mySide: state.mySide,
      team: clone(state.team), opponent: clone(state.opponent),
      subs: [], step: 0,
    };
    state.phase = 'game';
    save();
    runGame(0);
  }

  /**
   * 試合を動かす。skipTo より前は黙って流す（中断から戻ったとき用）。
   * 交代は記録してあるものを同じところで入れ直すので、同じ試合になる。
   */
  function runGame(skipTo) {
    const g = state.liveGame;
    const away = g.mySide === 'away' ? state.team : state.opponent;
    const home = g.mySide === 'away' ? state.opponent : state.team;
    RNG.seed(g.seed);
    const live = Sim.live(away, home, { noCold: g.noCold, manual: g.mySide });

    /* 記録してある交代を入れ直しながら、見ていたところまで進める */
    const subs = (g.subs || []).slice();
    const target = Math.max(skipTo, subs.length ? subs[subs.length - 1].at : 0);
    let guard = 0;
    const catchUp = () => {
      while (subs.length && subs[0].at <= live.log.length) {
        GameScreen.replaySub(live, state.team, g.mySide, subs.shift());
      }
    };
    catchUp();
    while (live.log.length < target && guard++ < 20000) {
      if (!live.next()) break;
      catchUp();
    }

    const out = [];
    (g.subs || []).forEach((r) => (r.out || []).forEach((id) => out.push(id)));
    GameScreen.start(
      { away, home, mySide: g.mySide, skipTo,
        retired: out,
        onSub(rec) { g.subs.push(rec); g.step = rec.at; save(); },
        onProgress(i) { g.step = i; save(); } },
      live, () => afterGame(live.result));
  }

  /** 中断したところから試合を続ける */
  function resumeGame() {
    const g = state.liveGame;
    if (!g || !g.team || !g.opponent) { Screens.pregame(state, { onChange: save }); return; }
    /* 試合は両チームを書き換えながら進むので、開始時点に巻き戻してから流し直す */
    state.team = clone(g.team);
    state.opponent = clone(g.opponent);
    state.mySide = g.mySide;
    runGame(g.step || 0);
  }

  function afterGame(res) {
    /* 試合が終わったら種を外す。以降はふだんの乱数に戻る */
    RNG.unseed();
    state.liveGame = null;
    const my = state.mySide === 'away' ? res.away : res.home;
    const op = state.mySide === 'away' ? res.home : res.away;
    const win = my.runs > op.runs;
    const round = Tournament.currentRound(state.tour);
    addPrestige(win ? CONFIG.SCHOOL_RANK.WIN : CONFIG.SCHOOL_RANK.LOSE);

    const ctx = {
      year: state.year,
      tourLabel: state.tour.kind,
      tourName: tourLabel(),
      roundName: round.name,
      oppName: state.opponent.name,
      win,
      walkoff: res.walkoff && state.mySide === 'home',
      log: res.log,
      mySide: state.mySide,
    };
    const report = Growth.afterGame(state.team, ctx);
    Growth.afterGame(state.opponent, Object.assign({}, ctx, {
      win: !win, oppName: state.team.name,
      walkoff: res.walkoff && state.mySide === 'away',
      mySide: state.mySide === 'away' ? 'home' : 'away',
    }));
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

    /* 勝敗投手・セーブ・本塁打を、上のほうにまとめて出す */
    const findPit = (key) => {
      let found = null;
      [state.team, state.opponent].forEach((team) => {
        Team.all(team).forEach((p) => {
          if (p.kind === 'pitcher' && p.game[key]) found = { name: p.name, mine: team === state.team };
        });
      });
      return found;
    };
    /* 本塁打は野手だけを見る。投手の game.hr は「被本塁打」の数なので、
       投手も含めてしまうと本塁打を打っていない投手まで出てきてしまう */
    const homers = [];
    [state.team, state.opponent].forEach((team) => {
      (team.batters || []).forEach((p) => {
        if (p.game && p.game.hr) homers.push({ name: p.name, hr: p.game.hr, mine: team === state.team });
      });
    });

    const isLast = state.tour.index >= state.tour.rounds.length - 1;
    state.lastResult = {
      win, myRuns: my.runs, opRuns: op.runs, round: round.name,
      oppName: state.opponent.name, tourName: tourLabel(),
      cold: res.cold, walkoff: ctx.walkoff,
      last: isLast,
      /* 負けたときに次へ進む先の文言（大会によっては、負けても
         次の大会へ進むことがある） */
      loseNext: win ? null : loseNextLabel(state.tour.kind, isLast),
      winPitcher: findPit('w'), losePitcher: findPit('l'), savePitcher: findPit('sv'),
      homers,
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
    /* このボタンは（決勝でも）まず引き抜き画面へ進むだけなので、
       「甲子園へ」「優勝！」のような先の展開を言い切る文言にはしない。
       大会優勝そのものの演出は、結果画面へ進むこの瞬間に出す
       （引き抜きのあとまで待たない）。実際に次の大会へ進む操作は、
       引き抜きのあとに出る専用の画面（地方大会優勝／全国大会優勝）で行う */
    btn.textContent = r.win ? '引き抜きチャレンジへ' : r.loseNext;
    if (r.win && r.last) {
      UI.curtain('<b>' + UI.esc(tourLabel()) + '</b><span>優勝</span>', function () {});
    }
    GameScreen.result(state, lastSim.res, lastSim.meta);
  }

  function afterResult() {
    if (state.lastResult.win) toPoach();
    else lose();
  }

  /** 負けたときの結果画面に出す「次へ」の文言。大会によっては、
      負けても決勝（＝最後の回）まで来ていれば次の大会へ進む */
  function loseNextLabel(kind, isLast) {
    if (kind === 'local' || kind === 'national') return 'オフシーズンへ';
    if (kind === 'fallPref' && isLast) return '秋季地区大会へ';
    return '特訓へ';
  }

  /* ---------- 引き抜き ---------- */

  function toPoach() {
    state.phase = 'poach';
    save();
    Screens.poachWin(state,
      (p) => {
        /* 放出する選手は、挑戦が成功するかどうかより前に選ばせる。
           成功してから選ばせると、放出できる選手がいない
           （区分の部員が他にいない）という事態が起こりうるため */
        Screens.poachRelease(state, p,
          (out) => { attemptPoach(p, out); },
          () => toPoach());
      },
      () => advanceRound());
  }

  function attemptPoach(incoming, outgoing) {
    const round = Tournament.currentRound(state.tour);
    const chance = poachSuccessChance(round ? round.level : 50, state.prestigeScore);
    if (RNG.chance(chance)) {
      doPoach(incoming, outgoing);
      save();
      Screens.poachSuccess(state, incoming, outgoing, () => advanceRound());
    } else {
      Screens.poachFailed(state, incoming, () => advanceRound());
    }
  }

  function doPoach(incoming, outgoing) {
    /* どこから来たのかを覚えておく。詳細画面と引退のときに出す */
    incoming.from = { year: state.year, school: state.opponent.name };
    incoming.staminaCarry = 0;

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
    /* 優勝の演出（カーテン）は、勝った瞬間・結果画面へ進むところで
       すでに出している（toResult）。ここでは実際に次へ進むための
       画面と状態の更新だけを行う */
    const kind = state.tour.kind;
    if (won && kind === 'local') {
      state.localFinalLevel = state.tour.finalLevel;
      state.firstRoundLosses = 0;   // 1回戦で負けていないので、連敗は途切れる
      state.history.push({ year: state.year, tour: 'local', result: '優勝' });
      /* 地方大会と全国大会のあいだは日が空くので、投手の疲れは抜ける */
      Team.healPitchers(state.team);
      state.phase = 'localwin';
      save();
      Screens.localWin(state);
      return;
    }
    if (won && kind === 'national') {
      state.history.push({ year: state.year, tour: 'national', result: '優勝' });
      state.phase = 'champion';
      save();
      Screens.champion(state);
      return;
    }
    if (won && kind === 'fallPref') {
      /* 県大会優勝。そのまま地区大会へ。大会の規模が変わり日程が空くので、
         投手の疲れはここで抜く */
      state.fallPrefFinalLevel = state.tour.finalLevel;
      state.history.push({ year: state.year, tour: 'fallPref', result: '優勝' });
      Team.healPitchers(state.team);
      startTournament('fallDistrict');
      return;
    }
    if (won && kind === 'fallDistrict') {
      /* 地区大会優勝。センバツ相当は確定のうえ、神宮大会相当へ。
         ここも大会の規模が変わるので、投手の疲れを抜く */
      state.fallDistrictFinalLevel = state.tour.finalLevel;
      state.springQualified = true;
      state.history.push({ year: state.year, tour: 'fallDistrict', result: '優勝' });
      Team.healPitchers(state.team);
      startTournament('fallJingu');
      return;
    }
    if (won && kind === 'fallJingu') {
      state.history.push({ year: state.year, tour: 'fallJingu', result: '優勝' });
      toPostFallTraining();
      return;
    }
    if (won && kind === 'spring') {
      state.history.push({ year: state.year, tour: 'spring', result: '優勝' });
      toPostSpringTraining();
      return;
    }
    toOffseason();
  }

  function lose() {
    const kind = state.tour.kind;
    const round = state.lastResult.round;
    const isLast = state.lastResult.last;
    state.history.push({
      year: state.year, tour: kind,
      result: round + '敗退',
    });
    /* 負けたとき、設定が入っていれば一番いい選手を引き抜かれる。
       誰を取られたのかはオフシーズン画面の頭に出す（ふきだしだと
       読み込み直したときに出しそびれる）ため、夏（地方・全国大会）の
       ときだけにしてある。秋・春はオフシーズンまで間が空き、時期の
       ずれた話に見えてしまうため対象外 */
    if (state.settings.poach && (kind === 'local' || kind === 'national')) {
      const best = Team.bestPlayer(state.team);
      if (best) {
        const list = best.kind === 'pitcher' ? state.team.pitchers : state.team.batters;
        const i = list.findIndex((x) => x.id === best.id);
        if (i >= 0) list.splice(i, 1);
        Team.repair(state.team);
        state.poachedFrom = { to: state.opponent.name, player: best };
      }
    }

    /* 秋は「負けても決勝（＝最後の回）まで来ていれば次の大会へ進む」
       （県大会2位以内→地区大会、地区大会2位以内→センバツ相当）。
       地区大会は準優勝でも神宮大会相当には進めない（優勝校だけ） */
    if (kind === 'fallPref') {
      state.fallPrefFinalLevel = state.tour.finalLevel;
      /* 準優勝（決勝で敗退）でも地区大会へは進む。大会の規模が変わるので
         投手の疲れを抜く（県大会の中の敗退なら抜かない） */
      if (isLast) { Team.healPitchers(state.team); startTournament('fallDistrict'); return; }
      toPostFallTraining();
      return;
    }
    if (kind === 'fallDistrict') {
      state.fallDistrictFinalLevel = state.tour.finalLevel;
      if (isLast) state.springQualified = true;
      toPostFallTraining();
      return;
    }
    if (kind === 'fallJingu') { toPostFallTraining(); return; }
    if (kind === 'spring') { toPostSpringTraining(); return; }

    /* 夏の地方大会1回戦で負けると、野球部存続の危機が1年ぶん進む。
       2年連続で1回戦敗退すると、野球部は解散してサッカー部になる */
    if (kind === 'local') {
      state.firstRoundLosses = round === '1回戦' ? (state.firstRoundLosses || 0) + 1 : 0;
      if (state.firstRoundLosses >= 2) { toSoccerConversion(); return; }
    }
    toOffseason();
  }

  /* ---------- サッカー部（野球部解散後の第二の物語） ---------- */

  function toSoccerConversion() {
    const team = state.team;
    state.mode = 'soccer';
    state.soccer = Soccer.start(team);
    state.team = null;
    state.firstRoundLosses = 0;
    state.phase = 'soccer-start';
    save();
    Screens.soccerStart(state);
  }

  /** 都道府県予選の山を組んで始める（サッカー部転換直後だけここから入る） */
  function soccerStartTournament() {
    state.soccer.tour = Soccer.createRegional(Soccer.strength(state.soccer));
    state.phase = 'soccer-pregame';
    save();
    Screens.soccerPregame(state);
  }

  function soccerPlay() {
    const res = Soccer.playUser(state.soccer);
    state.lastSoccerRes = res;
    state.phase = 'soccer-result';
    save();
    Screens.soccerResult(state, res);
  }

  function soccerAfterResult() {
    const res = state.lastSoccerRes;
    if (res.win) {
      const done = Soccer.advance(state.soccer);
      if (done) {
        if (state.soccer.tour.stage === 'regional') {
          /* 都道府県予選を勝ち抜いた。全国大会までの特訓をはさむ */
          state.soccer.regionalFinalLevel = state.soccer.tour.finalLevel;
          soccerToTraining('national');
          return;
        }
        /* 全国大会を勝ち抜いて優勝 */
        state.soccer.titles++;
        state.soccer.everChampion = true;
        toSoccerOffseason(true);
        return;
      }
      state.phase = 'soccer-pregame';
      save();
      Screens.soccerPregame(state);
    } else {
      toSoccerOffseason(false);
    }
  }

  function toSoccerOffseason(champion) {
    state.soccer.seasons++;
    state.soccer.lastChampion = !!champion;
    Soccer.endRetirement(state.soccer);
    Soccer.fillRecruits(state.soccer);
    state.phase = 'soccer-offseason';
    save();
    Screens.soccerOffseason(state, Soccer.canRevive(state.soccer));
  }

  /** シーズンの合間の特訓。next は特訓のあとに向かう先
      （'national' は全国大会、'regional' は来季の都道府県予選） */
  function soccerToTraining(next) {
    state.soccer.trainingNext = next;
    state.soccer.training = Soccer.startTraining(state.soccer);
    state.phase = 'soccer-training';
    save();
    Screens.soccerTraining(state);
  }

  function soccerTrainingChoose() {
    const t = state.soccer.training;
    Soccer.trainingChoose(t, state.soccer);
    save();
    if (t.done) soccerTrainingDone(); else Screens.soccerTraining(state);
  }

  function soccerTrainingPass() {
    const t = state.soccer.training;
    Soccer.trainingPass(t, state.soccer);
    save();
    if (t.done) soccerTrainingDone(); else Screens.soccerTraining(state);
  }

  function soccerTrainingDone() {
    const next = state.soccer.trainingNext;
    state.soccer.training = null;
    if (next === 'national') {
      state.soccer.tour = Soccer.createNational(Soccer.strength(state.soccer), state.soccer.regionalFinalLevel);
    } else {
      state.soccer.tour = Soccer.createRegional(Soccer.strength(state.soccer));
    }
    state.phase = 'soccer-pregame';
    save();
    Screens.soccerPregame(state);
  }

  function soccerContinue() {
    state.year++;
    soccerToTraining('regional');
  }

  function reviveBaseball() {
    if (!Soccer.canRevive(state.soccer)) return;
    state.mode = 'baseball';
    state.soccer = null;
    state.year++;
    state.team = null;
    state.sets = null;
    pickBatters();
  }

  /* ---------- オフシーズン ---------- */

  function toOffseason() {
    state.phase = 'offseason';
    state.opponent = null;
    Growth.offseasonPractice(state.team);
    Team.healPitchers(state.team);
    const retired = Offseason.retiring(state.team).map(Offseason.farewell);
    state.retiredCount = retired.length;
    /* プロ入りした卒業生の分だけ、学校の格が上がる */
    retired.forEach((f) => {
      if (f.draft) addPrestige(CONFIG.SCHOOL_RANK.DRAFT_BONUS[f.draft.round] || 0);
    });
    save();
    Screens.offseason(state, retired);
  }

  /** 夏が終わったあと、3年生だけを引退させる。学年はまだ上げない
      （秋の大会・センバツ相当は、3年生が抜けた今の学年のままで戦う）。
      新入生を迎えて学年を1つ上げるのは、センバツ相当まで終わってから */
  function toPostSummerRetirement() {
    Offseason.retire(state.team);
    toTrainingPhase('fallPref', TRAIN_LIMITS.short);
  }

  /** 秋・センバツ相当がすべて終わった（あるいはセンバツに出られないと
      決まった）あと。新しい年度として学年を1つ上げ、新入生を迎える */
  function toNewSeason() {
    state.need = Offseason.promote(state.team);
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
      ? state.sets : { kind: 'nbat', list: Dataset.make('batter', CONFIG.NEWCOMER_SETS, state.need.bat, schoolRankNewcomerBonus(state.prestigeScore)) };
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
      ? state.sets : { kind: 'npit', list: Dataset.make('pitcher', CONFIG.NEWCOMER_SETS, state.need.pit, schoolRankNewcomerBonus(state.prestigeScore)) };
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
    /* 新入生を迎えたので、来年の夏へ向けた特訓から始める */
    state.springQualified = false;
    toTrainingPhase('nextSummer', TRAIN_LIMITS.short);
  }

  /* ---------- 再開 ---------- */

  function resume(loaded) {
    /* 前の試合の種が残っていることがあるので、いったん外す。
       試合を続けるときは runGame が掛け直す */
    RNG.unseed();
    state = loaded;
    if (!state.settings) state.settings = Storage.loadSettings();
    /* 古い保存データの移行。秋・春の大会を追加する前のデータには
       無いフィールドなので、ここで補っておく */
    if (state.settings.springName == null) state.settings.springName = CONFIG.DEFAULTS.springName;
    if (state.settings.jinguName == null) state.settings.jinguName = CONFIG.DEFAULTS.jinguName;
    if (state.trainingNext == null) state.trainingNext = 'local';
    if (state.springQualified == null) state.springQualified = false;
    if (state.prestigeScore == null) state.prestigeScore = 0;
    if (state.firstRoundLosses == null) state.firstRoundLosses = 0;
    if (state.mode == null) state.mode = 'baseball';
    if (state.training && state.training.pickLimit == null) {
      state.training.pickLimit = CONFIG.TRAINING.PICKS;
      state.training.passLimit = CONFIG.TRAINING.PASSES;
    }
    applySettings();
    switch (state.phase) {
      case 'pick-bat': pickBatters(); break;
      case 'pick-pit': pickPitchers(); break;
      case 'ready': toReady(); break;
      case 'training': Screens.training(state); break;
      case 'training-result': Screens.trainingResult(state, trainingNextLabel()); break;
      case 'opening': Screens.opening(state); break;
      case 'pregame': Screens.pregame(state, { onChange: save }); break;
      /* 試合の途中で閉じたときは、同じ試合の同じところから続ける */
      case 'game': resumeGame(); break;
      /* 試合の中身は保存していないので、その次の処理から続ける */
      case 'verdict': case 'growth': case 'result':
        if (state.lastResult && state.lastResult.win) toPoach(); else lose();
        break;
      case 'nextup': Screens.nextUp(state); break;
      case 'poach': toPoach(); break;
      case 'localwin': Screens.localWin(state); break;
      case 'champion': Screens.champion(state); break;
      case 'offseason':
        Screens.offseason(state, Offseason.retiring(state.team).map(Offseason.farewell)); break;
      case 'new-bat': newcomerBatters(); break;
      case 'new-pit': newcomerPitchers(); break;
      case 'train-intro': Screens.trainingIntro(state); break;
      case 'soccer-start': Screens.soccerStart(state); break;
      case 'soccer-pregame': Screens.soccerPregame(state); break;
      /* サッカーの試合の中身は保存していないので、結果画面には戻れない。
         次の試合の前まで戻す */
      case 'soccer-result': Screens.soccerPregame(state); break;
      case 'soccer-training': Screens.soccerTraining(state); break;
      case 'soccer-offseason':
        Screens.soccerOffseason(state, Soccer.canRevive(state.soccer)); break;
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
    if (back === 'screen-pregame' && state.opponent) Screens.pregame(state, { onChange: save });
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
  function showTopButtons(note) {
    const saved = Storage.load();
    UI.el('btn-continue').hidden = !saved;
    UI.el('btn-start').textContent = saved ? 'はじめから' : 'はじめる';
    UI.el('top-note').textContent =
      note || (saved ? '前回の続きが残っています。' : '');
  }

  /**
   * 公開版では、ブラウザの保存が勝手に捨てられることがある
   * （枠の中で動いているため）。消えない場所に置いた控えを探して、
   * 見つかったら書き戻してからトップを出し直す。
   * 本番サイトでは Cloud が何も返さないので、そのまま素通りする。
   */
  function restoreFromCloud() {
    if (typeof Cloud === 'undefined') return;
    let done = false;
    const finish = (found) => {
      if (done) return;
      done = true;
      if (found) showTopButtons('別の場所に残っていた記録を戻しました。');
      else showTopButtons();
    };
    /* 待たせすぎない。枠の外なら数秒で null が返る */
    const timer = setTimeout(() => finish(false), 4000);
    Cloud.restore().then((found) => { clearTimeout(timer); finish(found); })
      .catch(() => { clearTimeout(timer); finish(false); });
  }

  /* ---------- 起動 ---------- */

  function boot() {
    UI.init();
    GameScreen.init();
    state = fresh();
    applySettings();
    showTopButtons();
    restoreFromCloud();

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
    on('btn-train-done', () => trainingDone());

    on('btn-open-start', toPregame);
    on('btn-open-lineup', () => UI.lineupEditor(state.team, () => { save(); Screens.opening(state); }));

    on('btn-play', playGame);
    on('btn-verdict-next', toGrowth);
    on('btn-verdict-share', () => Share.shareResult(state));
    on('btn-verdict-save', () => Share.saveImage(state));
    on('btn-growth-next', toResult);
    const nextup = UI.el('screen-nextup');
    if (nextup) nextup.addEventListener('click', () => {
      if (state && state.phase === 'nextup') toPregame();
    });
    on('btn-pregame-lineup', () => UI.lineupEditor(state.team, () => { save(); Screens.pregame(state, { onChange: save }); }));

    on('btn-skip', () => GameScreen.skip());
    on('btn-result-next', afterResult);
    on('btn-localwin-next', () => startTournament('national'));
    on('btn-champion-next', toOffseason);
    const intro = UI.el('screen-trainintro');
    if (intro) intro.addEventListener('click', (e) => {
      /* キャプテンを決めるボタンを押したときは、特訓に入らない */
      if (e.target.closest('#btn-captain')) return;
      if (state && state.phase === 'train-intro') startTraining();
    });
    on('btn-off-next', toPostSummerRetirement);

    on('btn-soccer-primary', () => {
      switch (state.phase) {
        case 'soccer-start': soccerStartTournament(); break;
        case 'soccer-pregame': soccerPlay(); break;
        case 'soccer-result': soccerAfterResult(); break;
        case 'soccer-training': soccerTrainingChoose(); break;
        case 'soccer-offseason': soccerContinue(); break;
      }
    });
    on('btn-soccer-secondary', () => {
      if (state.phase === 'soccer-training') soccerTrainingPass();
      else if (state.phase === 'soccer-offseason') reviveBaseball();
    });

    if (typeof ADS !== 'undefined') ADS.init();
  }

  return { boot, start, resume, tourLabel, get state() { return state; } };
})();

document.addEventListener('DOMContentLoaded', Game.boot);
