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

  /** 練習カードを1枚引く */
  function draw(team) {
    const kinds = [
      { key: 'single', weight: 100 },
      { key: 'big',    weight: 14 },
      { key: 'group',  weight: 26 },
      { key: 'traj',   weight: 7 },
      { key: 'velo',   weight: 16 },
      { key: 'break',  weight: 16 },
      { key: 'newball', weight: 6 },
    ];
    const kind = RNG.weighted(kinds).key;

    if (kind === 'traj') {
      const cand = batters(team).filter((p) => p.traj < 4);
      if (!cand.length) return draw(team);
      const p = RNG.pick(cand);
      return { kind, title: '打撃改造', targets: [{ pid: p.id, name: p.name, label: '弾道', amount: 1, key: 'traj' }] };
    }

    if (kind === 'velo') {
      const p = RNG.pick(pitchers(team));
      const amount = RNG.range(1, 5);
      return { kind, title: '走り込み', targets: [{ pid: p.id, name: p.name, label: '球速', amount, key: 'velo', unit: 'km/h' }] };
    }

    if (kind === 'break') {
      const cand = pitchers(team).filter((p) => p.pitches.some((q) => q.level < 7));
      if (!cand.length) return draw(team);
      const p = RNG.pick(cand);
      const q = RNG.pick(p.pitches.filter((x) => x.level < 7));
      return { kind, title: '変化球練習', targets: [{ pid: p.id, name: p.name, label: q.name, amount: 1, key: 'pitch', pitch: q.name }] };
    }

    if (kind === 'newball') {
      const cand = pitchers(team).filter((p) => p.pitches.length < 6);
      if (!cand.length) return draw(team);
      const p = RNG.pick(cand);
      const have = new Set(p.pitches.map((q) => q.name));
      const pool = PITCH_TYPES.filter((t) => !have.has(t.name));
      if (!pool.length) return draw(team);
      const t = RNG.weighted(pool);
      return { kind, title: '新球習得', targets: [{ pid: p.id, name: p.name, label: t.name, amount: RNG.range(1, 3), key: 'newpitch', pitch: t.name }] };
    }

    if (kind === 'group') {
      const isPit = RNG.chance(0.3);
      const pool = RNG.shuffle((isPit ? pitchers(team) : batters(team)).slice()).slice(0, 3);
      const stat = RNG.pick(isPit ? PITCHER_STATS : BATTER_STATS);
      const amount = RNG.range(1, 3);
      return {
        kind, title: isPit ? '投手陣で合同練習' : '全体練習',
        targets: pool.map((p) => ({ pid: p.id, name: p.name, label: stat.label, amount, key: stat.key })),
      };
    }

    /* ふつうのカード／大当たりのカード */
    const isPit = RNG.chance(0.35);
    const p = RNG.pick(isPit ? pitchers(team) : batters(team));
    const stat = RNG.pick(isPit ? PITCHER_STATS : BATTER_STATS);
    const amount = kind === 'big' ? RNG.range(6, 10) : RNG.range(1, 4);
    return {
      kind,
      title: kind === 'big' ? '猛特訓' : '個人練習',
      targets: [{ pid: p.id, name: p.name, label: stat.label, amount, key: stat.key }],
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
