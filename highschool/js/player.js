/* ==================================================
   高校野球  player.js

   選手を作る。能力値は 1〜100 の数字で持つ。
   ・level は「そのチームのだいたいの強さ」。自軍の初期メンバーは
     わざと低い level で作る（高校生は最初みんな弱い）。
   ・talent は表に出さない隠し値。これが高い選手は学年に関係なく強く出る。
     たまに飛び抜けた1年生が居ると嬉しいので、少しだけ「逸材」を混ぜてある。
   ・通算成績には、ゲーム内では実装していない練習試合の分も入れておく。
     入部直後の1年生でも「高校通算」が0では味気ないため。
   ================================================== */
'use strict';

const Player = (() => {

  let seq = 1;
  function nextId() { return 'p' + (seq++); }
  /* 保存データを読み直したとき、IDがぶつからないように番号を引き継ぐ */
  function currentSeq() { return seq; }
  function setSeq(n) { seq = Math.max(seq, n | 0); }

  /* 学年ごとの下駄。1年→2年→3年で強くなるが、talent の効きのほうが大きい。
     入部したての部員はとにかく弱い。ここから3年かけて伸ばしていくゲームなので、
     最初の数字はF・Gだらけで構わない。 */
  const GRADE_BASE = { 1: 25, 2: 30, 3: 35 };
  /* チーム作りで学年どうしの差をはっきり出すため、2年・3年の球速に
     自軍だけ上乗せする（相手校には効かせない） */
  const OWN_VELO_EXTRA = { 1: 5, 2: 5, 3: 6 };
  /* 相手校のように「チームの強さ」を指定して作るときの、学年ぶんの差。
     こちらは GRADE_BASE と切り離してある（自軍だけを弱くしたいため） */
  const GRADE_TILT = { 1: -6, 2: 0, 3: 4 };
  const GRADE_VELO = { 1: 0, 2: 5, 3: 9 };

  /** 隠し才能。まれに「逸材」が出る */
  function rollTalent() {
    /* 同じ学校でも力の差は大きい。弱い学校に1人だけ飛び抜けた選手がいる、
       という現実のかたちに近づけるため、ばらつきを広めに取ってある */
    let t = RNG.gauss() * 1.12;
    if (RNG.chance(0.07)) t += 1.8;      // 逸材
    if (RNG.chance(0.015)) t += 1.5;     // さらにその上（学年を問わず主役になる）
    return t;
  }

  /** 1〜100からのはみ出しを、境目にべったり張り付かせず、
      G（またはS）の中に散らす。RNG.stat の単純な切り捨てだけだと、
      1未満になった時点でどれだけ下にはみ出していても一律「1」に
      落ちてしまい、「Gの中はほぼ1」のように境目に確率が積もって見えていた。
      はみ出した分だけ、1〜14（Sなら87〜100）の範囲に一様にばらけさせる */
  function softClamp(v) {
    if (v < 1) return 1 + RNG.rand() * Math.min(13, 1 - v);
    if (v > 100) return 100 - RNG.rand() * Math.min(13, v - 100);
    return v;
  }

  /** 能力1つ。bias はその選手の中での得意不得意。
      talent の効きを弱めに、そのぶんの独立したばらつきを強めにしてある
      （能力の散らばりの幅そのものは変えていない）。talent をそのまま強く
      効かせると、同じ選手のどの能力も「talent」という1つの数字に
      引っ張られてしまい、才能が悪いと全部の能力が最低値に張り付く、
      という選手ばかりになってしまっていたため。
      ownTeam のときだけ、能力ごとの独立したばらつきを狭くしてある
      （自軍の入部時・新入生は、1人の中でミート・パワー・走力などの
      数字がバラバラになりにくい。才能（talent）による選手どうしの
      差はそのまま。相手校はここを変えない） */
  const SINGLE_DIGIT_LIFT = 0.97;
  /* チーム作りの部員（wide）は、新入生より少しばらつきを大きくする */
  function makeStat(base, talent, bias, ownTeam, wide) {
    const sigma = ownTeam ? (wide ? 10.4 : 9.0) : 11.4;
    const v = RNG.stat(softClamp(base + talent * 4 + RNG.norm(0, sigma) + (bias || 0)));
    /* 自軍の入部時・新入生は、能力が一桁（1〜9）になることをほとんど無くす。
       一桁になりかけた分は、10〜14のあたりに引き上げる（ごくまれには残る） */
    if (ownTeam && v < 10 && RNG.chance(SINGLE_DIGIT_LIFT)) return 10 + RNG.range(0, 4);
    return v;
  }

  /** 入部時の能力の下のほう（G＝1〜14）を、さらに減らす。
      体格の補正（Body.attach）で下がった分も含めて、能力がそろったあとに掛ける。
        1〜9 … ほとんど無くす（97%は12〜22に引き上げる）
        10〜14 … 半分ほどを15〜20に引き上げる */
  function liftLow(v) {
    if (v <= 9) return RNG.chance(0.97) ? RNG.range(12, 22) : v;
    if (v <= 14 && RNG.chance(0.5)) return RNG.range(15, 20);
    return v;
  }
  const LIFT_KEYS_BAT = ['meet', 'power', 'speed', 'arm', 'field', 'catch'];
  const LIFT_KEYS_PIT = ['control', 'stamina', 'meet', 'power', 'speed', 'arm', 'field', 'catch'];
  function liftLowStats(p) {
    (p.kind === 'pitcher' ? LIFT_KEYS_PIT : LIFT_KEYS_BAT).forEach((k) => {
      if (p[k] != null && p[k] <= 14) p[k] = liftLow(p[k]);
    });
  }

  /* ---------- 守備適性 ---------- */

  const APT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

  /* 左投げの選手は、捕手・二塁・三塁・遊撃をやらない（一塁と外野だけ）。
     現実でも送球の向きの都合でまず置かない。 */
  const RIGHT_ONLY = ['C', '2B', '3B', 'SS'];

  function aptitudeFor(mainPos, throws) {
    const apt = {};
    /* 本職は A が基本。たまに B 止まり（守れてはいるが上手くはない） */
    const mainIdx = RNG.chance(0.72) ? 0 : 1;
    FIELD_POSITIONS.forEach((key) => {
      if (key === mainPos) { apt[key] = APT_LETTERS[mainIdx]; return; }
      const dist = (POS_NEAR[mainPos] && POS_NEAR[mainPos][key]) != null
        ? POS_NEAR[mainPos][key] : 6;
      let idx = mainIdx + dist + RNG.range(-1, 1);
      /* 捕手は特別な訓練が要る。本職でなければ、まず守れない */
      if (key === 'C' && mainPos !== 'C') idx = Math.max(idx, RNG.chance(0.15) ? 4 : 5);
      apt[key] = APT_LETTERS[RNG.clamp(idx, 0, 6)];
    });
    if (throws === 'L') RIGHT_ONLY.forEach((k) => { apt[k] = 'G'; });
    return apt;
  }

  /** 適性の落ち込み。守備計算で使う減点（A=0 … G=大きい） */
  /**
   * 守備適性を1つ上げる。上がったら新しい評価、上がらなければ null。
   * Aはもう上がらない。下のほうほど上がりやすい（G 30% 〜 B 5%）。
   */
  const APT_UP = { B: 0.05, C: 0.10, D: 0.15, E: 0.20, F: 0.25, G: 0.30 };

  function aptUpChance(letter) { return APT_UP[letter] || 0; }

  function tryAptUp(p, posKey) {
    if (!p || !p.apt || !posKey || posKey === 'DH') return null;
    const now = p.apt[posKey];
    const idx = APT_LETTERS.indexOf(now);
    if (idx <= 0) return null;                    // Aはこれ以上ない
    /* 左投げの選手は捕手・二塁・三塁・遊撃をやらない。
       そこの適性はGのままにしておく */
    if (p.throws === 'L' && RIGHT_ONLY.indexOf(posKey) >= 0) return null;
    if (!RNG.chance(aptUpChance(now))) return null;
    p.apt[posKey] = APT_LETTERS[idx - 1];
    return { before: now, after: p.apt[posKey] };
  }

  function aptPenalty(letter) {
    const idx = APT_LETTERS.indexOf(letter);
    return idx < 0 ? 30 : [0, 4, 9, 15, 21, 28, 36][idx];
  }

  /* ---------- 利き手 ----------
     左投は右投の半分くらい（投手は8割くらい）の割合で出す。
     捕手・二塁・三塁・遊撃は左投では守れないので、そこは右投にする。

     打つほうは投げるほうと別に決める。高校では足を活かすために
     右投げのまま左打ちに転向する選手が多いので、その割合を高くしてある。
     左投右打はめちゃくちゃ珍しいので、ほんの少しだけ混ぜる。 */

  function hands(isPitcher, forceRight) {
    const leftRatio = isPitcher ? 0.80 : 0.50;
    const throws = (!forceRight && RNG.chance(leftRatio / (1 + leftRatio))) ? 'L' : 'R';
    let bats;
    if (throws === 'L') {
      bats = RNG.chance(0.03) ? 'R' : 'L';     // 左投右打はごく稀
    } else {
      bats = RNG.chance(0.52) ? 'L' : 'R';     // 右投左打はいちばん多い型
    }
    return { throws, bats };
  }

  /* ---------- 変化球 ---------- */

  function rollPitches(talent, grade, levelShift, bodyShift) {
    const boost = (levelShift || 0);
    /* 自軍の入部時（新入生・チーム作成）は levelShift を渡さないので boost が
       ちょうど0になる。相手校（大会の強さぶんの levelShift が乗る）には
       効かせず、入部したての投手の決め球だけ控えめにするための引き算 */
    const rookiePenalty = boost === 0 ? 0.5 : 0;
    /* 球種の数。才能と学年が上がるほど引き出しが増える。
       高校生なので、いくつも決め球を持っている投手はそう多くない */
    let n = 2;
    const bs = bodyShift || 0;      // 身体能力が高いほど、球種を増やしやすく、切れも良くなりやすい
    const r = Math.random() + talent * 0.09 + (grade - 1) * 0.09 + boost * 0.09 + bs * 0.06;
    if (r > 1.70) n = 5; else if (r > 1.30) n = 4; else if (r > 0.82) n = 3;
    else if (r < 0.26) n = 1;

    const pool = PITCH_TYPES.slice();
    const out = [];
    for (let i = 0; i < n && pool.length; i++) {
      const picked = RNG.weighted(pool);
      pool.splice(pool.indexOf(picked), 1);
      /* 切れ味は1〜7。才能が高いほど良い球を持ちやすい */
      let lv = Math.round(RNG.clamp(RNG.norm(1.20 + talent * 0.58 + (grade - 1) * 0.22 + boost * 0.70 - rookiePenalty + bs * 0.22, 0.85), 1, 7));
      out.push({ name: picked.name, level: lv });
    }
    /* 一番いい球を先頭に置く（詳細画面で決め球が上に来る） */
    out.sort((a, b) => b.level - a.level);
    return out;
  }

  /* ---------- 成績の器 ---------- */

  function emptyBat() {
    return { g: 0, pa: 0, ab: 0, h: 0, d2: 0, d3: 0, hr: 0, rbi: 0, r: 0, bb: 0, so: 0, sb: 0, sf: 0, sh: 0 };
  }
  function emptyPit() {
    return { g: 0, gs: 0, w: 0, l: 0, sv: 0, outs: 0, bf: 0, h: 0, hr: 0, bb: 0, so: 0, r: 0, er: 0, cg: 0, sho: 0, np: 0 };
  }
  function addStats(dst, src) {
    for (const k in src) dst[k] = (dst[k] || 0) + src[k];
    return dst;
  }

  /* ---------- 練習試合ぶんの通算成績 ----------
     ゲームには出てこない練習試合を、数字だけ先に積んでおく。
     中身は sim.js に任せてあり、実際の試合とまったく同じ計算で回している。
     別の式で作ると「通算打率の割に大会では打たない」が起きてしまう。

     peerLevel は「その選手がぶつかる相手のだいたいの強さ」。
     大会の相手は自チームの力に合わせて用意されるので、
     入部したての部員は低めの相手を想定しておけばだいたい合う。 */

  const HOME_PEER_LEVEL = 26;

  function seedPracticeBat(p, games, peerLevel) {
    const pa = Math.max(0, Math.round(games * RNG.norm(3.6, 0.25)));
    const s = Sim.careerBat(p, pa, peerLevel == null ? HOME_PEER_LEVEL : peerLevel);
    s.g = games;
    return s;
  }

  function seedPracticePit(p, games0, peerLevel) {
    /* 投手は野手のように毎試合は出ない。以前は野手と同じ試合数を投げた
       ことにしていて、3年生で80試合・290回にもなっていたので、
       試合数を4割にする（3年生で30試合・110回前後） */
    const games = Math.max(games0 > 0 ? 1 : 0, Math.round(games0 * 0.4));
    const outs = Math.max(0, Math.round(games * RNG.norm(11, 2.2)));
    const s = Sim.careerPit(p, outs, peerLevel == null ? HOME_PEER_LEVEL : peerLevel);
    s.g = games;
    s.gs = Math.round(games * 0.55);
    /* 勝敗は投球回と失点から、ざっくり割り振る */
    const ip = Math.max(1, s.outs / 3);
    const era = s.er * 9 / ip;
    const winRate = RNG.clamp(0.72 - era * 0.055, 0.12, 0.88);
    s.w = Math.round(s.gs * winRate);
    s.l = Math.max(0, s.gs - s.w - Math.round(s.gs * 0.12));
    s.cg = Math.round(s.gs * RNG.clamp(0.55 - era * 0.04, 0.05, 0.6));
    s.sho = Math.round(s.cg * RNG.clamp(0.22 - era * 0.03, 0, 0.2));
    return s;
  }

  /** 練習試合の試合数のめやす。学年が上なほど多く積んである */
  function practiceGames(grade) {
    return { 1: RNG.range(6, 16), 2: RNG.range(34, 52), 3: RNG.range(66, 92) }[grade] || 0;
  }

  /* ---------- 選手を作る ---------- */

  function baseOf(grade, level, prestigeBonus) {
    /* level を指定しなければ学年どおり（自軍の部員）。
       指定があれば、その強さに学年ぶんの差を足す（相手校）。
       prestigeBonus は学校の格による新入生の下駄（自軍の新入生だけ） */
    const base = level == null ? (GRADE_BASE[grade] || 30) : level + (GRADE_TILT[grade] || 0);
    return base + (prestigeBonus || 0);
  }

  function newBatter(opt) {
    opt = opt || {};
    const grade = opt.grade || 1;
    const pos = opt.pos || RNG.pick(FIELD_POSITIONS);
    const talent = opt.talent != null ? opt.talent : rollTalent();
    const base = baseOf(grade, opt.level, opt.prestigeBonus);
    const ownTeam = opt.level == null;
    const hd = hands(false, RIGHT_ONLY.indexOf(pos) >= 0);
    /* 身長・体重・身体能力（body.js）。能力に足すのは、選手ができあがってから */
    const body = Body.roll('batter', pos, grade);
    const bodyIdx = (k) => Body.idxOf({ kind: 'batter', grade, ht: body.ht, phys: body.phys }, k);

    /* 守る場所によって、伸びる方向が少し違う。
       捕手は肩と捕球、遊撃は守備と走力、一塁と指名打者は打撃に寄る */
    const bias = {
      C:   { arm: 8, catch: 10, field: 4, speed: -10, power: 0, meet: 0 },
      '1B':{ power: 8, meet: 3, speed: -8, arm: -5, field: -4, catch: 2 },
      '2B':{ field: 7, catch: 5, speed: 4, power: -7, arm: -2, meet: 2 },
      '3B':{ arm: 7, power: 5, field: 3, speed: -4, catch: 0, meet: 0 },
      SS:  { field: 9, arm: 6, speed: 5, power: -8, catch: 2, meet: 0 },
      LF:  { power: 5, meet: 2, field: -3, arm: -3, speed: 0, catch: 0 },
      CF:  { speed: 10, field: 5, meet: 2, power: -4, arm: 0, catch: 0 },
      RF:  { arm: 9, power: 5, speed: 2, field: -2, catch: 0, meet: 0 },
      DH:  { power: 9, meet: 5, field: -12, catch: -10, arm: -8, speed: -5 },
    }[pos] || {};

    const p = {
      id: nextId(), kind: 'batter',
      last: null, first: null, name: '',
      grade, pos,
      throws: hd.throws, bats: hd.bats,
      talent,
      traj: RNG.clamp(Math.round(RNG.norm(1.75 + talent * 0.20 + 0.10 * bodyIdx('traj'), 0.68)), 1, 4),
      meet:  makeStat(base, talent, bias.meet, ownTeam, opt.wide),
      power: makeStat(base, talent, bias.power, ownTeam, opt.wide),
      speed: makeStat(base, talent, bias.speed, ownTeam, opt.wide),
      arm:   makeStat(base, talent, bias.arm, ownTeam, opt.wide),
      field: makeStat(base, talent, bias.field, ownTeam, opt.wide),
      catch: makeStat(base, talent, bias.catch, ownTeam, opt.wide),
      /* 100に近いほど引っ張り、-100に近いほど流し打ち。0ならセンター返し */
      pull: Math.round(RNG.clamp(RNG.norm(20, 42), -100, 100)),
      apt: null,   // 利き腕が決まってから入れる
      awakened: false,
      hl: [],
    };
    p.apt = aptitudeFor(pos === 'DH' ? RNG.pick(FIELD_POSITIONS) : pos, p.throws);
    const nm = NAMES.personName();
    p.last = nm.last; p.first = nm.first; p.name = nm.last + nm.first;
    Body.attach(p, body);          // 身長・体重・身体能力の補正（入部時に一度だけ）
    liftLowStats(p);
    if (opt.genius !== false) maybeGenius(p);

    p.career = emptyBat();
    p.tour = emptyBat();
    p.game = emptyBat();
    if (opt.practice !== false) {
      addStats(p.career, seedPracticeBat(p, practiceGames(grade), opt.level));
    }
    /* 選手詳細で「獲得時」の能力と見比べられるように、素の能力を残しておく */
    p.initial = { meet: p.meet, power: p.power, speed: p.speed, arm: p.arm, field: p.field, catch: p.catch, traj: p.traj, ht: p.ht, wt: p.wt };
    return p;
  }


  /* ---------- 天才・熊・部屋 ---------- */

  /* まれに（50人に1人ほど）、1つの能力に天才的な才能を持つ選手が出る。
     天才の能力は上限が100ではなくなり（101以上はSS）、伸びやすい（body.js） */
  const GENIUS_CHANCE = 1 / 50;
  const GENIUS_BAT = ['meet', 'power', 'speed', 'arm', 'field', 'catch'];
  const GENIUS_PIT = ['control', 'stamina', 'velo'];

  function setGenius(p, key) {
    p.genius = key;
    if (key === 'all') return;
    /* 天才は、そもそもその能力が少し高い状態で入ってくる */
    if (key === 'velo') p.velo = Body.stat(p, 'velo', p.velo + 3);
    else p[key] = Body.stat(p, key, p[key] + 6);
  }

  function maybeGenius(p) {
    if (!RNG.chance(GENIUS_CHANCE)) return;
    setGenius(p, RNG.pick(p.kind === 'pitcher' ? GENIUS_PIT : GENIUS_BAT));
  }

  /** 選手の「獲得時」の能力を、いまの能力で取り直す */
  function resetInitial(p) {
    p.initial = { meet: p.meet, power: p.power, speed: p.speed, arm: p.arm, field: p.field, catch: p.catch, traj: p.traj, ht: p.ht, wt: p.wt };
  }

  /** 熊。新入生の野手に、1000人に1人の確率で混じる。
      体格は190cm・150kgのまま変わらず、体格による能力の補正も受けない。
      パワーの天才なので、パワーは上限なし。それ以外は普通の選手と同じ */
  function newBear(opt) {
    opt = opt || {};
    const p = newBatter({ grade: 1, pos: '1B', practice: false, genius: false, prestigeBonus: opt.prestigeBonus });
    p.last = '熊'; p.first = ''; p.name = '熊';
    /* 右投右打。守備適性は、一塁A・三塁C・捕手G・それ以外F */
    p.throws = 'R'; p.bats = 'R';
    p.apt = { C: 'G', '1B': 'A', '2B': 'F', '3B': 'C', SS: 'F', LF: 'F', CF: 'F', RF: 'F' };
    p.traj = 4; p.meet = 30; p.power = 90; p.speed = 70; p.arm = 80; p.field = 30; p.catch = 10;
    p.ht = 190; p.wt = 150;
    p.fixedBody = true;
    p.bodyOff = {}; p.bodyAcc = {}; p.bodyLog = [];
    p.zW0 = Body.zW(p);
    p.genius = 'power';
    p.animal = true;           // 画面には「天才：パワー」ではなく「動物」と出す
    p.career = emptyBat();
    addStats(p.career, seedPracticeBat(p, practiceGames(1), opt.level));
    resetInitial(p);
    return p;
  }

  /** 部屋。ごく稀に相手チームの4番ショートにいる。
      右投左打で、すべての能力がS100。すべての能力に上限がない（天才：すべて）。
      学年はランダム。それ以外は他の選手と同じ（強奪も通常どおり） */
  function newHeya(opt) {
    opt = opt || {};
    const grade = RNG.range(1, 3);      // 1〜3年が同じ確率
    const p = newBatter({ grade, pos: 'SS', level: opt.level, practice: false, genius: false });
    p.last = '部屋'; p.first = ''; p.name = '部屋';
    p.throws = 'R'; p.bats = 'L';
    /* 守備適性は、すべての守備位置がA */
    p.apt = {};
    FIELD_POSITIONS.forEach((k) => { p.apt[k] = 'A'; });
    p.traj = 4; p.meet = 100; p.power = 100; p.speed = 100; p.arm = 100; p.field = 100; p.catch = 100;
    p.genius = 'all';
    /* 身長173cm・体重65kg（そこからの月ごとの変化は、ほかの選手と同じ） */
    p.ht = 173; p.wt = 65; p.zW0 = Body.zW(p);
    /* 体格による補正は、すでに足した分として数える（あとから変わった分だけが効く） */
    p.bodyOff = {};
    Body.STAT_KEYS.forEach((k) => { if (p[k] != null) p.bodyOff[k] = Body.offset(p, k); });
    p.bodyAcc = {};
    p.career = emptyBat();
    addStats(p.career, seedPracticeBat(p, practiceGames(grade), opt.level));
    resetInitial(p);
    return p;
  }

  /* 最初から持っている球速。高校生で145km/hを超える投手はひと握りで、
     150km/h台は全国でも数えるほど。以前はそのまま足し合わせていたため、
     県大会の1回戦の相手に157km/h、全国大会に165km/hの投手が出ていた。
     145km/hから上は伸びを半分ほどに縮め、155km/hで頭打ちにする。
     （入部したあと特訓や試合で伸ばすぶんは、ここでは縛らない） */
  function softVelo(v) {
    const over = Math.max(0, v - 145);
    return RNG.clamp(Math.min(v, 145) + over * 0.5, 105, 155);
  }

  function newPitcher(opt) {
    opt = opt || {};
    const grade = opt.grade || 1;
    const talent = opt.talent != null ? opt.talent : rollTalent();
    const base = baseOf(grade, opt.level, opt.prestigeBonus);
    const ownTeam = opt.level == null;
    const hd = hands(true);
    /* 相手校は大会の強さに合わせて作る。球速と変化球にもそのぶんを効かせないと、
       強いはずの相手が「制球だけ良い遅い投手」になってしまう */
    const levelShift = opt.level == null ? 0 : (opt.level - 41);
    const body = Body.roll('pitcher', 'P', grade);
    const bodyPhys = Body.idxOf({ kind: 'pitcher', grade, ht: body.ht, phys: body.phys }, 'pitch');

    const p = {
      id: nextId(), kind: 'pitcher',
      last: null, first: null, name: '',
      grade, pos: 'P',
      throws: hd.throws, bats: hd.bats,
      talent,
      /* 球速はひとつながりの分布から引く。「何割が150km/h」のような
         決め打ちはしていない。中心は学年とチームの強さで動き、
         そこに才能とその日ごとのばらつきが乗るだけ。
         結果として148km/hも149km/hも、それぞれの確率で出てくる。
         prestigeBonus（学校の格）も、同じ考え方で少しだけ乗せる */
      velo: Math.round(softVelo(
        123 + (GRADE_VELO[grade] || 0) + (ownTeam ? (OWN_VELO_EXTRA[grade] || 0) : 0) + talent * 2.5 + levelShift * 0.38 +
        (opt.prestigeBonus || 0) * 0.3 + RNG.norm(0, 7.5))),
      control: makeStat(base, talent, 0, ownTeam, opt.wide),
      stamina: makeStat(base, talent, 0, ownTeam, opt.wide),
      pitches: rollPitches(talent, grade, levelShift / 8, bodyPhys),
      /* 投手も打席に立つ。打撃は弱めに作る */
      meet:  RNG.stat(makeStat(base, talent, -14, ownTeam)),
      power: RNG.stat(makeStat(base, talent, -12, ownTeam)),
      speed: makeStat(base, talent, -4, ownTeam),
      arm:   makeStat(base, talent, 6, ownTeam),
      field: makeStat(base, talent, 0, ownTeam),
      catch: makeStat(base, talent, -2, ownTeam),
      traj: RNG.clamp(Math.round(RNG.norm(1.4, 0.6)), 1, 4),
      pull: Math.round(RNG.clamp(RNG.norm(15, 40), -100, 100)),
      apt: aptitudeFor(RNG.pick(FIELD_POSITIONS), hd.throws),
      /* スタミナの持ち越し（「バッター何人ぶん」ですでに消耗しているか）。
         今日の試合でめいっぱい投げると溜まり、休んだ日ほど抜ける。
         オフシーズンで完全に抜けきる */
      staminaCarry: 0,
      awakened: false,
      hl: [],
    };
    const nm = NAMES.personName();
    p.last = nm.last; p.first = nm.first; p.name = nm.last + nm.first;
    Body.attach(p, body);          // 身長・体重・身体能力の補正（入部時に一度だけ）
    liftLowStats(p);
    if (opt.genius !== false) maybeGenius(p);

    p.career = emptyPit();
    p.tour = emptyPit();
    p.game = emptyPit();
    if (opt.practice !== false) {
      addStats(p.career, seedPracticePit(p, practiceGames(grade), opt.level));
    }
    /* 選手詳細で「獲得時」の能力と見比べられるように、素の能力を残しておく */
    p.initial = {
      velo: p.velo, control: p.control, stamina: p.stamina, ht: p.ht, wt: p.wt,
      pitches: p.pitches.map((q) => ({ name: q.name, level: q.level })),
    };
    return p;
  }

  /* ---------- 評価 ---------- */

  /** 変化球の総合的な切れ味（0〜1）。
     高校野球では変化球だけで抑えきれるものではないので、
     ここの数字が試合を支配しすぎないよう低めに出るようにしてある。 */
  function breakScore(p) {
    if (!p.pitches || !p.pitches.length) return 0.06;
    let best = 0, sum = 0;
    p.pitches.forEach((q) => { best = Math.max(best, q.level); sum += q.level; });
    /* 決め球1つと、球種の多さの両方を見る */
    return RNG.clamp(best / 7 * 0.52 + Math.min(sum, 18) / 18 * 0.20, 0, 1);
  }

  /** 総合力（0〜100）。強奪や「一番いい選手」の判定に使う */
  function rating(p) {
    if (p.kind === 'pitcher') {
      /* 野手と並べて比べられるよう、球速の目盛りは rating 専用にしてある
         （試合の計算に使う Sim.veloScore とは別） */
      const velo = RNG.clamp((p.velo - 108) / 52, 0, 1) * 100;
      /* 球威（球速＋変化球）と制球でほぼ決まる。スタミナは終盤にしか効かない */
      return Math.round(velo * 0.31 + breakScore(p) * 100 * 0.22 + p.control * 0.35 + p.stamina * 0.12);
    }
    /* 試合でどれだけ効くかに合わせた重み。打てるかどうかがほとんどで、
       守備・肩・走力はそれより小さい。ここが実際の効き目とずれていると
       「能力の割に勝てない」に見えてしまう */
    return Math.round(
      p.meet * 0.34 + p.power * 0.28 + (p.traj - 1) / 3 * 100 * 0.07 +
      p.speed * 0.08 + p.field * 0.13 + p.catch * 0.06 + p.arm * 0.04
    );
  }

  function batsText(p) { return p.bats === 'L' ? '左打' : (p.bats === 'B' ? '両打' : '右打'); }

  function handLabel(p) {
    return (p.throws === 'L' ? '左投' : '右投') + batsText(p);
  }

  /** 投げる手を変える（左投げは捕手・二塁・三塁・遊撃の適性がGになる）。
      右投げに戻したときは、左にする前の適性に戻す */
  function setThrows(p, hand) {
    if (p.throws === hand) return;
    if (hand === 'L') {
      p._aptR = Object.assign({}, p.apt);
      RIGHT_ONLY.forEach((k) => { if (p.apt) p.apt[k] = 'G'; });
    } else if (p._aptR) {
      p.apt = Object.assign(p.apt || {}, p._aptR);
      p._aptR = null;
    }
    p.throws = hand;
  }

  function gradeLabel(g) { return g + '年'; }

  /* 変化球を表示する順番。利き手と逆に曲がる球（スライダー・カットボール）から、
     逆側の斜めに落ちる球（カーブ）、真下に落ちる球（フォーク・チェンジアップ）、
     利き手側の斜めに落ちる球（シンカー）を通って、利き手側に曲がる球（シュート・ツーシーム）へ。
     データの並び（決め球が先頭）は変えず、見せるときだけ並べ替える */
  const PITCH_ORDER = [
    'スライダー', 'カットボール',
    'カーブ', 'スローカーブ', 'ナックルカーブ',
    'スプリット', 'フォーク', 'チェンジアップ', 'パーム', 'ナックル',
    'シンカー', 'スクリュー',
    'シュート', 'ツーシーム',
  ];
  function pitchesInOrder(p) {
    const idx = (n) => { const i = PITCH_ORDER.indexOf(n); return i < 0 ? PITCH_ORDER.length : i; };
    return (p.pitches || []).slice().sort((a, b) => idx(a.name) - idx(b.name));
  }

  return {
    pitchesInOrder,
    newBatter, newPitcher, newBear, newHeya, rating, breakScore, aptPenalty, handLabel, batsText, setThrows, gradeLabel, RIGHT_ONLY,
    tryAptUp, aptUpChance,
    emptyBat, emptyPit, addStats, seedPracticeBat, seedPracticePit, practiceGames,
    rollTalent, nextId, currentSeq, setSeq,
  };
})();
