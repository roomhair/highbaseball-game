/* ==================================================
   高校野球  tournament.js

   相手校を作り、トーナメントの山を組む。
   ・相手は「大会の強さ（level）」から作る。level をそのまま平均能力に
     使っているので、数字を上げれば相手も強くなる。
   ・強さは1試合ごとに確率表から引いた幅だけ上がる。表の平均は
     自軍が1試合で強くなる幅に合わせてあるので、勝ち上がっても
     相手との差がひとりでに開いたり縮んだりしない。
   ・表から引くので、低い確率で前の相手より弱いところが当たる
     （そのほうが大会らしい）。
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

  /** 確率表から1つ引く */
  function rollStep() {
    const table = CONFIG.FIELD.STEP;
    const total = table.reduce((a, r) => a + r.weight, 0);
    let r = Math.random() * total;
    for (let i = 0; i < table.length; i++) {
      r -= table[i].weight;
      if (r <= 0) return table[i].add[0] + Math.random() * (table[i].add[1] - table[i].add[0]);
    }
    const last = table[table.length - 1];
    return last.add[0] + Math.random() * (last.add[1] - last.add[0]);
  }

  /** 表の平均。オフの練習相手の強さなど、めやすが要るところで使う */
  function stepMean() {
    const table = CONFIG.FIELD.STEP;
    let w = 0, s = 0;
    table.forEach((r) => { w += r.weight; s += r.weight * (r.add[0] + r.add[1]) / 2; });
    return w ? s / w : 0;
  }

  /**
   * 1回戦から決勝までの強さを決める。
   * 1回戦の from から、1試合ごとに確率表で引いた幅だけ積み上げる。
   * 表の平均は自軍が1試合で強くなる幅に合わせてあるので、
   * 勝ち上がる間の「自分と相手の差」はおおむね保たれる。
   * ・低い確率で、前の相手より弱いところが当たる
   * ・ただし準々決勝から先は必ず強くなる
   * from は自軍の強さと関係のない固定値なので、
   * チームが強くなればそのぶん勝ち上がりやすくなる。
   */
  function strengthLadder(from, rounds, scale) {
    const k = scale || 1;
    const out = [from];
    for (let i = 1; i < rounds.length; i++) {
      const mustRise = rounds[i] === '準々決勝' || rounds[i] === '準決勝' || rounds[i] === '決勝';
      let add = rollStep();
      /* 準々決勝から先は必ず強くなる。引き直さず、下限を入れるだけ */
      if (mustRise && add < 0.6) add = 0.6 + Math.random() * 1.6;
      out.push(out[i - 1] + add * k);
    }
    return out.map((v) => RNG.clamp(Math.round(v), 6, 96));
  }

  /** 山を組む。kind は 'local'（地方大会）か 'national'（全国大会）。
      scale はその年のゆらぎ（1なら平年） */
  function create(kind, from, scale, usedNames) {
    const rounds = ['1回戦', '2回戦', '3回戦'];
    /* 4回戦があるかどうかは半々。無ければそのまま準々決勝へ */
    if (RNG.chance(0.5)) rounds.push('4回戦');
    rounds.push('準々決勝', '準決勝', '決勝');

    const levels = strengthLadder(from, rounds, scale);
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

  return { create, makeTeam, currentRound, buildOpponent, perGame, strengthLadder, stepMean };
})();
