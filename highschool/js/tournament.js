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

  /**
   * 1回戦から決勝までの強さを決める。
   * from（1回戦）から to（決勝）へ、後半ほど急に上がる形で並べる。
   * ・低い確率で、前の相手より弱いところが当たる
   * ・ただし準々決勝から先は必ず強くなる
   * from と to は自軍の強さと関係のない固定値なので、
   * チームが強くなればそのぶん勝ち上がりやすくなる。
   */
  function strengthLadder(from, to, rounds) {
    const n = rounds.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 1 : i / (n - 1);
      /* 後半ほど急に強くなる（序盤は勝てて、終盤で歯が立たなくなる） */
      const curve = Math.pow(t, 1.10);
      out.push(from + (to - from) * curve);
    }

    /* 1回戦と2回戦だけは持ち上げる。曲線どおりだと弱すぎて練習試合になってしまう。
       3回戦より下にはなるよう、3回戦の値からの割合で決めている */
    if (n >= 3) {
      out[0] = Math.max(out[0], out[2] * 0.80);
      out[1] = Math.max(out[1], out[2] * 0.90);
    }

    /* ゆらぎを足す。ここで「妙に強い2回戦」や「楽な3回戦」が生まれる */
    for (let i = 0; i < n; i++) {
      const mustRise = rounds[i] === '準々決勝' || rounds[i] === '準決勝' || rounds[i] === '決勝';
      const jitter = mustRise ? 0.07 : 0.16;
      out[i] *= 1 + (Math.random() * 2 - 1) * jitter;
      if (!mustRise && i > 0 && RNG.chance(0.14)) out[i] = Math.min(out[i], out[i - 1] * 0.92);
    }

    /* 準々決勝から先は必ず強くなる */
    for (let i = 1; i < n; i++) {
      const mustRise = rounds[i] === '準々決勝' || rounds[i] === '準決勝' || rounds[i] === '決勝';
      if (mustRise && out[i] <= out[i - 1]) out[i] = out[i - 1] * (1 + 0.04 + Math.random() * 0.10);
    }

    return out.map((v) => RNG.clamp(Math.round(v), 6, 96));
  }

  /** 山を組む。kind は 'local'（地方大会）か 'national'（全国大会） */
  function create(kind, from, to, usedNames) {
    const rounds = ['1回戦', '2回戦', '3回戦'];
    /* 4回戦があるかどうかは半々。無ければそのまま準々決勝へ */
    if (RNG.chance(0.5)) rounds.push('4回戦');
    rounds.push('準々決勝', '準決勝', '決勝');

    const levels = strengthLadder(from, to, rounds);
    /* 同じ大会の中で同じ高校名が出ないようにするだけ。
       年をまたげば同じ名前が出てよい（常連校が何年も出てくるほうが自然） */
    const used = usedNames || new Set();
    return {
      kind,
      rounds: rounds.map((name, i) => ({
        name,
        level: levels[i],
        schoolName: NAMES.schoolName(used, kind),
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
