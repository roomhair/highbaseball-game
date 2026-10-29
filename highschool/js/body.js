/* ==================================================
   高校野球  body.js

   身長・体重・身体能力による、選手の能力の補正。

   選手の強さに効くものを、次の3つに分けて持つ。
     ① 身長・体重（公開）… 選手詳細に出る。ht（cm・小数）、wt（kg・小数）
     ② 身体能力（非公開）… phys。画面には出さない。選手ごとの内部の個性
     ③ 既存の基礎能力・技術・成長 … このファイルの外（player.js・growth.js・training.js）

   ・身長と身体能力は、別々の値として持つ（身長から身体能力を推し量ったり、
     同じ値で代用したりしない）。
   ・どちらも「標準化した値」にして、同じ係数で能力に効かせる。
       身長 hz = (身長 − 同じ学年・同じ区分の平均) ÷ 5.5cm
       身体能力 pz = phys（平均0・標準偏差1）
     能力ごとの効き  idx(能力) = hz × 身長の向き(能力) + pz × 1
     「身長が+1標準偏差」と「身体能力が+1標準偏差」は、向きが±1の能力では
     まったく同じ大きさで効く（bodyTest で確かめられる）。
     身体能力の向きはすべての能力でプラス。身長の向きは下の DIR_H のとおり
     能力ごとに決めてある（根拠なくぜんぶプラスにはしていない）。
   ・効き方は3か所:
       a. 入部時の能力に足す（offset）。一度だけ。身長・体重が変わったときは、
          「新しい補正 − すでに足した補正」だけを足す（二重に足さない）
       b. 試合・特訓での伸びやすさ（gm）… 1 + 0.10 × idx（0.6〜1.5倍）
       c. 能力の上限（ceil）… 98 + 3.5 × idx（80〜100）
   ・身長は1cm単位で連続的に効く（段階にしていない）。
   ・体重は、身長・学年に対する標準（BMI）からの差で見る。入部時点の差を
     基準にして、「その後の増減」が能力の変化に出る。個人差は2つ:
       wtTrend … 体重の増えやすさ（年ごとの増減に出る）
       wtResp  … 増量が能力に結びつく度合い（0に近いと増えても伸びない）
   ================================================== */
'use strict';

const Body = (() => {

  /* ---------- 基準値・係数 ---------- */

  const HT_SD = 5.5;            // 身長の標準偏差（cm）
  const PHYS_SD = 1.0;          // 身体能力の標準偏差
  const OFF_K = 3.2;            // idx 1 あたりに足す能力値（1〜100の能力）
  const VELO_K = 2.0;           // idx 1 あたりに足す球速（km/h）
  const GM_K = 0.10;            // idx 1 あたりの伸びやすさの変化
  const CEIL_BASE = 98, CEIL_K = 3.5, CEIL_MIN = 80;
  const OFF_CAP = 12, VELO_CAP = 7;    // 補正の合計の上限

  /* 同じ学年・同じ区分の平均身長（cm）。投手はやや高い */
  const HT_REF = {
    batter:  { 1: 169.8, 2: 172.4, 3: 173.7 },
    pitcher: { 1: 171.8, 2: 174.4, 3: 175.7 },
  };
  /* 標準的な体格（BMI）。学年が上がると少し増える */
  const BMI_REF = { 1: 21.2, 2: 21.8, 3: 22.3 };
  const BMI_SD = 2.1;
  /* 守る場所による体格の違い（BMI）。生成のときだけ使う */
  const POS_BMI = { C: 1.0, '1B': 1.2, DH: 0.8, '3B': 0.4, SS: -0.5, '2B': -0.4, CF: -0.6, LF: 0.1, RF: 0.3, P: 0.2 };
  const POS_HT = { C: 0.5, '1B': 2.0, DH: 1.0, '3B': 0.8, SS: -1.5, '2B': -1.5, CF: -0.5, LF: 0.4, RF: 0.8, P: 0 };

  /* 身長の向き（身長が高いほど +、低いほど −）。能力ごとに決めてある。
     球速・パワー … 体の大きさがそのまま出る（+1）
     肩力         … 腕が長い・体が大きい（+1）
     守備・捕球   … 重心が高く、低い打球・捕球の動作で不利（−1）
     制球         … 長い手足は、動作のばらつきが出やすい（−1）
     走力         … 小回り・敏捷性ではやや不利（−0.4）
     弾道         … 長いリーチで打球が上がりやすい（+0.4）
     ミート・スタミナ・変化球 … 身長とは結びつけない（0） */
  const DIR_H = {
    velo: 1, power: 1, arm: 1,
    field: -1, catch: -1, control: -1,
    speed: -0.4, traj: 0.4,
    meet: 0, stamina: 0, pitch: 0,
  };

  /* 身長の伸び（cm）。1→2年、2→3年。早熟は小さく、晩成は大きい */
  const HT_GROW = { 1: 2.6, 2: 1.3 };
  const HT_TYPE_FACTOR = { '-1': 0.5, '0': 1.0, '1': 1.6 };

  const STAT_KEYS = ['meet', 'power', 'speed', 'arm', 'field', 'catch', 'control', 'stamina', 'velo'];

  /* ---------- 基本 ---------- */

  function kindOf(p) { return p.kind === 'pitcher' ? 'pitcher' : 'batter'; }
  function refHt(p) { return HT_REF[kindOf(p)][Math.min(3, Math.max(1, p.grade || 1))]; }
  function hz(p) { return (p.ht - refHt(p)) / HT_SD; }
  function pz(p) { return (p.phys || 0) / PHYS_SD; }

  /** 能力 key への効き。身長と身体能力は同じ係数で足し合わせる */
  function idxOf(p, key) {
    return hz(p) * (DIR_H[key] || 0) + pz(p) * 1;
  }
  /** 身長だけ・身体能力だけの効き（テスト用） */
  function idxHeight(p, key) { return hz(p) * (DIR_H[key] || 0); }
  function idxPhys(p) { return pz(p); }

  /* ---------- 体重 ---------- */

  function bmiOf(p) { const h = p.ht / 100; return p.wt / (h * h); }
  function zW(p) { return (bmiOf(p) - BMI_REF[Math.min(3, Math.max(1, p.grade || 1))]) / BMI_SD; }

  /* 体重の効き方（標準からの差 z について）。入部時の z0 を基準に、
     「そこからの変化」だけが能力に出る */
  /* 投手の球速: 軽い・標準のうちは、増量で上がる。標準を少し超えると頭打ち、そこから下がる */
  function gPitch(z) { return z <= 0.4 ? z : 0.4 - 0.7 * (z - 0.4); }
  /* 野手のパワー: 標準を超えるあたりまで増量で上がる。そのあとは伸びにくい */
  function gBat(z) { return z <= 0.8 ? z : 0.8 - 0.35 * (z - 0.8); }
  /* 走力・敏捷性: 標準より重くなると下がる */
  function penSpeed(z) { return Math.max(0, z - 0.6); }
  function penField(z) { return Math.max(0, z - 0.9); }

  function clampAbs(v, cap) { return Math.max(-cap, Math.min(cap, v)); }

  /** 体重による補正（入部時の体重からの変化ぶん）。上限つき */
  function weightOffset(p, key) {
    const z = zW(p), z0 = p.zW0 == null ? z : p.zW0;
    const resp = p.wtResp == null ? 0.8 : p.wtResp;
    let v = 0;
    if (key === 'velo' && p.kind === 'pitcher') v = clampAbs(resp * 2.0 * (gPitch(z) - gPitch(z0)), 4);
    else if (key === 'power' && p.kind !== 'pitcher') v = clampAbs(resp * 3.5 * (gBat(z) - gBat(z0)), 6);
    else if (key === 'speed') v = clampAbs(-4.5 * (penSpeed(z) - penSpeed(z0)), 6);
    else if (key === 'field') v = clampAbs(-1.6 * (penField(z) - penField(z0)), 4);
    return v;
  }

  /* ---------- 補正の計算 ---------- */

  /** 身長と身体能力による補正（能力値の単位。球速は km/h） */
  function heightPhysOffset(p, key) {
    const k = key === 'velo' ? VELO_K : OFF_K;
    return k * idxOf(p, key);
  }

  /** 能力 key に足す補正の合計。上限を超えないようにしてある */
  function offset(p, key) {
    const cap = key === 'velo' ? VELO_CAP : OFF_CAP;
    return clampAbs(heightPhysOffset(p, key) + weightOffset(p, key), cap);
  }

  /** 伸びやすさ（倍率）。身長と身体能力が同じ係数で効く */
  function gm(p, key) {
    let g = 1 + GM_K * idxOf(p, key);
    /* 太りすぎた野手は、パワーの伸びしろが小さい */
    if (key === 'power' && p.kind !== 'pitcher') g *= 1 - 0.2 * Math.max(0, zW(p) - 1.2);
    return Math.max(0.6, Math.min(1.5, g));
  }

  /** 能力の上限（0〜100の目盛り。球速は 108〜160km/h を0〜100に直した値） */
  function ceil(p, key) {
    return Math.max(CEIL_MIN, Math.min(100, CEIL_BASE + CEIL_K * idxOf(p, key)));
  }

  /* ---------- 生成 ---------- */

  /** 新しい選手の身体（身長・体重・身体能力・個人差）を引く */
  function roll(kind, pos, grade) {
    const g = Math.min(3, Math.max(1, grade || 1));
    const kk = kind === 'pitcher' ? 'pitcher' : 'batter';
    const posKey = kk === 'pitcher' ? 'P' : (pos || 'LF');
    const ht = HT_REF[kk][g] + (POS_HT[posKey] || 0) + RNG.norm(0, 5.2);
    const bmi = BMI_REF[g] + (POS_BMI[posKey] || 0) + RNG.norm(0, 2.0);
    const wt = bmi * Math.pow(ht / 100, 2);
    const r = RNG.rand();
    return {
      ht: Math.round(ht * 10) / 10,
      wt: Math.round(wt * 10) / 10,
      phys: RNG.clamp(RNG.gauss() * PHYS_SD, -2.6, 2.6),
      htType: r < 0.25 ? -1 : (r < 0.75 ? 0 : 1),
      wtTrend: RNG.clamp(0.3 + RNG.gauss() * 0.8, -1.5, 1.8),
      wtResp: RNG.clamp(0.8 + RNG.gauss() * 0.5, -0.2, 1.4),
    };
  }

  /** 選手に身体をつけて、入部時の補正を能力に足す */
  function attach(p, parts) {
    p.ht = parts.ht; p.wt = parts.wt; p.phys = parts.phys;
    p.htType = parts.htType; p.wtTrend = parts.wtTrend; p.wtResp = parts.wtResp;
    p.zW0 = zW(p);
    p.bodyOff = {}; p.bodyAcc = {};
    applyChange(p);
    return p;
  }

  /** 身体の効きを、能力にそろえる。「新しい補正 − すでに足した補正」だけを足す
      （年度が替わっても同じ補正を二重に足さない）。端数は選手ごとに溜めておく */
  function applyChange(p) {
    if (!p.bodyOff) { p.bodyOff = {}; p.bodyAcc = {}; }
    STAT_KEYS.forEach((key) => {
      if (p[key] == null) return;
      const target = offset(p, key);
      const done = p.bodyOff[key] || 0;
      const d = target - done;
      p.bodyOff[key] = target;
      p.bodyAcc[key] = (p.bodyAcc[key] || 0) + d;
      const whole = Math.round(p.bodyAcc[key]);
      if (whole === 0) return;
      p.bodyAcc[key] -= whole;
      if (key === 'velo') p[key] = RNG.clamp(Math.round(p[key] + whole), 100, 168);
      else p[key] = RNG.stat(p[key] + whole);
    });
  }

  /** 古い保存データの選手に、身体を補う。能力は変えない
      （いまの能力にはすでに補正が入っていることにする）。 */
  function ensure(p) {
    if (!p || p.ht != null) return p;
    const parts = roll(p.kind, p.pos, p.grade);
    p.ht = parts.ht; p.wt = parts.wt; p.phys = parts.phys;
    p.htType = parts.htType; p.wtTrend = parts.wtTrend; p.wtResp = parts.wtResp;
    p.zW0 = zW(p);
    p.bodyOff = {}; p.bodyAcc = {};
    STAT_KEYS.forEach((key) => { if (p[key] != null) p.bodyOff[key] = offset(p, key); });
    return p;
  }

  /* ---------- 年が替わる ---------- */

  /** 学年が1つ上がったあとに呼ぶ。身長・体重を更新し、変わったぶんの補正だけを足す */
  function yearUp(p) {
    ensure(p);
    const g0 = Math.max(1, (p.grade || 2) - 1);          // 上がる前の学年
    const factor = HT_TYPE_FACTOR[String(p.htType || 0)];
    const grow = Math.max(0, (HT_GROW[g0] != null ? HT_GROW[g0] : 0.3) * factor + RNG.norm(0, 0.45));
    const g1 = Math.min(3, p.grade || 2), gOld = Math.min(3, g0);
    const oldExp = BMI_REF[gOld] * Math.pow(p.ht / 100, 2);
    p.ht = Math.round((p.ht + grow) * 10) / 10;
    const newExp = BMI_REF[g1] * Math.pow(p.ht / 100, 2);
    /* 体重: 標準の体格の変化に、個人の増えやすさ（wtTrend）とばらつきを足す */
    const dw = (newExp - oldExp) * 0.9 + 1.2 * (p.wtTrend || 0) + RNG.norm(0, 1.3);
    p.wt = Math.round(RNG.clamp(p.wt + dw, 48, 125) * 10) / 10;
    applyChange(p);
    return p;
  }

  /** 体重を直接変える（テスト・将来の「増量」練習用） */
  function setWeight(p, kg) {
    ensure(p);
    p.wt = Math.round(RNG.clamp(kg, 40, 140) * 10) / 10;
    applyChange(p);
    return p;
  }

  /** 画面に出す文字（公開情報だけ） */
  function label(p) {
    if (!p || p.ht == null) return '';
    return '身長 ' + Math.round(p.ht) + 'cm　体重 ' + Math.round(p.wt) + 'kg';
  }

  return {
    STAT_KEYS, DIR_H, HT_SD, OFF_K, VELO_K, GM_K,
    roll, attach, applyChange, ensure, yearUp, setWeight, label,
    idxOf, idxHeight, idxPhys, offset, heightPhysOffset, weightOffset, gm, ceil,
    hz, pz, zW, bmiOf, refHt,
  };
})();
