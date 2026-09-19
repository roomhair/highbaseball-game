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

  /* 学年ごとの下駄。1年→2年→3年で強くなるが、talent の効きのほうが大きい */
  const GRADE_BASE = { 1: 33, 2: 42, 3: 49 };
  const GRADE_VELO = { 1: 0, 2: 5, 3: 9 };

  /** 隠し才能。まれに「逸材」が出る */
  function rollTalent() {
    let t = RNG.gauss();
    if (RNG.chance(0.06)) t += 1.7;      // 逸材
    if (RNG.chance(0.012)) t += 1.3;     // さらにその上（学年を問わず主役になる）
    return t;
  }

  /** 能力1つ。bias はその選手の中での得意不得意 */
  function makeStat(base, talent, bias) {
    return RNG.stat(base + talent * 9 + RNG.norm(0, 7) + (bias || 0));
  }

  /* ---------- 守備適性 ---------- */

  const APT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

  function aptitudeFor(mainPos) {
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
    return apt;
  }

  /** 適性の落ち込み。守備計算で使う減点（A=0 … G=大きい） */
  function aptPenalty(letter) {
    const idx = APT_LETTERS.indexOf(letter);
    return idx < 0 ? 30 : [0, 4, 9, 15, 21, 28, 36][idx];
  }

  /* ---------- 利き手 ----------
     左投は右投の半分くらい（投手は8割くらい）の割合で出す。
     左投右打はめちゃくちゃ珍しいので、ほんの少しだけ混ぜる。 */

  function hands(isPitcher) {
    const leftRatio = isPitcher ? 0.80 : 0.50;
    const throws = RNG.chance(leftRatio / (1 + leftRatio)) ? 'L' : 'R';
    let bats;
    if (throws === 'L') {
      bats = RNG.chance(0.03) ? 'R' : 'L';     // 左投右打はごく稀
    } else {
      bats = RNG.chance(0.34) ? 'L' : 'R';     // 右投左打はよくいる
    }
    return { throws, bats };
  }

  /* ---------- 変化球 ---------- */

  function rollPitches(talent, grade, levelShift) {
    const boost = (levelShift || 0);
    /* 球種の数。才能と学年が上がるほど引き出しが増える */
    let n = 2;
    const r = Math.random() + talent * 0.10 + (grade - 1) * 0.10 + boost * 0.10;
    if (r > 1.35) n = 5; else if (r > 0.98) n = 4; else if (r > 0.55) n = 3;
    else if (r < 0.10) n = 1;

    const pool = PITCH_TYPES.slice();
    const out = [];
    for (let i = 0; i < n && pool.length; i++) {
      const picked = RNG.weighted(pool);
      pool.splice(pool.indexOf(picked), 1);
      /* 切れ味は1〜7。才能が高いほど良い球を持ちやすい */
      let lv = Math.round(RNG.clamp(RNG.norm(2.2 + talent * 0.85 + (grade - 1) * 0.3 + boost, 1.0), 1, 7));
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
    return { g: 0, gs: 0, w: 0, l: 0, outs: 0, bf: 0, h: 0, hr: 0, bb: 0, so: 0, r: 0, er: 0, cg: 0, sho: 0 };
  }
  function addStats(dst, src) {
    for (const k in src) dst[k] = (dst[k] || 0) + src[k];
    return dst;
  }

  /* ---------- 練習試合ぶんの通算成績 ----------
     ゲームには出てこない練習試合を、数字だけ先に積んでおく。 */

  function seedPracticeBat(p, games) {
    const avg = RNG.clamp(0.120 + p.meet * 0.0022 + p.power * 0.0006, 0.06, 0.45);
    const pa = Math.round(games * RNG.norm(3.6, 0.4));
    const bb = Math.round(pa * RNG.clamp(RNG.norm(0.075, 0.03), 0.01, 0.20));
    const sf = Math.round(pa * 0.012), sh = Math.round(pa * RNG.clamp(RNG.norm(0.03, 0.02), 0, 0.10));
    const ab = Math.max(0, pa - bb - sf - sh);
    const h = Math.round(ab * RNG.clamp(RNG.norm(avg, 0.035), 0.02, 0.55));
    const hrRate = RNG.clamp((p.power - 35) / 100 * 0.055 * (0.55 + 0.22 * p.traj), 0, 0.10);
    const hr = Math.round(ab * hrRate * RNG.clamp(RNG.norm(1, 0.35), 0.2, 2));
    const d2 = Math.round((h - hr) * RNG.clamp(RNG.norm(0.16, 0.04), 0.05, 0.30));
    const d3 = Math.round((h - hr) * RNG.clamp(RNG.norm(0.03 + p.speed * 0.0004, 0.02), 0, 0.10));
    const so = Math.round(ab * RNG.clamp(RNG.norm(0.22 - p.meet * 0.0012, 0.04), 0.03, 0.45));
    const sb = Math.round(games * RNG.clamp((p.speed - 40) / 100 * 0.22, 0, 0.5));
    return {
      g: games, pa, ab, h: Math.max(hr, h), d2: Math.max(0, d2), d3: Math.max(0, d3), hr,
      rbi: Math.round(h * 0.55 + hr * 1.2), r: Math.round(h * 0.5 + bb * 0.3),
      bb, so, sb, sf, sh,
    };
  }

  function seedPracticePit(p, games) {
    const brk = breakScore(p);
    const starts = Math.round(games * 0.55);
    const outs = Math.max(3, Math.round(games * RNG.norm(11, 2.5)));
    const ip = outs / 3;
    /* 9イニングあたりの割合を作ってから、投球回ぶんに直す */
    const bb9  = RNG.clamp(RNG.norm(6.2 - p.control * 0.05, 0.8), 0.6, 11);
    const so9  = RNG.clamp(RNG.norm(1.0 + (p.velo - 110) * 0.10 + brk * 4.5, 1.2), 0.8, 15);
    const h9   = RNG.clamp(RNG.norm(13.5 - p.control * 0.035 - (p.velo - 110) * 0.06 - brk * 4, 1.5), 4, 20);
    const era  = RNG.clamp(RNG.norm(8.2 - p.control * 0.030 - (p.velo - 110) * 0.05 - brk * 4, 1.0), 0.35, 14);
    const h    = Math.round(ip * h9 / 9);
    const er   = Math.round(ip * era / 9);
    return {
      g: games, gs: starts,
      w: Math.round(starts * 0.52), l: Math.round(starts * 0.30),
      outs, bf: Math.round(ip * 4.4), h,
      hr: Math.round(h * 0.045),
      bb: Math.round(ip * bb9 / 9),
      so: Math.round(ip * so9 / 9),
      r: Math.round(er * 1.22), er,
      cg: Math.round(starts * 0.35), sho: 0,
    };
  }

  /** 練習試合の試合数のめやす。学年が上なほど多く積んである */
  function practiceGames(grade) {
    return { 1: RNG.range(6, 16), 2: RNG.range(34, 52), 3: RNG.range(66, 92) }[grade] || 0;
  }

  /* ---------- 選手を作る ---------- */

  function baseOf(grade, level) {
    /* level を指定しなければ学年どおり。指定があれば、そちらに寄せる
       （相手校は大会の強さに合わせて作るため） */
    const g = GRADE_BASE[grade] || 40;
    return level == null ? g : (level + (g - 41) * 0.55);
  }

  function newBatter(opt) {
    opt = opt || {};
    const grade = opt.grade || 1;
    const pos = opt.pos || RNG.pick(FIELD_POSITIONS);
    const talent = opt.talent != null ? opt.talent : rollTalent();
    const base = baseOf(grade, opt.level);
    const hd = hands(false);

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
      traj: RNG.clamp(Math.round(RNG.norm(2.1 + talent * 0.25, 0.75)), 1, 4),
      meet:  makeStat(base, talent, bias.meet),
      power: makeStat(base, talent, bias.power),
      speed: makeStat(base, talent, bias.speed),
      arm:   makeStat(base, talent, bias.arm),
      field: makeStat(base, talent, bias.field),
      catch: makeStat(base, talent, bias.catch),
      /* 100に近いほど引っ張り、-100に近いほど流し打ち。0ならセンター返し */
      pull: Math.round(RNG.clamp(RNG.norm(20, 42), -100, 100)),
      apt: aptitudeFor(pos === 'DH' ? RNG.pick(FIELD_POSITIONS) : pos),
      awakened: false,
      hl: [],
    };
    const nm = NAMES.personName();
    p.last = nm.last; p.first = nm.first; p.name = nm.last + nm.first;

    p.career = emptyBat();
    p.tour = emptyBat();
    p.game = emptyBat();
    if (opt.practice !== false) addStats(p.career, seedPracticeBat(p, practiceGames(grade)));
    return p;
  }

  function newPitcher(opt) {
    opt = opt || {};
    const grade = opt.grade || 1;
    const talent = opt.talent != null ? opt.talent : rollTalent();
    const base = baseOf(grade, opt.level);
    const hd = hands(true);
    /* 相手校は大会の強さに合わせて作る。球速と変化球にもそのぶんを効かせないと、
       強いはずの相手が「制球だけ良い遅い投手」になってしまう */
    const levelShift = opt.level == null ? 0 : (opt.level - 41);

    const p = {
      id: nextId(), kind: 'pitcher',
      last: null, first: null, name: '',
      grade, pos: 'P',
      throws: hd.throws, bats: hd.bats,
      talent,
      velo: Math.round(RNG.clamp(
        117 + (GRADE_VELO[grade] || 0) + talent * 5.4 + levelShift * 0.30 + RNG.norm(0, 4), 108, 162)),
      control: makeStat(base, talent, 0),
      stamina: makeStat(base, talent, 0),
      pitches: rollPitches(talent, grade, levelShift / 12),
      /* 投手も打席に立つ。打撃は弱めに作る */
      meet:  RNG.stat(makeStat(base, talent, -14)),
      power: RNG.stat(makeStat(base, talent, -12)),
      speed: makeStat(base, talent, -4),
      arm:   makeStat(base, talent, 6),
      field: makeStat(base, talent, 0),
      catch: makeStat(base, talent, -2),
      traj: RNG.clamp(Math.round(RNG.norm(1.7, 0.7)), 1, 4),
      pull: Math.round(RNG.clamp(RNG.norm(15, 40), -100, 100)),
      apt: aptitudeFor(RNG.pick(FIELD_POSITIONS)),
      awakened: false,
      hl: [],
    };
    const nm = NAMES.personName();
    p.last = nm.last; p.first = nm.first; p.name = nm.last + nm.first;

    p.career = emptyPit();
    p.tour = emptyPit();
    p.game = emptyPit();
    p.batCareer = emptyBat();
    p.batTour = emptyBat();
    p.batGame = emptyBat();
    if (opt.practice !== false) {
      addStats(p.career, seedPracticePit(p, practiceGames(grade)));
      addStats(p.batCareer, seedPracticeBat(p, Math.round(practiceGames(grade) * 0.7)));
    }
    return p;
  }

  /* ---------- 評価 ---------- */

  /** 変化球の総合的な切れ味（0〜1） */
  function breakScore(p) {
    if (!p.pitches || !p.pitches.length) return 0.1;
    let best = 0, sum = 0;
    p.pitches.forEach((q) => { best = Math.max(best, q.level); sum += q.level; });
    /* 決め球1つと、球種の多さの両方を見る */
    return RNG.clamp(best / 7 * 0.68 + Math.min(sum, 18) / 18 * 0.32, 0, 1);
  }

  /** 総合力（0〜100）。引き抜きや「一番いい選手」の判定に使う */
  function rating(p) {
    if (p.kind === 'pitcher') {
      /* 野手と並べて比べられるよう、球速の目盛りは rating 専用にしてある
         （試合の計算に使う Sim.veloScore とは別） */
      const velo = RNG.clamp((p.velo - 104) / 52, 0, 1) * 100;
      return Math.round(velo * 0.30 + p.control * 0.28 + p.stamina * 0.16 + breakScore(p) * 100 * 0.26);
    }
    return Math.round(
      p.meet * 0.27 + p.power * 0.24 + p.speed * 0.13 +
      p.field * 0.13 + p.catch * 0.09 + p.arm * 0.09 + (p.traj - 1) / 3 * 100 * 0.05
    );
  }

  function handLabel(p) {
    return (p.throws === 'L' ? '左投' : '右投') + (p.bats === 'L' ? '左打' : '右打');
  }

  function gradeLabel(g) { return g + '年'; }

  return {
    newBatter, newPitcher, rating, breakScore, aptPenalty, handLabel, gradeLabel,
    emptyBat, emptyPit, addStats, seedPracticeBat, seedPracticePit, practiceGames,
    rollTalent, nextId, currentSeq, setSeq,
  };
})();
