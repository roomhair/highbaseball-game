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

  /** 特訓の状態を作る。limits を渡すと「選択・見送り」の回数を変えられる
      （夏と秋の間などは選べる回数を絞ってある。省略時は今までと同じ） */
  function start(team, limits) {
    return {
      picks: 0, passes: 0,
      pickLimit: (limits && limits.picks) || CONFIG.TRAINING.PICKS,
      passLimit: (limits && limits.passes) != null ? limits.passes : CONFIG.TRAINING.PASSES,
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
  /* ゲーム全体の難易度調整で、成長幅をもとの1.4倍に引き上げてある
     （試合後の成長は config.js の GROWTH 側で同じ倍率をかけてある）。
     相手の強さ（CONFIG.FIELD）やステータスと勝率の関係（sim.js）は
     いっさい変えていない。
     「試合後の伸びを小さく、特訓での伸びを大きく」する要望に合わせて、
     ここをさらに1.35倍に引き上げてある（config.js の PER_GAME_BAT/PIT を
     0.6倍にしたのと釣り合わせてあり、夏の大会の決勝進出時点の強さは
     これまでとほぼ変わらないことを実測で確認済み）。
     ただし球速（velo）だけは、この2段の引き上げを他の能力と同じ比率で
     乗せると「特訓だけで3年かけて168km/h上限まで届く」ほど伸びすぎて
     しまっていた（実測: 1回あたり平均7.1km/h、球速一本に絞れば
     卒業時点で平均44.6km/hも伸びていた）。そのため velo の幅だけは
     他の能力より控えめに取り直してある。 */
  /* stat（ミート・パワーなど、1つの能力の上がり幅）は、下の
     STAT_COUNT_TIERS で複数の能力が同時に上がりやすくした代わりに、
     1つあたりの額面を0.65倍ほどに抑えてある（特訓で1回に伸びる
     合計の量そのものは、以前とほぼ変わらないよう釣り合わせた）。
     velo・pitch の幅はそのまま。新しく覚える変化球（ball）は、どの段階でも
     1〜2から（覚えたては未熟で、そこから練習で伸ばす）。 */
  const POWER_TIERS = [
    { key: 's',  weight: 30, label: '',        stat: [5, 9],   velo: [1, 3], pitch: 1, ball: [1, 2] },
    { key: 'm',  weight: 40, label: '',        stat: [9, 14],  velo: [2, 4], pitch: 1, ball: [1, 2] },
    { key: 'l',  weight: 22, label: 'みっちり', stat: [14, 21], velo: [4, 6], pitch: 1, ball: [1, 2] },
    { key: 'xl', weight: 4,  label: '猛特訓',   stat: [21, 29], velo: [5, 9], pitch: 4, ball: [1, 2] },
  ];

  /* 1枚のカードで、同じ選手の能力がいくつ同時に上がるか。
     複数が重なりやすく、まれに3つ・4つになることもある。
     同時に上がる能力は同じ種類でなくてよく、投手なら球速・変化球も、打者なら
     弾道も候補に入る（投手は制球・スタミナ・球速・変化球の最大4つ）。
     「複数」と「猛特訓」が重なったときがいちばんうれしい当たりになる。 */
  const STAT_COUNT_TIERS = [
    { weight: 55, n: 1 },
    { weight: 32, n: 2 },
    { weight: 11, n: 3 },
    { weight: 2,  n: 4 },
  ];

  /* 1枚で効く人数の上限（受けられる選手に対する割合） */
  const MAX_SHARE = 0.7;

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
    /* 1枚で効く人数は、その練習を受けられる選手の7割までに抑える
       （全体練習で、ほぼ全員が一度に上がらないようにする） */
    const cap = Math.max(1, Math.floor(pool.length * MAX_SHARE));
    const n = Math.max(1, Math.min(cap, count.pick(pool.length)));
    const chosen = RNG.shuffle(pool.slice()).slice(0, n);

    const base = { kind: menu.key, tier: power.key, tierLabel: power.label, count: n };

    if (menu.key === 'velo') {
      const vt = [];
      chosen.forEach((p) => {
        Body.ensure(p);
        const room = Body.room(p, 'velo');
        const amount = room > 0 ? statAmount(p, 'velo', power, room) : 0;
        if (amount > 0) vt.push({ pid: p.id, name: p.name, label: '球速', amount, key: 'velo', unit: 'km/h' });
      });
      if (!vt.length) return plainCard(team);
      return Object.assign(base, { title: n === 1 ? '走り込み' : '合同で走り込み', targets: vt });
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

    /* 打撃・投球の練習。効く選手はそれぞれ、自分の能力のうち1つ（たまに2つ）が
       ランダムに上がる。どの能力が選ばれやすいかは、その選手の「伸びやすさ」
       （体格と個体差）で決まる確率表。上がり幅もランダムで、
       その能力の上限（頭打ち）を超えることはない */
    const isPit = menu.key === 'pit';
    const targets = [];
    chosen.forEach((p) => {
      Body.ensure(p);
      const used = new Set();
      /* 1つだけ上がる選手が多いが、2つ・3つ同時に上がることもある（そのときは1つあたりを小さく） */
      const nStat = RNG.weighted([{ weight: 45, n: 1 }, { weight: 35, n: 2 }, { weight: 20, n: 3 }]).n;
      const share = [1, 0.62, 0.48][nStat - 1];
      for (let i = 0; i < nStat; i++) {
        const t = rollStatTarget(p, power, used, share);
        if (!t) break;
        used.add(t.key);
        targets.push(t);
      }
    });
    if (!targets.length) return plainCard(team);
    return Object.assign(base, {
      multi: targets.length > chosen.length,
      title: count.label + (isPit ? '（投手）' : ''),
      targets,
    });
  }

  const STAT_LABEL = { meet: 'ミート', power: 'パワー', speed: '走力', arm: '肩力', field: '守備', catch: '捕球', control: '制球', stamina: 'スタミナ', velo: '球速' };

  /** 選手1人ぶんの練習の中身を引く。能力は伸びやすさに比例して選ばれ、上限まで余裕のない能力は選ばれにくい */
  function rollStatTarget(p, power, used, share) {
    const keys = p.kind === 'pitcher' ? ['velo', 'control', 'stamina'] : ['meet', 'power', 'speed', 'arm', 'field', 'catch'];
    const cand = keys.filter((k) => !used.has(k)).map((k) => {
      const room = Body.room(p, k);
      return { key: k, room, weight: room <= 0 ? 0 : Body.ease(p, k) * Math.min(1, room / 6) };
    }).filter((c) => c.weight > 0);
    if (!cand.length) return null;
    const c = RNG.weighted(cand);
    const amount = statAmount(p, c.key, power, c.room, share || 1);
    if (amount <= 0) return null;
    const t = { pid: p.id, name: p.name, label: STAT_LABEL[c.key], amount, key: c.key };
    if (c.key === 'velo') t.unit = 'km/h';
    return t;
  }

  /** 上がり幅。額面（効き目の段階）に、伸びやすさとランダムを掛け、上限までの余裕で止める */
  function statAmount(p, key, power, room, share) {
    const base = (key === 'velo' ? range(power.velo) : range(power.stat)) * (share || 1);
    const f = RNG.clamp(RNG.clamp(0.6 + 0.4 * Body.ease(p, key), 0.5, 1.7) * RNG.clamp(RNG.norm(1, 0.3), 0.4, 1.8), 0.4, 1.4);
    /* 1回の特訓で1つの能力が上がるのは、どんなに当たりでも25まで（球速は10km/hまで） */
    const most = key === 'velo' ? 10 : 25;
    return Math.min(room, most, Math.max(1, Math.round(base * f)));
  }

  /** どうしても引けなかったときの、ごくふつうのカード */
  function plainCard(team) {
    const p = RNG.pick(team.batters);
    Body.ensure(p);
    const t = rollStatTarget(p, POWER_TIERS[1], new Set()) ||
      { pid: p.id, name: p.name, label: 'ミート', amount: 1, key: 'meet' };
    return { kind: 'bat', tier: 'm', tierLabel: '', count: 1, title: '個人練習', targets: [t] };
  }

  /** カードを選ぶ。能力を実際に上げて、次のカードを引く */
  /** 能力は上に行くほど伸びにくい（growth.js の headroom と同じ考え方）。
      特訓はこれまでこの頭打ちを受けずに額面どおり足していたため、
      投手は制球・スタミナの2つしか持ち場が無いぶん、
      特訓を何度も引くだけで100に張り付いてしまっていた。
      試合の成長と同じ頭打ちを、特訓にもかけておく。 */
  function headroom(value, top) {
    const G = CONFIG.GROWTH;
    const left = RNG.clamp(Math.max(0, (top == null ? 100 : top) - value) / G.HEAD_SPAN, 0, 1);
    return RNG.clamp(Math.pow(left, G.HEAD_CURVE), 0.04, 1);
  }

  /* 体格の成長（冬の体づくりや身のこなしの向上）で能力が自然に伸びるようになったぶん、
     特訓の上がり幅を少し絞って、全体の難しさが変わらないようにしてある。
     体格での伸びは1年で、特訓（1年ぶん）の1〜2割ほど */

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
        /* 球速も、その選手の上限（頭打ち）を超えない */
        before = p.velo;
        Body.ensure(p);
        const vAdd = Math.max(0, Math.min(t.amount, Body.room(p, 'velo')));
        p.velo = Math.min(Body.isGenius(p, 'velo') ? 178 : 168, p.velo + vAdd); after = p.velo;
      } else if (t.key === 'pitch') {
        const q = p.pitches.find((x) => x.name === t.pitch);
        if (!q) return;
        before = q.level; q.level = Math.min(7, q.level + t.amount); after = q.level;
        p.pitches.sort((a, b) => b.level - a.level);
      } else if (t.key === 'newpitch') {
        if (p.pitches.some((x) => x.name === t.pitch)) return;
        p.pitches.push({ name: t.pitch, level: Math.min(7, t.amount) });
        p.pitches.sort((a, b) => b.level - a.level);
        before = 0; after = t.amount;
      } else {
        /* meet/power/speed/arm/field/catch と、投手の制球・スタミナがここ。
           カードの額面（t.amount）に、いまの能力に応じた頭打ちをかける */
        Body.ensure(p);
        before = p[t.key];
        const add = Math.max(0, Math.min(t.amount, Body.room(p, t.key)));
        p[t.key] = Math.max(before, Math.min(Body.stat(p, t.key, before + add), before + add));
        after = p[t.key];
      }
      /* 成長履歴に載せる（特訓から次の大会までの月に、均等にばらけて出る） */
      Body.noteTraining(p, t.key, t.pitch, after - before);
      applied.push({
        pid: p.id, name: p.name, grade: p.grade, kind: p.kind,
        label: t.label, key: t.key, unit: t.unit || '',
        before, after, amount: after - before,
      });
    });

    state.log.push({ title: state.card.title, applied });
    state.picks++;
    if (state.picks >= state.pickLimit) { state.done = true; state.card = null; }
    else state.card = draw(team);
    return state;
  }

  /** カードを見送る */
  function pass(state, team) {
    if (state.done) return state;
    if (state.passes >= state.passLimit) return state;
    state.passes++;
    state.card = draw(team);
    return state;
  }

  function canPass(state) { return !state.done && state.passes < state.passLimit; }

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
