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
      /* このセーブの識別（プロ入りした選手の成績を、どのセーブのものか分けるため） */
      gid: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      /* ゲームの中の「いま」（月の通し番号。body.js）。1年目の4月から */
      clockT: Body.monthIdx(Body.START_YEAR, 4),
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
    if (!state.tour) return '夏の県大会';
    switch (state.tour.kind) {
      case 'national': return state.settings.nationalName;
      case 'fallPref': return '秋の県大会';
      case 'fallDistrict': return '秋季地区大会';
      case 'fallJingu': return state.settings.jinguName;
      case 'spring': return state.settings.springName;
      default: return '夏の県大会';
    }
  }

  /* ---------- 時計 ----------
     大会や新年度のたびに、ゲームの中の月を進める。実際の大阪の日程にそろえてある。
       4月 新入生が入部　7月 夏の県予選　8月 夏の全国　9月 秋の県予選
       10月 秋の近畿大会　11月 神宮大会　3月 センバツ
     選手の身長・体重は、月が進むたびに1か月ずつ変わる（body.js）。 */
  const CLOCK_MONTH = { local: 7, national: 8, fallPref: 9, fallDistrict: 10, fallJingu: 11, spring: 3 };

  function clockPlayers() {
    if (state.mode === 'soccer' && state.soccer) return state.soccer.players || [];
    return state.team ? Team.all(state.team) : [];
  }

  /** 次にその月が来る通し番号（いまの月と同じ月ならいま） */
  function nextMonth(month) {
    const now = Body.now();
    let t = Body.monthIdx(Body.yearOf(now), month);
    while (t < now) t += 12;
    return t;
  }

  /** 大会の月まで進める */
  function clockTo(kind) {
    const m = CLOCK_MONTH[kind];
    if (!m) return;
    Body.advanceTo(clockPlayers(), nextMonth(m));
    state.clockT = Body.now();
  }

  /** 新年度。3月まで進め、学年を上げてから4月に入る（4月の分は新しい学年で数える） */
  function clockNewYear(promote) {
    Body.advanceTo(clockPlayers(), nextMonth(3));
    const r = promote();
    Body.advanceTo(clockPlayers(), nextMonth(4));
    state.clockT = Body.now();
    return r;
  }

  /* ---------- チーム作り ---------- */

  function start() {
    state = fresh();
    Body.setNow(state.clockT);
    Player.setSeq(1);
    pickBatters();
  }

  function pickBatters() {
    state.phase = 'pick-bat';
    state.sets = state.sets && state.sets.kind === 'bat' ? state.sets : { kind: 'bat', list: Dataset.make('batter', CONFIG.PICK_SETS) };
    save();
    Screens.pick({
      title: '野手を選ぶ',
      lead: '18人ひと組のチームが' + CONFIG.PICK_SETS + 'つ。どれか1つを選んでください。選手をタップすると詳しく見られます。',
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
    state.sets = state.sets && state.sets.kind === 'pit' ? state.sets : { kind: 'pit', list: Dataset.make('pitcher', CONFIG.PICK_SETS, null, 0, teamNames()) };
    save();
    Screens.pick({
      title: '投手を選ぶ',
      lead: '8人ひと組のチームが' + CONFIG.PICK_SETS + 'つ。どれか1つを選んでください。',
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
      /* このあと出場の可否を発表する画面（選考結果）へ進む。出られるかどうかは
         そこで分かるので、ここでは大会の名前で書いておく */
      case 'springOrNextSummer': return state.settings.springName + '選考へ';
      /* 新入生を迎えたあとの特訓が終わったら、次はいよいよ夏の大会 */
      case 'nextSummer': return '夏の大会へ';
      default: return '夏の県大会へ';
    }
  }

  /** 特訓が終わったら実際に次へ進む */
  function trainingDone() {
    switch (state.trainingNext) {
      case 'fallPref': startTournament('fallPref'); break;
      /* 秋の大会がすべて終わったあとの特訓を終えたら、センバツ相当に
         出られるかどうかをここで発表する。実際にその先（センバツ相当・
         新入生を迎える手続き）へ進むのは、発表の画面を見たあと */
      case 'springOrNextSummer': showSpringResult(); break;
      case 'nextSummer': startTournament('local'); break;
      default: startTournament('local');
    }
  }

  /** センバツ相当に出られるかどうかの発表画面へ */
  function showSpringResult() {
    state.phase = 'spring-result';
    save();
    Screens.springResult(state, state.springQualified);
  }

  /** 発表画面を見たあと、実際に次へ進む */
  function afterSpringResult() {
    /* センバツに出ないと決まった場合も、学年を上げて新入生を迎える
       タイミングは「センバツ相当が終わったあと」と同じ扱いにする */
    if (state.springQualified) startTournament('spring'); else toNewSeason();
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
    revealPros();
    toTrainingPhase('springOrNextSummer', TRAIN_LIMITS.normal);
  }

  /** センバツ相当が終わったあと。新しい年度として学年を上げ、
      新入生を迎える（その後の特訓は夏と秋の間と同じく選択を絞る） */
  function toPostSpringTraining() {
    toNewSeason();
  }

  /** いまチームにいる選手の名前（新入生・投手の候補と同姓同名にならないように） */
  function teamNames() {
    const t = state && state.team;
    return t ? Team.all(t).map((p) => p.name) : [];
  }

  /* ---------- 大会 ---------- */

  function startTournament(kind) {
    /* ここは、ひとつの大会（県大会・地区大会・神宮大会相当・センバツ相当・
       夏の地方大会・全国大会）が新しく始まるときに必ず通る、唯一の入口。
       大会と大会のあいだは、規模が変わるにしろ年をまたぐにしろ必ず
       実際の日程が空くので、先発投手の疲れはここで毎回いったん完全に抜く
       （抜けた状態で始めて、そのあとは試合ごとに Team.restPitchers が
       積み増していく）。保存データを読み直したときは resume() が
       state.phase を見て該当の画面を出し直すだけで、ここは通らない
       （同じ大会の途中で二重に抜けることはない） */
    clockTo(kind);
    Team.healPitchers(state.team);
    /* 高校名の重複を避けるのはこの大会の中だけ。
       年をまたげば同じ常連校がまた出てくる */
    const used = new Set(state.team ? [state.team.name] : []);
    /* 相手の強さは自軍に合わせて動かさない。決められた強さの相手が並ぶので、
       チームが強くなればそのぶん勝ち上がれる。
       年ごとに少しだけゆらぎを入れて、当たり年・外れ年を作る */
    const F = CONFIG.FIELD;
    let j = 1 + (Math.random() * 2 - 1) * F.yearJitter;
    /* まれに顔ぶれが少し変わる年がある（以前より幅を小さくしてある） */
    if (RNG.chance(F.oddYear)) {
      const r = RNG.chance(0.5) ? F.weakYear : F.strongYear;
      j = r[0] + Math.random() * (r[1] - r[0]);
    }
    let from;
    if (kind === 'fallPref') state.springQualified = false;
    if (kind === 'local') {
      /* 当たり年でも、1回戦から極端に強い相手が出ないようにする */
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
    /* 自分の県の高校の名簿（最初に1回だけ作り、保存しておく） */
    if (!state.prefSchools || !state.prefSchools.length || state.prefSchoolsV !== 2) {
      state.prefSchoolsV = 2;      // 校名の作り方を変えたので、前の名簿は作り直す
      state.prefSchools = NAMES.prefecturePool(22, [state.team && state.team.name, state.settings.schoolName]);
    }
    state.tour = Tournament.create(kind, from, j, used, state.prefSchools);
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

  /** 勝ち上がるほど、相手の投手も連戦で疲れている。自軍の先発の疲れ（staminaCarry）を目安に、
      相手の先発の疲れを決める。同じくらいが半分強、あまり疲れていない・自軍より疲れている、が残り。
      大会の最初の試合（自軍もまだ疲れていない）では、相手も万全のまま */
  function tireOpponent(opp) {
    if (state.tour.index <= 0) return;
    const mine = Team.find(state.team, (state.team.rotation || [])[0]);
    const ref = mine ? (mine.staminaCarry || 0) : 0;
    if (ref <= 0) return;
    const r = RNG.rand();
    const f = r < 0.55 ? 0.85 + RNG.rand() * 0.3 : (r < 0.78 ? 0.5 + RNG.rand() * 0.35 : 1.15 + RNG.rand() * 0.35);
    const starter = Team.find(opp, (opp.rotation || [])[0]);
    /* 先発以外の投手は、登板が少ないぶん軽く */
    (opp.pitchers || []).forEach((q) => { q.staminaCarry = ref * f * 0.4 * RNG.rand(); });
    if (starter) starter.staminaCarry = ref * f;
    /* ときどき、1番手が疲れていない万全の状態で投げてくる */
    const order = (opp.pitcherOrder && opp.pitcherOrder.length ? opp.pitcherOrder : opp.rotation) || [];
    const ace = Team.find(opp, order[0]);
    if (ace && RNG.chance(0.2)) {
      ace.staminaCarry = 0;
      opp.rotation = [ace.id].concat((opp.rotation || []).filter((id) => id !== ace.id));
    }
    /* 先発のスタミナは50%を切らせない。切るなら、50%以上残っている別の投手に替える（いなければ、50%まで回復したことにする） */
    const left = (q) => 1 - (q.staminaCarry || 0) / (Sim.capacityOf(q) + 18);
    const cur = Team.find(opp, (opp.rotation || [])[0]);
    if (cur && left(cur) < 0.5) {
      const alt = (opp.rotation || []).map((id) => Team.find(opp, id)).find((q) => q && left(q) >= 0.5);
      if (alt) opp.rotation = [alt.id].concat(opp.rotation.filter((id) => id !== alt.id));
      else cur.staminaCarry = (Sim.capacityOf(cur) + 18) * 0.5;
    }
  }

  function toPregame() {
    const r = Tournament.currentRound(state.tour);
    if (!r) { finishTournament(true); return; }
    if (!state.opponent || state.opponent.__round !== state.tour.index) {
      state.opponent = Tournament.buildOpponent(state.tour);
      state.opponent.__round = state.tour.index;
      tireOpponent(state.opponent);
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
      loseNext: win ? null : loseNextLabel(state.tour.kind, isLast, res.cold),
      winPitcher: findPit('w'), losePitcher: findPit('l'), savePitcher: findPit('sv'),
      homers,
    };
    state.lastReport = report;

    lastSim = { res, meta: { mySide: state.mySide, roundName: round.name, tourLabel: tourLabel(), report } };

    /* 大会に優勝した試合は、まず優勝の画面を出し、そのあと勝敗へ進む */
    if (win && isLast) {
      state.phase = 'celebrate';
      save();
      Screens.celebrate(state);
      return;
    }
    toVerdict();
  }

  function toVerdict() {
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
    /* このボタンは（決勝でも）まず強奪画面へ進むだけなので、
       「全国大会へ」「優勝！」のような先の展開を言い切る文言にはしない。
       大会優勝そのものの画面は、試合のあと最初に出している（celebrate）。
       実際に次の大会へ進む操作は、
       強奪のあとに出る専用の画面（地方大会優勝／全国大会優勝）で行う */
    btn.textContent = r.win ? '強奪チャレンジへ' : r.loseNext;
    GameScreen.result(state, lastSim.res, lastSim.meta);
  }

  function afterResult() {
    if (state.lastResult.win) toPoach();
    else lose();
  }

  /** 負けたときの結果画面に出す「次へ」の文言。大会によっては、
      負けても決勝（＝最後の回）まで来ていれば次の大会へ進む */
  function loseNextLabel(kind, isLast, cold) {
    /* 県大会でのコールド負けは、このあとサッカー転向の画面へ進む */
    if ((kind === 'local' || kind === 'fallPref') && cold) return '次へ';
    if (kind === 'local' || kind === 'national') return 'オフシーズンへ';
    if (kind === 'fallPref' && isLast) return '秋季地区大会へ';
    /* 春の全国大会の次は、特訓ではなく新入生の入部 */
    if (kind === 'spring') return '新入生の入部へ';
    return 'オフシーズンへ';   // 秋の大会で負けたあと（このあと冬の特訓）
  }

  /* ---------- 強奪 ---------- */

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

  /** 相手の中でどう使われている選手かによる、強奪の成功率の倍率。
      スタメン外の野手は取りやすく、1〜4番の野手と、1番手の投手は取りにくい */
  function poachRoleFactor(p) {
    const opp = state.opponent;
    if (!opp || !p) return 1;
    if (p.kind === 'pitcher') {
      const first = ((opp.pitcherOrder && opp.pitcherOrder.length ? opp.pitcherOrder : opp.rotation) || [])[0];
      return first === p.id ? 0.7 : 1;
    }
    const i = (opp.lineup || []).findIndex((s) => s.pid === p.id);
    return i < 0 ? 1.35 : (i < 4 ? 0.7 : 1);
  }

  function attemptPoach(incoming, outgoing) {
    const round = Tournament.currentRound(state.tour);
    const chance = poachSuccessChance(round ? round.level : 50, state.prestigeScore) * poachRoleFactor(incoming);
    const ok = RNG.chance(Math.max(0.02, Math.min(0.95, chance)));
    if (ok) { doPoach(incoming, outgoing); save(); }
    /* 結果の画面の前に、交渉の演出を入れる（結果はもう決まっている） */
    Screens.poachCinema(incoming, ok, () => {
      if (ok) Screens.poachSuccess(state, incoming, outgoing, () => advanceRound());
      else Screens.poachFailed(state, incoming, () => advanceRound());
    });
  }

  function doPoach(incoming, outgoing) {
    /* どこから来たのかを覚えておく。詳細画面と引退のときに出す */
    incoming.from = { year: state.year, grade: incoming.grade, school: state.opponent.name };
    /* スタミナの持ち越し（staminaCarry）はあえて消さない。投手なら、
       いま負けた相手として投げたばかりの疲れをそのまま引き継ぐほうが自然 */

    const list = incoming.kind === 'pitcher' ? state.team.pitchers : state.team.batters;
    /* 放出なし（3年生の引退のあと、新入生が入るまでの間だけ選べる）なら、
       ただ部員に加える。春の新入生は、定員との差ぶんだけ入るので、そのぶん減る */
    if (!outgoing) {
      list.push(incoming);
      if (incoming.kind === 'pitcher') {
        state.team.rotation = (state.team.rotation || []).concat(incoming.id);
        if (state.team.pitcherOrder) state.team.pitcherOrder = state.team.pitcherOrder.concat(incoming.id);
      }
      return;
    }
    const idx = list.findIndex((x) => x.id === outgoing.id);
    /* 放出した選手がいた場所に、そのまま入れる。
       オーダーも投手の起用順も、その枠だけ差し替える（勝手に組み直さない） */
    if (idx >= 0) list.splice(idx, 1, incoming); else list.push(incoming);

    state.team.lineup = state.team.lineup.map((sl) =>
      (sl.pid === outgoing.id ? { pid: incoming.id, pos: sl.pos } : sl));
    state.team.rotation = (state.team.rotation || []).map((id) =>
      (id === outgoing.id ? incoming.id : id));
    /* 試合前に先発を選ぶ列の並びも、放出した投手の位置にそのまま入れる */
    if (state.team.pitcherOrder) {
      state.team.pitcherOrder = state.team.pitcherOrder.map((id) =>
        (id === outgoing.id ? incoming.id : id));
    }
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
      state.history.push({ year: state.year, tour: 'local', result: '優勝' });
      /* 投手の疲れを抜くのは、次の大会が始まる startTournament 側でまとめて行う */
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
      /* 県大会優勝。そのまま地区大会へ */
      state.fallPrefFinalLevel = state.tour.finalLevel;
      state.history.push({ year: state.year, tour: 'fallPref', result: '優勝' });
      startTournament('fallDistrict');
      return;
    }
    if (won && kind === 'fallDistrict') {
      /* 地区大会優勝。センバツ相当は確定のうえ、神宮大会相当へ */
      state.fallDistrictFinalLevel = state.tour.finalLevel;
      state.springQualified = true;
      state.history.push({ year: state.year, tour: 'fallDistrict', result: '優勝' });
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
    /* 負けたとき、設定が入っていれば一番いい選手を強奪される。
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
    /* 県大会（夏でも秋でも）でコールド負けすると、部員はやる気を無くし、
       野球部はそのままサッカー部になる */
    if (kind === 'fallPref' && state.lastResult.cold) { toSoccerConversion(); return; }
    if (kind === 'fallPref') {
      state.fallPrefFinalLevel = state.tour.finalLevel;
      /* 準優勝（決勝で敗退）でも地区大会へは進む */
      if (isLast) { startTournament('fallDistrict'); return; }
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

    /* 夏の県大会でコールド負けすると、部員はやる気を無くし、野球部は
       そのままサッカー部になる（試合のあと、サッカー転向の画面へ進む） */
    if (kind === 'local' && state.lastResult.cold) { toSoccerConversion(); return; }
    toOffseason();
  }

  /* ---------- サッカー部（野球部のコールド負けのあとの第二の物語） ----------
     流れは野球と同じ。夏の県大会 → 夏の全国大会 → オフシーズン（3年生引退）→
     特訓 → 秋の県大会 → 秋の地区大会 → 神宮大会相当 → 特訓 →
     春の大会の出場発表（出られれば春の大会）→ 新入生 → 特訓 → 夏の県大会 */

  /** サッカー部の大会名（野球の tourLabel と同じ呼び方） */
  function soccerLabel(kind) {
    switch (kind) {
      case 'national': return state.settings.nationalName;
      case 'fallPref': return '秋の県大会';
      case 'fallDistrict': return '秋季地区大会';
      case 'fallJingu': return state.settings.jinguName;
      case 'spring': return state.settings.springName;
      default: return '夏の県大会';
    }
  }

  function toSoccerConversion() {
    const team = state.team;
    state.mode = 'soccer';
    state.soccer = Soccer.start(team);
    state.soccer.springQualified = false;
    /* どの大会でのコールド負けか（夏の県大会か、秋の県大会か） */
    state.soccer.convertedFrom = state.tour ? state.tour.kind : 'local';
    state.team = null;
    state.phase = 'soccer-start';
    save();
    Screens.soccerStart(state);
  }

  /** 大会を新しく始める（野球の startTournament と同じ入口） */
  function soccerStartTournament(kind) {
    const S = state.soccer;
    clockTo(kind);
    if (kind === 'fallPref') S.springQualified = false;
    S.tour = Soccer.createTour(S, kind);
    state.phase = 'soccer-opening';
    save();
    Screens.soccerOpening(state);
    UI.curtain('<b>' + UI.esc(soccerLabel(kind)) + '</b><span>開幕</span>', function () {});
  }

  function soccerToPregame() {
    state.phase = 'soccer-pregame';
    save();
    Screens.soccerPregame(state);
  }

  function soccerPlay() {
    const res = Soccer.playUser(state.soccer);
    state.lastSoccerRes = res;
    state.phase = 'soccer-game';
    save();
    SoccerGameScreen.start(state, res, () => {
      state.phase = 'soccer-verdict';
      save();
      Screens.soccerVerdict(state, res);
    });
  }

  function soccerToGrowth() {
    state.phase = 'soccer-growth';
    save();
    Screens.soccerGrowth(state, state.lastSoccerRes);
  }

  function soccerToMatchResult() {
    state.phase = 'soccer-result';
    save();
    Screens.soccerMatchResult(state, state.lastSoccerRes);
  }

  function soccerAfterResult() {
    const S = state.soccer;
    const res = state.lastSoccerRes;
    if (res.win) {
      if (Soccer.advance(S)) { soccerFinishTournament(); return; }
      soccerToPregame();
    } else {
      soccerToDecide();
    }
  }

  /** 負けたあと、サッカー部を続けるか、野球部に戻るかを選ぶ */
  function soccerToDecide() {
    state.phase = 'soccer-decide';
    save();
    Screens.soccerDecide(state);
  }

  /** 野球部に戻る。野球の能力に、サッカーの練習で上がった分を足して、
      負けた大会の次の場面から野球を再開する */
  function soccerBackToBaseball() {
    const S = state.soccer;
    const kind = S.tour ? S.tour.kind : 'local';
    const report = Soccer.backToBaseball(S);
    const team = Soccer.applyBaseball(S, report);
    state.soccerReturn = { report, kind, school: S.schoolName, team };
    state.phase = 'soccer-return';
    save();
    Screens.soccerReturn(state, soccerReturnLabel(kind));
  }

  function soccerReturnLabel(kind) {
    if (kind === 'local' || kind === 'national') return 'オフシーズンへ';
    if (kind === 'spring') return '新入生の入部へ';
    return state.settings.springName + '選考へ';
  }

  /** 戻った野球部で、負けた大会のあとの流れへ。
      夏なら3年生の引退から。秋なら特訓 → 春の大会（サッカー部として負けたので選ばれない）→ 新入生 */
  function soccerReturnContinue() {
    const R = state.soccerReturn;
    state.mode = 'baseball';
    state.team = R.team;
    Body.advanceTo(Team.all(R.team), Body.now());    // サッカー部のあいだに過ぎた月ぶん、体格も進める
    state.soccer = null;
    state.soccerReturn = null;
    state.tour = null;
    state.sets = null;
    state.springQualified = false;
    state.trainLimits = TRAIN_LIMITS.normal;
    if (R.kind === 'local' || R.kind === 'national') toOffseason();
    else if (R.kind === 'spring') toNewSeason();
    else toPostFallTraining();
  }

  /** 山を勝ち切ったとき（野球の finishTournament と同じ分かれ方） */
  function soccerFinishTournament() {
    const S = state.soccer;
    const kind = S.tour.kind;
    if (kind === 'local') {
      S.localFinalLevel = S.tour.finalLevel;
      state.phase = 'soccer-localwin';
      save();
      Screens.soccerCelebrate(state, 'local');
    } else if (kind === 'national') {
      S.titles++;
      S.everChampion = true;
      S.lastChampion = true;
      state.phase = 'soccer-champion';
      save();
      Screens.soccerCelebrate(state, 'national');
    } else if (kind === 'fallPref') {
      S.fallPrefFinalLevel = S.tour.finalLevel;
      soccerStartTournament('fallDistrict');
    } else if (kind === 'fallDistrict') {
      S.fallDistrictFinalLevel = S.tour.finalLevel;
      S.springQualified = true;
      soccerStartTournament('fallJingu');
    } else if (kind === 'fallJingu') {
      soccerToPostFallTraining();
    } else {
      soccerToNewSeason();
    }
  }

  /** 負けたとき（野球の lose と同じ分かれ方。秋は決勝まで来ていれば次の大会へ） */
  function soccerLose() {
    const S = state.soccer;
    const kind = S.tour.kind;
    const isLast = S.tour.index >= S.tour.rounds.length - 1;
    if (kind === 'local' || kind === 'national') { toSoccerOffseason(false); return; }
    if (kind === 'fallPref') {
      S.fallPrefFinalLevel = S.tour.finalLevel;
      if (isLast) { soccerStartTournament('fallDistrict'); return; }
      soccerToPostFallTraining();
      return;
    }
    if (kind === 'fallDistrict') {
      S.fallDistrictFinalLevel = S.tour.finalLevel;
      if (isLast) S.springQualified = true;
      soccerToPostFallTraining();
      return;
    }
    if (kind === 'fallJingu') { soccerToPostFallTraining(); return; }
    soccerToNewSeason();
  }

  /** 夏が終わったあとのオフシーズン（3年生の引退を見せる） */
  function toSoccerOffseason() {
    const S = state.soccer;
    S.seasons++;
    state.phase = 'soccer-offseason';
    save();
    Screens.soccerOffseason(state, Soccer.canRevive(S));
  }

  /** オフシーズンのあと。3年生が抜けて、特訓から秋の大会へ */
  function soccerAfterOffseason() {
    Soccer.retire(state.soccer);
    state.soccer.lastChampion = false;
    soccerToTraining('fallPref', TRAIN_LIMITS.short);
  }

  function soccerToTraining(next, limits) {
    const S = state.soccer;
    S.trainingNext = next;
    S.training = Soccer.startTraining(S, limits);
    state.phase = 'soccer-training';
    save();
    Screens.soccerTraining(state);
  }

  function soccerToPostFallTraining() {
    revealPros();
    soccerToTraining('springOrNextSummer', TRAIN_LIMITS.normal);
  }

  function soccerTrainingLabel() {
    switch (state.soccer.trainingNext) {
      case 'fallPref': return '秋の大会へ';
      case 'springOrNextSummer': return state.settings.springName + '選考へ';
      default: return '夏の大会へ';
    }
  }

  function soccerTrainTake() {
    const S = state.soccer;
    Soccer.trainingChoose(S.training, S);
    save();
    if (S.training.done) {
      state.phase = 'soccer-training-result';
      save();
      Screens.soccerTrainingResult(state, soccerTrainingLabel());
    } else {
      Screens.soccerTraining(state);
    }
  }

  function soccerTrainPass() {
    const S = state.soccer;
    Soccer.trainingPass(S.training, S);
    save();
    Screens.soccerTraining(state);
  }

  function soccerTrainingDone() {
    const S = state.soccer;
    const next = S.trainingNext;
    S.training = null;
    if (next === 'fallPref') soccerStartTournament('fallPref');
    else if (next === 'springOrNextSummer') soccerShowSpringResult();
    else soccerStartTournament('local');
  }

  function soccerShowSpringResult() {
    state.phase = 'soccer-spring-result';
    save();
    Screens.soccerSpringResult(state, state.soccer.springQualified);
  }

  function soccerAfterSpringResult() {
    if (state.soccer.springQualified) soccerStartTournament('spring'); else soccerToNewSeason();
  }

  /** 春の大会まで終わったあと。学年を上げて新入生を迎える */
  function soccerToNewSeason() {
    const S = state.soccer;
    S.need = clockNewYear(() => Soccer.promote(S));
    state.year++;
    S.sets = null;
    soccerNewcomers();
  }

  function soccerNewcomers() {
    const S = state.soccer;
    if (!S.need) { soccerAfterNewcomers(); return; }
    state.phase = 'soccer-new';
    if (!S.sets) S.sets = Soccer.freshSets(S, S.need, CONFIG.NEWCOMER_SETS);
    save();
    Screens.soccerNewcomers(state, (i) => {
      confirmNewcomers(S.sets[i], () => {
        Soccer.enroll(S, S.sets[i]);
        S.sets = null;
        soccerAfterNewcomers();
      });
    });
  }

  function soccerAfterNewcomers() {
    state.soccer.springQualified = false;
    soccerToTraining('nextSummer', TRAIN_LIMITS.short);
  }

  function reviveBaseball() {
    if (!Soccer.canRevive(state.soccer)) return;
    state.mode = 'baseball';
    state.soccer = null;
    state.year++;
    state.clockT = nextMonth(4);       // 野球部の復活は次の4月から
    Body.setNow(state.clockT);
    state.team = null;
    state.sets = null;
    /* サッカー部に変わる直前は、夏と秋の間などの「短い」特訓だったことが
       多いので、trainLimits が短いまま残らないようにしておく。
       野球部の復活は、チーム作成直後と同じ大きいほうの特訓を経て夏へ */
    state.trainLimits = TRAIN_LIMITS.normal;
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
    recordPros(retired);
    save();
    Screens.offseason(state, retired);
  }

  /** 秋の大会がすべて終わった。プロ入りした卒業生の成績を、1年ぶん公開する */
  function revealPros() {
    const list = Storage.loadPros();
    if (Pro.revealAutumn(list, state.gid, state.year)) Storage.savePros(list);
  }

  /** プロ入りした選手を、一覧（info）に残す。同じ選手を二度は入れない */
  function recordPros(retired) {
    const list = Storage.loadPros();
    retired.forEach((f) => {
      if (!f.draft) return;
      if (list.some((x) => x.player && x.player.id === f.player.id && x.school === state.team.name)) return;
      list.push(Pro.attach({
        year: state.year, school: state.team.name, round: f.draft.round, text: f.draft.text,
        gid: state.gid,
        player: JSON.parse(JSON.stringify(f.player)),
      }));
    });
    Storage.savePros(list);
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
    state.need = clockNewYear(() => Offseason.promote(state.team));
    state.year++;
    state.phase = 'new-bat';
    state.sets = null;
    save();
    newcomerBatters();
  }

  /** 新入生の組を決める前の確認（決めたあとは選び直せない） */
  function confirmNewcomers(list, onYes) {
    const names = list.map((p) => p.name).join('・');
    const locked = list.filter((p) => p.regularLock);
    UI.confirmBox({
      title: 'この新入生たちを迎えますか？',
      body: list.length + '人（' + names + '）を迎えます。決めたあとは選び直せません。' +
        (locked.length ? '　※' + locked.map((p) => p.name).join('・') + 'は、1年生からレギュラー確約が条件です。3年生が引退するまで、スタメンから外せません（試合中の交代はできます）。' : ''),
      yes: '迎える', no: '選び直す', yesClass: 'btn--primary',
    }, onYes);
  }

  function newcomerBatters() {
    if (!state.need.bat) { state.phase = 'new-pit'; newcomerPitchers(); return; }
    state.phase = 'new-bat';
    state.sets = state.sets && state.sets.kind === 'nbat'
      ? state.sets : { kind: 'nbat', list: Dataset.make('batter', CONFIG.NEWCOMER_SETS, state.need.bat, schoolRankNewcomerBonus(state.prestigeScore), teamNames()) };
    save();
    Screens.pick({
      title: '新入生（野手）',
      scout: scoutLevel(state.prestigeScore),
      lead: state.need.bat + '人ひと組の候補が' + CONFIG.NEWCOMER_SETS + 'つ。入部させる組を選んでください。',
      setLabel: '候補', pickLabel: 'この新入生たちを迎える',
      sets: state.sets.list,
      onSelect(i) {
        confirmNewcomers(state.sets.list[i], () => {
          Offseason.enroll(state.team, state.sets.list[i]);
          state.sets = null;
          state.phase = 'new-pit';
          newcomerPitchers();
        });
      },
    });
  }

  function newcomerPitchers() {
    if (!state.need.pit) { afterNewcomers(); return; }
    state.sets = state.sets && state.sets.kind === 'npit'
      ? state.sets : { kind: 'npit', list: Dataset.make('pitcher', CONFIG.NEWCOMER_SETS, state.need.pit, schoolRankNewcomerBonus(state.prestigeScore), teamNames()) };
    save();
    Screens.pick({
      title: '新入生（投手）',
      scout: scoutLevel(state.prestigeScore),
      lead: state.need.pit + '人ひと組の候補が' + CONFIG.NEWCOMER_SETS + 'つ。入部させる組を選んでください。',
      setLabel: '候補', pickLabel: 'この新入生たちを迎える',
      sets: state.sets.list,
      onSelect(i) {
        confirmNewcomers(state.sets.list[i], () => {
          Offseason.enroll(state.team, state.sets.list[i]);
          state.sets = null;
          afterNewcomers();
        });
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

  /** 保存データの中の選手すべてに、身体のデータを補う */
  function ensureBodies(S) {
    const list = [];
    const addTeam = (t) => { if (t) Team.all(t).forEach((p) => list.push(p)); };
    addTeam(S.team); addTeam(S.opponent);
    if (S.liveGame) { addTeam(S.liveGame.team); addTeam(S.liveGame.opponent); }
    if (S.sets && S.sets.list) S.sets.list.forEach((set) => set.forEach((p) => list.push(p)));
    if (S.soccer && S.soccer.players) S.soccer.players.forEach((p) => list.push(p));
    if (S.soccer && S.soccer.sets) S.soccer.sets.forEach((set) => set.forEach((p) => list.push(p)));
    if (S.soccerReturn && S.soccerReturn.team) addTeam(S.soccerReturn.team);
    list.forEach((p) => Body.ensure(p));
  }

  function resume(loaded) {
    /* 前の試合の種が残っていることがあるので、いったん外す。
       試合を続けるときは runGame が掛け直す */
    RNG.unseed();
    state = loaded;
    /* 変化球の切れ味は7が上限。以前の版で8・9まで付いた球は7に直す */
    if (state.team) Team.all(state.team).forEach((p) => {
      (p.pitches || []).forEach((q) => { if (q.level > 7) q.level = 7; });
    });
    /* 身長・体重・身体能力（body.js）を持たない古い保存データの選手には、
       ここで補う（能力そのものは変えない） */
    if (state.clockT == null) state.clockT = Body.monthIdx(Body.START_YEAR + (state.year || 1) - 1, 4);
    if (!state.gid) state.gid = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    Body.setNow(state.clockT);
    ensureBodies(state);
    if (!state.settings) state.settings = Storage.loadSettings();
    /* 古い保存データの移行。秋・春の大会を追加する前のデータには
       無いフィールドなので、ここで補っておく */
    if (state.settings.springName == null) state.settings.springName = CONFIG.DEFAULTS.springName;
    if (state.settings.jinguName == null) state.settings.jinguName = CONFIG.DEFAULTS.jinguName;
    /* 全国大会の名前の初期値を「乙大人園」から「乙子園」に変えた。前の初期値のままなら新しい名前に */
    if (state.settings.nationalName === CONFIG.OLD_NATIONAL_NAME) state.settings.nationalName = CONFIG.DEFAULTS.nationalName;
    if (state.trainingNext == null) state.trainingNext = 'local';
    if (state.springQualified == null) state.springQualified = false;
    if (state.prestigeScore == null) state.prestigeScore = 0;
    if (state.mode == null) state.mode = 'baseball';
    if (state.training && state.training.pickLimit == null) {
      state.training.pickLimit = CONFIG.TRAINING.PICKS;
      state.training.passLimit = CONFIG.TRAINING.PASSES;
    }
    /* 古い保存データの移行。サッカー部の大会の形・特訓の形が変わる前のもの */
    if (state.soccer) {
      const S = state.soccer;
      if (S.tour && !S.tour.kind) S.tour.kind = S.tour.stage === 'national' ? 'national' : 'local';
      if (S.training && !S.training.log) S.training = Soccer.startTraining(S, null);
      if (S.springQualified == null) S.springQualified = false;
      Soccer.migrate(S);
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
      case 'celebrate': Screens.celebrate(state); break;
      case 'verdict': case 'growth': case 'result':
        if (state.lastResult && state.lastResult.win) toPoach(); else lose();
        break;
      case 'nextup': Screens.nextUp(state); break;
      case 'poach': toPoach(); break;
      case 'localwin': Screens.localWin(state); break;
      case 'champion': Screens.champion(state); break;
      case 'spring-result': Screens.springResult(state, state.springQualified); break;
      case 'offseason':
        Screens.offseason(state, Offseason.retiring(state.team).map(Offseason.farewell)); break;
      case 'new-bat': newcomerBatters(); break;
      case 'new-pit': newcomerPitchers(); break;
      case 'train-intro': Screens.trainingIntro(state); break;
      case 'soccer-start': Screens.soccerStart(state); break;
      case 'soccer-opening': Screens.soccerOpening(state); break;
      /* サッカーの試合の中身（試合中の演出・結果画面）は保存していないので、
         途中で閉じて開き直したときは次の試合の前まで戻す */
      case 'soccer-pregame': case 'soccer-game': Screens.soccerPregame(state); break;
      case 'soccer-verdict': Screens.soccerVerdict(state, state.lastSoccerRes); break;
      case 'soccer-growth': Screens.soccerGrowth(state, state.lastSoccerRes); break;
      case 'soccer-result': Screens.soccerMatchResult(state, state.lastSoccerRes); break;
      case 'soccer-localwin': Screens.soccerCelebrate(state, 'local'); break;
      case 'soccer-champion': Screens.soccerCelebrate(state, 'national'); break;
      case 'soccer-offseason': Screens.soccerOffseason(state, Soccer.canRevive(state.soccer)); break;
      case 'soccer-decide': Screens.soccerDecide(state); break;
      case 'soccer-return': Screens.soccerReturn(state, soccerReturnLabel(state.soccerReturn.kind)); break;
      case 'soccer-training': Screens.soccerTraining(state); break;
      case 'soccer-training-result': Screens.soccerTrainingResult(state, soccerTrainingLabel()); break;
      case 'soccer-spring-result': Screens.soccerSpringResult(state, state.soccer.springQualified); break;
      case 'soccer-new': soccerNewcomers(); break;
      default: UI.show('screen-top');
    }
  }

  /* ---------- 設定 ---------- */

  /** 設定・info・チーム情報のあいだを行き来しても、戻り先は最初に開いた画面のまま */
  function rememberReturn() {
    state = state || fresh();
    const cur = UI.currentScreen();
    if (['screen-settings', 'screen-info', 'screen-teaminfo'].indexOf(cur) < 0) state.returnScreen = cur;
  }

  function openSettings() {
    rememberReturn();
    Screens.settings(state);
    updateSettingsButton();
  }

  function openInfo() {
    rememberReturn();
    Screens.info();
  }

  function closeInfo() {
    const back = state.returnScreen === 'screen-settings' || state.returnScreen === 'screen-info' ? 'screen-top' : state.returnScreen;
    UI.show(back || 'screen-top');
  }

  /** 設定の画面に、何か変更が加わっているか */
  function settingsChanged() {
    const s = state.settings;
    const school0 = state.team ? state.team.name : (s.schoolName || '');
    return UI.el('set-national').value.trim() !== (s.nationalName || '') ||
      UI.el('set-school').value.trim() !== (school0 || '') ||
      UI.el('set-jingu').value.trim() !== (s.jinguName || '') ||
      UI.el('set-spring').value.trim() !== (s.springName || '') ||
      UI.el('set-poach').checked !== !!s.poach;
  }

  /** 何も変えていないときは「閉じる」、変えたときだけ「保存して戻る」 */
  function updateSettingsButton() {
    const b = UI.el('btn-settings-save');
    const changed = settingsChanged();
    b.textContent = changed ? '保存して戻る' : '閉じる';
    b.classList.toggle('btn--primary', changed);
  }

  function saveSettings() {
    if (!settingsChanged()) { closeInfo(); return; }
    const nat = UI.el('set-national').value.trim();
    const school = UI.el('set-school').value.trim();
    const jingu = UI.el('set-jingu').value.trim();
    const spring = UI.el('set-spring').value.trim();
    state.settings.nationalName = nat || CONFIG.DEFAULTS.nationalName;
    state.settings.jinguName = jingu || CONFIG.DEFAULTS.jinguName;
    state.settings.springName = spring || CONFIG.DEFAULTS.springName;
    state.settings.poach = UI.el('set-poach').checked;
    if (state.team && school) state.team.name = school.slice(0, 14);
    state.settings.schoolName = school;
    Storage.saveSettings(state.settings);
    save();
    applySettings();
    const back = state.returnScreen === 'screen-settings' || state.returnScreen === 'screen-info' ? 'screen-top' : state.returnScreen;
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
    SoccerGameScreen.init();
    state = fresh();
    /* テストプレイのリンク（?test=bear / heya / lock）。保存はしない */
    const testKind = new URLSearchParams(location.search).get('test');
    if (['bear', 'heya', 'lock'].indexOf(testKind) >= 0) {
      Storage.testMode = true;
      applySettings();
      showTopButtons();
      bindEvents();
      startTest(testKind);
      return;
    }
    applySettings();
    showTopButtons();
    restoreFromCloud();
    bindEvents();
  }

  /**
   * テストプレイ。リンクの ?test=〜 で入る。保存はしない（Storage.testMode）。
   *   bear … 新入生を選ぶ画面から。どの組にも熊がいる
   *   lock … 新入生を選ぶ画面から。レギュラー確約つきの強めの選手がいる組が1つある
   *   heya … 夏の県大会の開幕から。相手の4番ショートに、いつも部屋がいる
   */
  function startTest(kind) {
    state = fresh();
    state.testMode = true;
    Body.setNow(state.clockT);
    Player.setSeq(1);
    const name = NAMES.schoolName(new Set());
    state.usedSchools = [name];
    state.team = Team.create(name);
    state.team.batters = Dataset.make('batter', 1)[0];
    state.team.pitchers = Dataset.make('pitcher', 1, null, 0, [])[0];
    Team.autoLineup(state.team);
    const best = Team.bestPlayer(state.team);
    if (best) state.team.captainId = best.id;
    state.settings.schoolName = state.settings.schoolName || name;
    const bar = document.createElement('div');
    bar.className = 'testbanner';
    bar.textContent = 'テストプレイ（記録は保存されません）';
    document.body.appendChild(bar);
    if (kind === 'heya') {
      Tournament.test.heya = true;
      startTournament('local');
      return;
    }
    if (kind === 'bear') Dataset.test.bear = true;
    if (kind === 'lock') Dataset.test.strong = true;
    Offseason.retire(state.team);
    toNewSeason();
  }

  /** ボタンの結び付け（boot から呼ぶ） */
  function bindEvents() {

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
    /* 右上の歯車: 押すと「設定」と「info」を選べるメニューが開く */
    const menu = UI.el('appmenu'), menuBtn = UI.el('btn-menu');
    const closeMenu = () => { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); };
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = menu.hidden;
      menu.hidden = !opening;
      menuBtn.setAttribute('aria-expanded', opening ? 'true' : 'false');
    });
    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
    on('menu-settings', () => { closeMenu(); openSettings(); });
    on('menu-info', () => { closeMenu(); openInfo(); });
    ['set-national', 'set-school', 'set-jingu', 'set-spring', 'set-poach'].forEach((id) => {
      const n = UI.el(id);
      if (n) { n.addEventListener('input', updateSettingsButton); n.addEventListener('change', updateSettingsButton); }
    });
    on('btn-info-close', closeInfo);
    on('btn-info-back', closeInfo);
    /* 設定の←。変えていなければそのまま戻り、変えていれば、保存するかどうかを聞く
       （×で閉じれば、設定の画面にとどまる） */
    on('btn-settings-back', () => {
      if (!settingsChanged()) { closeInfo(); return; }
      UI.confirmBox({
        title: '設定が変更されています',
        body: '変更を保存して戻りますか？',
        yes: '保存して戻る', yesClass: 'btn--primary',
        no: '保存せずに戻る',
        onNo: closeInfo,
      }, saveSettings);
    });
    on('btn-teaminfo', () => Screens.teamInfo(state));
    on('btn-teaminfo-back', () => Screens.info());
    on('btn-teaminfo-arrow', () => Screens.info());
    on('btn-settings-save', saveSettings);
    on('btn-settings-reset', resetAll);
    on('btn-pros', () => UI.prosList(Storage.loadPros()));

    on('btn-ready-lineup', () => UI.lineupEditor(state.team, () => { save(); Screens.ready(state); }));
    on('btn-ready-next', () => startTraining());

    on('btn-train-take', () => (state.mode === 'soccer' ? soccerTrainTake() : trainTake()));
    on('btn-train-pass', () => (state.mode === 'soccer' ? soccerTrainPass() : trainPass()));
    on('btn-train-done', () => (state.mode === 'soccer' ? soccerTrainingDone() : trainingDone()));

    on('btn-open-start', () => (state.mode === 'soccer' ? soccerToPregame() : toPregame()));
    on('btn-open-lineup', () => (state.mode === 'soccer'
      ? Screens.soccerLineupEditor(state, () => { save(); Screens.soccerOpening(state); })
      : UI.lineupEditor(state.team, () => { save(); Screens.opening(state); })));

    on('btn-play', () => (state.mode === 'soccer' ? soccerPlay() : playGame()));
    on('btn-verdict-next', () => (state.mode === 'soccer' ? soccerToGrowth() : toGrowth()));
    const shareVerdict = (mode) => (state.mode === 'soccer'
      ? Share.previewSoccer(state, state.lastSoccerRes, mode)
      : Share.preview(state, lastSim, mode));
    on('btn-verdict-share', () => shareVerdict('share'));
    on('btn-verdict-save', () => shareVerdict('save'));
    on('btn-growth-next', () => (state.mode === 'soccer' ? soccerToMatchResult() : toResult()));
    const nextup = UI.el('screen-nextup');
    if (nextup) nextup.addEventListener('click', () => {
      if (state && state.phase === 'nextup') toPregame();
    });
    on('btn-pregame-lineup', () => (state.mode === 'soccer'
      ? Screens.soccerLineupEditor(state, () => { save(); Screens.soccerPregame(state); })
      : UI.lineupEditor(state.team, () => { save(); Screens.pregame(state, { onChange: save }); })));

    on('btn-skip', () => GameScreen.skip());
    on('btn-result-next', () => (state.mode === 'soccer' ? soccerAfterResult() : afterResult()));
    on('btn-localwin-next', () => (state.mode === 'soccer' ? soccerStartTournament('national') : startTournament('national')));
    on('btn-celebrate-next', toVerdict);
    on('btn-champion-next', () => (state.mode === 'soccer' ? toSoccerOffseason() : toOffseason()));
    on('btn-spring-result-next', () => (state.mode === 'soccer' ? soccerAfterSpringResult() : afterSpringResult()));
    /* 「特訓へ」ボタンは画面を描くたびに作り直されるので、画面側で受ける */
    const intro = UI.el('screen-trainintro');
    if (intro) intro.addEventListener('click', (e) => {
      if (!e.target.closest('#btn-trainintro-go')) return;
      if (state && state.phase === 'train-intro') startTraining();
    });
    on('btn-off-next', toPostSummerRetirement);

    on('btn-soccer-primary', () => {
      switch (state.phase) {
        case 'soccer-start':
          /* 秋の県大会でのコールド負けなら、3年生の引退はもう済んでいるので、特訓から始める */
          if (state.soccer.convertedFrom === 'fallPref') soccerToTraining('fallPref', TRAIN_LIMITS.short);
          else toSoccerOffseason();
          break;
        case 'soccer-offseason': soccerAfterOffseason(); break;
        case 'soccer-decide': soccerLose(); break;
        case 'soccer-return': soccerReturnContinue(); break;
      }
    });
    on('btn-soccer-secondary', () => {
      if (state.phase === 'soccer-offseason') reviveBaseball();
      else if (state.phase === 'soccer-decide') soccerBackToBaseball();
    });

    if (typeof ADS !== 'undefined') ADS.init();
  }

  return { boot, start, resume, tourLabel, soccerLabel, get state() { return state; } };
})();

document.addEventListener('DOMContentLoaded', Game.boot);
