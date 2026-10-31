/* ==================================================
   高校野球  dataset.js

   チーム作りと新入生選びで見せる「データセット」。
   ・野手のセットは18人。捕一二三遊左中右を1人ずつ（8人）と控え10人。
     学年は 6人ずつ に分かれ、どの学年が6人になるかは毎回変わる。
   ・投手のセットは8人。学年は 2人・3人・3人。
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

  /** 野手18人のセットを1つ作る */
  function batterSet() {
    const grades = RNG.shuffle(splitGrades([6, 6, 6]));   // 18人ぶんの学年
    const posList = DATASET_POSITIONS.slice();            // 8人ぶんの守備位置（DHは含めない）
    /* 残り10人は控え。守る場所が重なってもよい。
       指名打者はここから毎回選ぶ役割で、生まれつきの持ち場にはしない */
    for (let i = 0; i < 10; i++) posList.push(RNG.pick(FIELD_POSITIONS));

    const players = posList.map((pos, i) =>
      Player.newBatter({ grade: grades[i], pos, wide: true }));

    /* 学年の高い順に並べる。同じ学年の中は守備位置の順 */
    const rank = {};
    DATASET_POSITIONS.forEach((k, i) => { rank[k] = i; });
    players.sort((a, b) => (b.grade - a.grade) || (rank[a.pos] - rank[b.pos]));
    return players;
  }

  /** 投手8人のセットを1つ作る */
  function pitcherSet() {
    const grades = RNG.shuffle(splitGrades([2, 3, 3]));
    const players = grades.map((g) => Player.newPitcher({ grade: g, wide: true }));
    players.sort((a, b) => b.grade - a.grade || Player.rating(b) - Player.rating(a));
    return players;
  }

  /* テストプレイ用（?test=bear など）。ふだんは使わない */
  const test = { bear: false, strong: false };

  /** 強めの新入生。何人か作って、いちばん強い1人を選ぶ（ほかの組の最良の選手より、総合で2〜3ほど上になる強さ）。
      この選手が入ったセットを選ぶと、1年生からレギュラー確約が条件になる（regularLock） */
  function strongFreshman(pos, prestigeBonus) {
    let best = null;
    for (let i = 0; i < 3; i++) {
      const p = Player.newBatter({ grade: 1, pos, prestigeBonus: (prestigeBonus || 0) + 12, genius: false });
      if (!best || Player.rating(p) > Player.rating(best)) best = p;
    }
    best.regularLock = true;
    return best;
  }

  /** 新入生（1年生だけ）のセット。prestigeBonus は学校の格による下駄。
      strong が true なら、強めの選手を1人入れる（野手のみ） */
  function freshmanSet(kind, n, prestigeBonus, strong) {
    const players = [];
    if (kind === 'batter') {
      /* 守る場所がばらけるように配る。DHは持ち場にしない（役割は毎回選ぶ） */
      const pool = RNG.shuffle(FIELD_POSITIONS.slice());
      for (let i = 0; i < n; i++) {
        /* 1000人に1人、熊が入ってくる */
        if (strong && i === 0) players.push(strongFreshman(pool[0], prestigeBonus));
        else if (test.bear && i === (strong ? 1 : 0)) players.push(Player.newBear({ prestigeBonus }));
        else players.push(RNG.chance(1 / 1000)
          ? Player.newBear({ prestigeBonus })
          : Player.newBatter({ grade: 1, pos: pool[i % pool.length], prestigeBonus }));
      }
    } else {
      /* 新入生の投手の最速は、ほかより少しだけ遅くしてある（veloAdj） */
      for (let i = 0; i < n; i++) players.push(Player.newPitcher({ grade: 1, prestigeBonus, veloAdj: -2.5 }));
    }
    players.sort((a, b) => Player.rating(b) - Player.rating(a));
    return players;
  }

  /** 全セットを通して、同姓同名の選手がいないようにする。
      exclude には、すでにチームにいる選手の名前を渡す（新入生・投手のセット用） */
  function uniqueNames(sets, exclude) {
    const seen = new Set(exclude || []);
    sets.forEach((set) => set.forEach((p) => {
      /* 熊は「熊」という名前で固定（同じ名前でも変えない） */
      if (p.fixedBody || p.animal) return;
      for (let i = 0; i < 50 && seen.has(p.name); i++) {
        const nm = NAMES.personName();
        p.last = nm.last; p.first = nm.first; p.name = nm.last + nm.first;
      }
      seen.add(p.name);
    }));
    return sets;
  }

  /** 指定された数だけ用意する */
  function make(kind, count, n, prestigeBonus, exclude) {
    const sets = [];
    /* 新入生の野手は、20セットに1セットほどの割合で、強めの選手が入ったセットが出る。
       レギュラー確約つきのセットは、同時に2つ以上は出ない */
    let special = -1;
    if (n != null && kind === 'batter') {
      if (test.strong) special = 0;
      else for (let i = 0; i < (count || 5); i++) if (special < 0 && RNG.chance(1 / 20)) special = i;
    }
    for (let i = 0; i < (count || 5); i++) {
      sets.push(n == null
        ? (kind === 'batter' ? batterSet() : pitcherSet())
        : freshmanSet(kind, n, prestigeBonus, i === special));
    }
    /* テストプレイ用の指定は、1回の新入生選びで使い切る */
    if (n != null && kind === 'batter') { test.bear = false; test.strong = false; }
    return uniqueNames(sets, exclude);
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

  return { make, uniqueNames, batterSet, pitcherSet, freshmanSet, summary, splitGrades, test };
})();
