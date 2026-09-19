/* ==================================================
   高校野球  tournament.js

   相手校を作り、トーナメントの山を組む。
   ・相手は「大会の強さ（level）」から作る。level をそのまま平均能力に
     使っているので、数字を上げれば相手も強くなる。
   ・強さは勝ち上がるほど上がるが、必ずではない。低い確率で
     前の相手より弱いところが当たる（そのほうが大会らしい）。
     ただし準々決勝→準決勝→決勝だけは必ず強くなる。
   ================================================== */
'use strict';

const Tournament = (() => {

  /* 相手校の学年構成。夏の大会なので3年生が主体 */
  function rollGrade() {
    const r = Math.random();
    return r < 0.50 ? 3 : (r < 0.83 ? 2 : 1);
  }

  /** level の強さの相手校を1つ作る */
  function makeTeam(name, level) {
    const t = Team.create(name);
    /* 野手13人。守る場所が9つぶん揃うように配る */
    const posList = DATASET_POSITIONS.slice();
    for (let i = 0; i < 4; i++) posList.push(RNG.pick(FIELD_POSITIONS));
    posList.forEach((pos) => {
      t.batters.push(Player.newBatter({ grade: rollGrade(), pos, level, practice: true }));
    });
    for (let i = 0; i < 7; i++) {
      t.pitchers.push(Player.newPitcher({ grade: rollGrade(), level, practice: true }));
    }
    Team.autoLineup(t);
    return t;
  }

  /* 1回戦から決勝までの、1つ勝つごとの強さの伸び。
     地方大会は下から上まで広く、全国大会は初戦がもう地方の決勝級なので
     伸び幅を小さくしてある。こうしないと決勝の相手が
     どんなに鍛えても届かないところまで行ってしまう。 */
  const LADDER = {
    local:    { rise: [0.05, 0.16], flat: [0.03, 0.13] },
    national: { rise: [0.02, 0.08], flat: [0.01, 0.06] },
  };

  /** 1回戦から決勝までの強さを決める */
  function strengthLadder(base, rounds, kind) {
    const step = LADDER[kind] || LADDER.local;
    const out = [base];
    for (let i = 1; i < rounds.length; i++) {
      const prev = out[i - 1];
      /* 準々決勝から先は必ず強くなる */
      const mustRise = rounds[i] === '準々決勝' || rounds[i] === '準決勝' || rounds[i] === '決勝';
      const span = mustRise ? step.rise : step.flat;
      let next;
      if (!mustRise && RNG.chance(0.18)) {
        next = prev * (1 - (0.03 + Math.random() * 0.09));    // たまに楽な相手
      } else {
        next = prev * (1 + (span[0] + Math.random() * (span[1] - span[0])));
      }
      out.push(next);
    }
    return out.map((v) => RNG.clamp(Math.round(v), 12, 95));
  }

  /** 山を組む。kind は 'local'（地方大会）か 'national'（全国大会） */
  function create(kind, base, usedNames) {
    const rounds = ['1回戦', '2回戦', '3回戦'];
    /* 4回戦があるかどうかは半々。無ければそのまま準々決勝へ */
    if (RNG.chance(0.5)) rounds.push('4回戦');
    rounds.push('準々決勝', '準決勝', '決勝');

    const levels = strengthLadder(base, rounds, kind);
    const used = usedNames || new Set();
    return {
      kind,
      rounds: rounds.map((name, i) => ({
        name,
        level: levels[i],
        schoolName: NAMES.schoolName(used),
        done: false,
      })),
      index: 0,
      runsFor: 0, runsAgainst: 0, games: 0,
      finalLevel: levels[levels.length - 1],
    };
  }

  /** いま戦う相手 */
  function currentRound(tour) { return tour.rounds[tour.index] || null; }

  function buildOpponent(tour) {
    const r = currentRound(tour);
    if (!r) return null;
    return makeTeam(r.schoolName, r.level);
  }

  /** 大会の1試合あたりの得点・失点 */
  function perGame(tour) {
    if (!tour.games) return { rf: 0, ra: 0 };
    return {
      rf: tour.runsFor / tour.games,
      ra: tour.runsAgainst / tour.games,
    };
  }

  return { create, makeTeam, currentRound, buildOpponent, perGame, strengthLadder };
})();
