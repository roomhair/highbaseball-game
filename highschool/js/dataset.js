/* ==================================================
   高校野球  dataset.js

   チーム作りと新入生選びで見せる「データセット」。
   ・野手のセットは13人。捕一二三遊左中右DH を1人ずつ（9人）と控え4人。
     学年は 4人・4人・5人 に分かれ、どの学年が5人になるかは毎回変わる。
   ・投手のセットは7人。学年は 2人・2人・3人。
   ・新入生のセットは、必要な人数ぶんの1年生だけで作る。
   ================================================== */
'use strict';

const Dataset = (() => {

  /** [4,4,5] のような割り当てを、学年1〜3にランダムに配る */
  function splitGrades(counts) {
    const order = RNG.shuffle([1, 2, 3]);
    const map = {};
    order.forEach((g, i) => { map[g] = counts[i]; });
    /* 学年の若い順に並べた配列にして返す */
    const list = [];
    [1, 2, 3].forEach((g) => { for (let i = 0; i < map[g]; i++) list.push(g); });
    return list;
  }

  /** 野手13人のセットを1つ作る */
  function batterSet() {
    const grades = RNG.shuffle(splitGrades([4, 4, 5]));   // 13人ぶんの学年
    const posList = DATASET_POSITIONS.slice();            // 9人ぶんの守備位置
    /* 控え4人は守る場所が重なってもよい */
    for (let i = 0; i < 4; i++) posList.push(RNG.pick(FIELD_POSITIONS));

    const players = posList.map((pos, i) =>
      Player.newBatter({ grade: grades[i], pos }));

    /* 学年の高い順に並べる。同じ学年の中は守備位置の順 */
    const rank = {};
    DATASET_POSITIONS.forEach((k, i) => { rank[k] = i; });
    players.sort((a, b) => (b.grade - a.grade) || (rank[a.pos] - rank[b.pos]));
    return players;
  }

  /** 投手7人のセットを1つ作る */
  function pitcherSet() {
    const grades = RNG.shuffle(splitGrades([2, 2, 3]));
    const players = grades.map((g) => Player.newPitcher({ grade: g }));
    players.sort((a, b) => b.grade - a.grade || Player.rating(b) - Player.rating(a));
    return players;
  }

  /** 新入生（1年生だけ）のセット */
  function freshmanSet(kind, n) {
    const players = [];
    if (kind === 'batter') {
      /* 守る場所がばらけるように配る */
      const pool = RNG.shuffle(FIELD_POSITIONS.slice().concat(['DH']));
      for (let i = 0; i < n; i++) {
        players.push(Player.newBatter({ grade: 1, pos: pool[i % pool.length] }));
      }
    } else {
      for (let i = 0; i < n; i++) players.push(Player.newPitcher({ grade: 1 }));
    }
    players.sort((a, b) => Player.rating(b) - Player.rating(a));
    return players;
  }

  /** 5つ用意する */
  function make(kind, count, n) {
    const sets = [];
    for (let i = 0; i < (count || 5); i++) {
      sets.push(n == null
        ? (kind === 'batter' ? batterSet() : pitcherSet())
        : freshmanSet(kind, n));
    }
    return sets;
  }

  /** セットの目安。一覧の横に出す */
  function summary(players) {
    const avg = (f) => Math.round(players.reduce((s, p) => s + f(p), 0) / players.length);
    const best = players.slice().sort((a, b) => Player.rating(b) - Player.rating(a))[0];
    const byGrade = { 1: 0, 2: 0, 3: 0 };
    players.forEach((p) => { byGrade[p.grade]++; });
    return {
      count: players.length,
      rating: avg(Player.rating),
      best,
      byGrade,
    };
  }

  return { make, batterSet, pitcherSet, freshmanSet, summary, splitGrades };
})();
