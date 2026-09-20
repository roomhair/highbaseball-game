/* ==================================================
   高校野球  training.js

   特訓。練習カードが1枚ずつ出てきて、「選択」か「見送る」を選ぶ。
   ・選択は5回で終わり。見送るは合計3回まで。
   ・カードには「誰の」「どの能力が」「どれだけ」上がるかが書いてある。
     中身を隠さないのは、見送る判断に意味を持たせるため。
   ・たまに大当たりのカードや、変化球を覚えるカードが出る。
   ================================================== */
'use strict';

const Training = (() => {

  /** 特訓の状態を作る */
  function start(team) {
    return {
      picks: 0, passes: 0,
      done: false,
      card: draw(team),
      log: [],      // 選んだカードの結果
    };
  }

  function batters(team) { return team.batters; }
  function pitchers(team) { return team.pitchers; }

  /* ---------- 練習カードの引き方 ----------
     「何の練習か」「何人に効くか」「どれだけ効くか」を、それぞれ別に引く。
     人数と効き目が独立なので、全体練習の猛特訓のような当たりがまれに出る
     （12% × 8% ＝ 1%ほど）。 */

  /* 何人に効くか */
  const COUNT_TIERS = [
    { key: 'solo',  weight: 10, label: '個人練習',     pick: () => 1 },
    { key: 'pair',  weight: 18, label: '少人数練習',   pick: () => 2 },
    { key: 'few',   weight: 20, label: '少人数練習',   pick: () => 3 },
    { key: 'group', weight: 22, label: 'グループ練習', pick: () => RNG.range(4, 5) },
    { key: 'wide',  weight: 18, label: 'グループ練習', pick: () => RNG.range(6, 8) },
    { key: 'all',   weight: 12, label: '全体練習',     pick: (n) => n },
  ];

  /* どれだけ効くか。ここが「猛特訓」を引けるかどうか。
     試合1つの伸びが大きいゲームなので、特訓の幅もそれに合わせて広く取ってある。
     ここが小さいと、年に1度しか来ない特訓が誤差になってしまう。
     球速と変化球は上限（168km/h・切れ味7）が近いので、控えめにしてある。

     「猛特訓」は当たりではあるが、1枚で代が決まるほどではない、くらいに
     抑えてある。出やすさも4%まで下げた。ここを強くしすぎると、
     引けたかどうかだけで年が決まってしまい、他の判断が意味を失う。 */
  const POWER_TIERS = [
    { key: 's',  weight: 30, label: '',        stat: [4, 7],   velo: [1, 3],  pitch: 1, ball: [1, 2] },
    { key: 'm',  weight: 40, label: '',        stat: [7, 12],  velo: [3, 5],  pitch: 1, ball: [2, 3] },
    { key: 'l',  weight: 22, label: 'みっちり', stat: [14, 23], velo: [5, 8],  pitch: 2, ball: [3, 4] },
    { key: 'xl', weight: 4,  label: '猛特訓',   stat: [18, 28], velo: [7, 11], pitch: 2, ball: [4, 5] },
  ];

  /* まれに、2種類の能力が同時に上がる。
     「何の練習か」「何人に効くか」「どれだけ効くか」と同じく独立に引いているので、
     2種同時と猛特訓が重なったときがいちばんうれしい当たりになる。 */
  const MULTI_RATE = 0.048;

  /* 何の練習か */
  const MENUS = [
    { key: 'bat',     weight: 100, pool: (t) => t.batters },
    { key: 'pit',     weight: 45,  pool: (t) => t.pitchers },
    { key: 'velo',    weight: 18,  pool: (t) => t.pitchers },
    { key: 'break',   weight: 18,  pool: (t) => t.pitchers.filter((p) => p.pitches.some((q) => q.level < 7)) },
    { key: 'newball', weight: 7,   pool: (t) => t.pitchers.filter((p) => p.pitches.length < 6) },
    { key: 'traj',    weight: 3,   pool: (t) => t.batters.filter((p) => p.traj < 4) },
  ];

  function range(pair) { return RNG.range(pair[0], pair[1]); }

  /** 練習カードを1枚引く */
  function draw(team, depth) {
    const menu = RNG.weighted(MENUS);
    const pool = menu.pool(team);
    /* その練習を受けられる選手がいなければ引き直す */
    if (!pool.length) return (depth || 0) < 8 ? draw(team, (depth || 0) + 1) : plainCard(team);

    const power = RNG.weighted(POWER_TIERS);
    const count = RNG.weighted(COUNT_TIERS);
    const n = Math.max(1, Math.min(pool.length, count.pick(pool.length)));
    const chosen = RNG.shuffle(pool.slice()).slice(0, n);

    const base = { kind: menu.key, tier: power.key, tierLabel: power.label, count: n };

    if (menu.key === 'velo') {
      const amount = range(power.velo);
      return Object.assign(base, {
        title: n === 1 ? '走り込み' : '合同で走り込み',
        targets: chosen.map((p) => ({ pid: p.id, name: p.name, label: '球速', amount, key: 'velo', unit: 'km/h' })),
      });
    }

    if (menu.key === 'break') {
      const amount = power.pitch;
      return Object.assign(base, {
        title: '変化球練習',
        targets: chosen.map((p) => {
          const q = RNG.pick(p.pitches.filter((x) => x.level < 7));
          return { pid: p.id, name: p.name, label: q.name, amount, key: 'pitch', pitch: q.name };
        }),
      });
    }

    if (menu.key === 'newball') {
      const targets = [];
      chosen.forEach((p) => {
        const have = new Set(p.pitches.map((q) => q.name));
        const rest = PITCH_TYPES.filter((t) => !have.has(t.name));
        if (!rest.length) return;
        const t = RNG.weighted(rest);
        targets.push({ pid: p.id, name: p.name, label: t.name, amount: range(power.ball), key: 'newpitch', pitch: t.name });
      });
      if (!targets.length) return plainCard(team);
      return Object.assign(base, { title: '新球習得', targets, count: targets.length });
    }

    if (menu.key === 'traj') {
      /* 弾道は1〜4しかないので、上がり幅は増やさず人数だけで効かせる */
      return Object.assign(base, {
        title: '打撃改造',
        targets: chosen.map((p) => ({ pid: p.id, name: p.name, label: '弾道', amount: 1, key: 'traj' })),
      });
    }

    const isPit = menu.key === 'pit';
    const statPool = isPit ? PITCHER_STATS : BATTER_STATS;
    /* 2種同時かどうかは、効き目（猛特訓）とは別に引く */
    const multi = statPool.length >= 2 && RNG.chance(MULTI_RATE);
    const picked = multi ? RNG.shuffle(statPool.slice()).slice(0, 2) : [RNG.pick(statPool)];
    /* 上がり幅は能力ごとに引き直す。片方だけ大きく伸びることもある */
    const amounts = picked.map(() => range(power.stat));
    const targets = [];
    chosen.forEach((p) => {
      picked.forEach((st, i) => {
        targets.push({ pid: p.id, name: p.name, label: st.label, amount: amounts[i], key: st.key });
      });
    });
    return Object.assign(base, {
      multi,
      title: count.label + (isPit ? '（投手）' : ''),
      targets,
    });
  }

  /** どうしても引けなかったときの、ごくふつうのカード */
  function plainCard(team) {
    const p = RNG.pick(team.batters);
    const stat = RNG.pick(BATTER_STATS);
    return {
      kind: 'bat', tier: 'm', tierLabel: '', count: 1, title: '個人練習',
      targets: [{ pid: p.id, name: p.name, label: stat.label, amount: RNG.range(5, 9), key: stat.key }],
    };
  }

  /** カードを選ぶ。能力を実際に上げて、次のカードを引く */
  function choose(state, team) {
    if (state.done) return state;
    const applied = [];
    state.card.targets.forEach((t) => {
      const p = Team.find(team, t.pid);
      if (!p) return;
      let before, after;
      if (t.key === 'traj') {
        before = p.traj; p.traj = Math.min(4, p.traj + t.amount); after = p.traj;
      } else if (t.key === 'velo') {
        before = p.velo; p.velo = Math.min(168, p.velo + t.amount); after = p.velo;
      } else if (t.key === 'pitch') {
        const q = p.pitches.find((x) => x.name === t.pitch);
        if (!q) return;
        before = q.level; q.level = Math.min(7, q.level + t.amount); after = q.level;
        p.pitches.sort((a, b) => b.level - a.level);
      } else if (t.key === 'newpitch') {
        if (p.pitches.some((x) => x.name === t.pitch)) return;
        p.pitches.push({ name: t.pitch, level: t.amount });
        p.pitches.sort((a, b) => b.level - a.level);
        before = 0; after = t.amount;
      } else {
        before = p[t.key]; p[t.key] = RNG.stat(p[t.key] + t.amount); after = p[t.key];
      }
      applied.push({
        pid: p.id, name: p.name, grade: p.grade, kind: p.kind,
        label: t.label, key: t.key, unit: t.unit || '',
        before, after, amount: after - before,
      });
    });

    state.log.push({ title: state.card.title, applied });
    state.picks++;
    if (state.picks >= CONFIG.TRAINING.PICKS) { state.done = true; state.card = null; }
    else state.card = draw(team);
    return state;
  }

  /** カードを見送る */
  function pass(state, team) {
    if (state.done) return state;
    if (state.passes >= CONFIG.TRAINING.PASSES) return state;
    state.passes++;
    state.card = draw(team);
    return state;
  }

  function canPass(state) { return !state.done && state.passes < CONFIG.TRAINING.PASSES; }

  /** 特訓の結果を「誰の・どの能力が・どれだけ」でまとめ直す */
  function summarize(state) {
    const map = new Map();
    state.log.forEach((entry) => {
      entry.applied.forEach((a) => {
        const key = a.pid + '/' + a.label;
        if (map.has(key)) {
          const m = map.get(key);
          m.amount += a.amount; m.after = a.after;
        } else {
          map.set(key, Object.assign({}, a));
        }
      });
    });
    return Array.from(map.values())
      .filter((m) => m.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  }

  return { start, draw, choose, pass, canPass, summarize };
})();
