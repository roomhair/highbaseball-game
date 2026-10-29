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

  /* このゲームの平均の身長・体重は、日本の高校男子の平均のおよそ1.02倍。
     日本の平均（学年ごと。文部科学省の学校保健統計のおよその値）に SCALE をかけた
     ものを、学年ごとの基準にしている。基準のほかの値（ばらつき・伸び・体重の増減）も
     同じ倍率にそろえてあるので、能力への効き方（標準化した値）は倍率に左右されない */
  const SCALE = 1.02;
  const JP_HT = { 1: 168.0, 2: 169.8, 3: 170.6, 4: 170.9 };    // 日本の高校男子の平均身長（cm）
  const JP_WT = { 1: 60.0, 2: 62.5, 3: 63.5, 4: 64.0 };         // 同・平均体重（kg）
  /* これまでの版の基準（保存データの選手を、いまの基準へ移すときだけ使う）。
       版1 … 日本の平均の倍率をかける前（身長169.8cmなどの固定の表）
       版2 … 日本の平均の1.1倍 */
  const OLD_REFS = {
    1: {
      scale: 1,
      ht: {
        batter:  { 1: 169.8, 2: 172.4, 3: 173.7, 4: 174.1 },
        pitcher: { 1: 171.8, 2: 174.4, 3: 175.7, 4: 176.1 },
      },
      bmi: { 1: 21.2, 2: 21.8, 3: 22.3, 4: 22.5 },
      htSd: 5.5, bmiSd: 2.1,
    },
    5: {
      scale: 1.02,
      ht: { batter: {}, pitcher: {} }, bmi: {}, htSd: 8.0, bmiSd: 2.1 / 1.02,
    },
    4: {
      scale: 1.02,
      ht: { batter: {}, pitcher: {} }, bmi: {}, htSd: 6.7, bmiSd: 2.1 / 1.02,
    },
    3: {
      scale: 1.02,
      ht: { batter: {}, pitcher: {} }, bmi: {}, htSd: 5.5 * 1.02, bmiSd: 2.1 / 1.02,
    },
    2: {
      scale: 1.1,
      ht: { batter: {}, pitcher: {} }, bmi: {}, htSd: 5.5 * 1.1, bmiSd: 2.1 / 1.1,
    },
  };
  [2, 3, 4, 5].forEach((v) => {
    const sc = OLD_REFS[v].scale;
    [1, 2, 3, 4].forEach((g) => {
      OLD_REFS[v].ht.batter[g] = JP_HT[g] * sc;
      OLD_REFS[v].ht.pitcher[g] = JP_HT[g] * sc + 2.0 * sc;
      OLD_REFS[v].bmi[g] = JP_WT[g] * sc / Math.pow(JP_HT[g] * sc / 100, 2);
    });
  });
  const HT_MIN = 155;           // 身長の下限（cm）。上限は設けない
  const BODY_VER = 6;           // 体格の基準の版（日本の平均の倍率を変えたら上げる）。これより前の選手は ensure で直す
  const HT_SD = 6.9;            // 身長の標準偏差の目安（cm）。能力への効きを標準化するときの単位
  /* 選手を作るときの身長のばらつき（cm）。高い側と低い側で幅を変えてある。
     高い側をやや広くして（190cm以上が170人に1人ほど出る）、
     低い側は狭くして（下限155cmに貼りつく選手が増えすぎないようにする）。
     平均は変えないよう、山の位置を HT_SHIFT だけ下げてある */
  const HT_UP_SD = 6.6, HT_DOWN_SD = 4.8;
  const HT_SHIFT = 0.3989 * (HT_UP_SD - HT_DOWN_SD);     // 高い側と低い側を半々で引くときの、平均のずれ
  const PHYS_SD = 1.0;          // 身体能力の標準偏差
  const OFF_K = 3.2;            // idx 1 あたりに足す能力値（1〜100の能力）
  const VELO_K = 2.0;           // idx 1 あたりに足す球速（km/h）
  const GM_K = 0.10;            // idx 1 あたりの伸びやすさの変化
  const CEIL_BASE = 98, CEIL_K = 3.5, CEIL_MIN = 80;
  const OFF_CAP = 12, VELO_CAP = 7;    // 補正の合計の上限

  /* 同じ学年・同じ区分の平均身長（cm）。投手はやや高い */
  const refOf = (extra) => { const o = {}; [1, 2, 3, 4].forEach((g) => { o[g] = JP_HT[g] * SCALE + extra; }); return o; };
  const HT_REF = {
    batter:  refOf(0),
    pitcher: refOf(2.0 * SCALE),
  };
  /* 標準的な体格（BMI）。学年が上がると少し増える */
  const BMI_REF = {};
  [1, 2, 3, 4].forEach((g) => { BMI_REF[g] = JP_WT[g] * SCALE / Math.pow(JP_HT[g] * SCALE / 100, 2); });
  const BMI_SD = 2.1 / SCALE;
  /* 守る場所による体格の違い（BMI）。生成のときだけ使う */
  const POS_BMI = { C: 1.0, '1B': 1.2, DH: 0.8, '3B': 0.4, SS: -0.5, '2B': -0.4, CF: -0.6, LF: 0.1, RF: 0.3, P: 0.2 };
  const POS_HT = { C: 0.5, '1B': 2.0, DH: 1.0, '3B': 0.8, SS: -1.5, '2B': -1.5, CF: -0.5, LF: 0.4, RF: 0.8, P: 0 };
  const posHt = (k) => (POS_HT[k] || 0) * SCALE;
  const posBmi = (k) => (POS_BMI[k] || 0) / SCALE;

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
  const HT_GROW = { 1: 2.6 * SCALE, 2: 1.3 * SCALE, 3: 0.4 * SCALE };
  const HT_TYPE_FACTOR = { '-1': 0.5, '0': 1.0, '1': 1.6 };

  const STAT_KEYS = ['meet', 'power', 'speed', 'arm', 'field', 'catch', 'control', 'stamina', 'velo'];

  /* ---------- 天才 ----------
     ごく稀に、1つの能力（または部屋さんのように「すべて」）に天才的な才能を持つ選手がいる。
     p.genius に、能力の key か 'all' が入る。天才の能力は、
       ・上限が100ではなくなる（101以上はSS。上限なく伸ばせる）
       ・伸びやすい（gm が大きい）
     ことが普通の選手と違う。 */
  const GENIUS_LABEL = {
    meet: 'ミート', power: 'パワー', speed: '走力', arm: '肩力', field: '守備', catch: '捕球',
    control: '制球', stamina: 'スタミナ', velo: '球速', all: 'すべて',
  };
  const GENIUS_GM = 1.45;
  const HARD_MAX = 999, VELO_GENIUS_MAX = 178;

  function isGenius(p, key) {
    if (!p || !p.genius) return false;
    return p.genius === 'all' ? key !== 'traj' && key !== 'pitch' : p.genius === key;
  }
  function geniusLabel(p) { return p && p.genius ? (GENIUS_LABEL[p.genius] || '') : ''; }

  /** 能力 key の値を、その選手の上限に収めて整数にする（天才の能力は100を超えられる） */
  function stat(p, key, v) {
    if (key === 'velo') return RNG.clamp(Math.round(v), 100, isGenius(p, 'velo') ? VELO_GENIUS_MAX : 168);
    return Math.max(1, Math.min(isGenius(p, key) ? HARD_MAX : 100, Math.round(v)));
  }

  /* ---------- 基本 ---------- */

  function kindOf(p) { return p.kind === 'pitcher' ? 'pitcher' : 'batter'; }

  /* ---------- 時計（月） ----------
     ゲームの中の「いま」を、年×12+(月−1) の通し番号で持つ。
     4月に学年が替わる。ゲームは1年目の4月（2026年）から始まる。
     main.js が大会や新年度のたびに進め、選手は自分の bodyT（最後に
     身体を更新した月）から、その月まで1か月ずつ追いつく。 */
  const START_YEAR = 2026;               // ゲーム1年目の年（プロ1年目はその翌年の2027年）
  const APRIL = 3;                       // 4月の (月−1)
  let NOW = START_YEAR * 12 + APRIL;
  function monthIdx(year, month) { return year * 12 + (month - 1); }
  function setNow(m) { if (typeof m === 'number' && isFinite(m)) NOW = m; }
  function now() { return NOW; }
  function monthOf(idx) { return idx % 12 + 1; }
  function yearOf(idx) { return Math.floor(idx / 12); }
  /** 4月を0とした、その年度の何か月目か（0〜11） */
  function monthsFromApril(idx) { return ((idx % 12) - APRIL + 12) % 12; }
  /** 学年と月から、基準表の上での位置（0＝1年の4月、3＝3年の翌4月） */
  function posOf(grade, idx) {
    return Math.min(3, Math.max(0, (Math.min(3, Math.max(1, grade || 1)) - 1) + monthsFromApril(idx) / 12));
  }
  function interp(table, pos) {
    const lo = Math.min(3, Math.floor(pos)), f = pos - lo;
    return table[lo + 1] + (table[Math.min(4, lo + 2)] - table[lo + 1]) * f;
  }
  function refHtAt(kind, grade, idx) { return interp(HT_REF[kind === 'pitcher' ? 'pitcher' : 'batter'], posOf(grade, idx)); }
  function bmiRefAt(grade, idx) { return interp(BMI_REF, posOf(grade, idx)); }
  function tOf(p) { return p.bodyT == null ? NOW : p.bodyT; }
  function refHt(p) { return refHtAt(kindOf(p), p.grade, tOf(p)); }
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
  function zW(p) { return (bmiOf(p) - bmiRefAt(p.grade, tOf(p))) / BMI_SD; }

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
    return clampAbs(heightPhysOffset(p, key) + weightOffset(p, key), cap) + ((p.tilt && p.tilt[key]) || 0);
  }

  /** 伸びやすさ（倍率）。身長と身体能力が同じ係数で効く */
  function gm(p, key) {
    let g = 1 + GM_K * idxOf(p, key);
    /* 太りすぎた野手は、パワーの伸びしろが小さい */
    if (key === 'power' && p.kind !== 'pitcher') g *= 1 - 0.2 * Math.max(0, zW(p) - 1.2);
    if (isGenius(p, key)) g *= GENIUS_GM;
    return Math.max(0.6, Math.min(isGenius(p, key) ? 2.2 : 1.5, g));
  }

  /** 能力の上限（0〜100の目盛り。球速は 108〜160km/h を0〜100に直した値） */
  function ceil(p, key) {
    /* 天才の能力は上限なし。いまの値の少し上を、いつも伸びしろとして見せる */
    if (isGenius(p, key)) return key === 'velo' ? 140 : Math.max(135, (p[key] || 0) + 25);
    return Math.max(CEIL_MIN, Math.min(100, CEIL_BASE + CEIL_K * idxOf(p, key)));
  }

  /* ---------- 生成 ---------- */

  /* 背の高い野手の、パワーとミートの偏り（入部時に一度だけ決まる確率表）。
     背が高い（hz が正）ほど、パワーが高め・ミートが低めに寄る。背が低いと逆。
     どちらか一方しか補正が掛からない選手や、ほとんど掛からない選手も出る。
       型            高い選手のとき              低い選手のとき
       偏る         パワー＋・ミート−           ミート＋・パワー−
       片側(強)     パワー＋のみ                ミート＋のみ
       片側(弱)     ミート−のみ                 パワー−のみ
       ほぼ無し     どちらもほぼ掛からない      同左
     確率は |hz| が大きいほど「偏る」が増え、「ほぼ無し」が減る。 */
  const TILT_TABLE = [
    /* |hz| の下限, [偏る, パワー側のみ, ミート側のみ, ほぼ無し] */
    { min: 0.4, p: [0.30, 0.17, 0.13, 0.40] },
    { min: 1.0, p: [0.42, 0.20, 0.14, 0.24] },
    { min: 1.8, p: [0.55, 0.20, 0.13, 0.12] },
  ];
  const TILT_PW = [0.6, 1.5];     // パワー側の大きさ（|hz| 1あたり）
  const TILT_MT = [1.2, 2.8];     // ミート側の大きさ（|hz| 1あたり）
  const TILT_CAP = 7;

  function rollTilt(kind, z) {
    if (kind === 'pitcher') return null;
    const a = Math.abs(z);
    let row = null;
    TILT_TABLE.forEach((r) => { if (a >= r.min) row = r; });
    if (!row) return null;
    const r = RNG.rand();
    let type = 3, acc = 0;
    for (let i = 0; i < 4; i++) { acc += row.p[i]; if (r < acc) { type = i; break; } }
    const pw = RNG.rand() * (TILT_PW[1] - TILT_PW[0]) + TILT_PW[0];
    const mt = RNG.rand() * (TILT_MT[1] - TILT_MT[0]) + TILT_MT[0];
    const sgn = z > 0 ? 1 : -1;       // 高い: パワー＋・ミート−、低い: パワー−・ミート＋
    const cap = (v) => Math.max(-TILT_CAP, Math.min(TILT_CAP, v));
    const out = { power: 0, meet: 0 };
    if (type === 0) { out.power = cap(sgn * a * pw); out.meet = cap(-sgn * a * mt); }
    else if (type === 1) out.power = cap(sgn * a * pw);
    else if (type === 2) out.meet = cap(-sgn * a * mt);
    return out;
  }

  /** 新しい選手の身体（身長・体重・身体能力・個人差）を引く */
  function roll(kind, pos, grade) {
    const g = Math.min(3, Math.max(1, grade || 1));
    const kk = kind === 'pitcher' ? 'pitcher' : 'batter';
    const posKey = kk === 'pitcher' ? 'P' : (pos || 'LF');
    const refH = refHtAt(kk, g, NOW), refB = bmiRefAt(g, NOW);
    /* 身長は、端が切れない正規分布から引く。上限は設けない（2mを超える選手も、
       きわめて小さい確率で出うる）。下限だけ155cm */
    const zt = Math.sqrt(-2 * Math.log(1 - RNG.rand())) * Math.cos(2 * Math.PI * RNG.rand());
    const ht = Math.max(HT_MIN, refH + posHt(posKey) - HT_SHIFT + zt * (zt > 0 ? HT_UP_SD : HT_DOWN_SD));
    const bmi = refB + posBmi(posKey) + RNG.norm(0, 2.0 / SCALE);
    const wt = bmi * Math.pow(ht / 100, 2);
    const r = RNG.rand();
    return {
      ht: Math.round(ht * 10) / 10,
      wt: Math.round(wt * 10) / 10,
      phys: RNG.clamp(RNG.gauss() * PHYS_SD, -2.6, 2.6),
      htType: r < 0.25 ? -1 : (r < 0.75 ? 0 : 1),
      wtTrend: RNG.clamp(0.3 + RNG.gauss() * 0.8, -1.5, 1.8),
      wtResp: RNG.clamp(0.8 + RNG.gauss() * 0.5, -0.2, 1.4),
      tilt: rollTilt(kk, (ht - refH) / HT_SD),
    };
  }

  function setParts(p, parts) {
    p.ht = parts.ht; p.wt = parts.wt; p.phys = parts.phys;
    p.htType = parts.htType; p.wtTrend = parts.wtTrend; p.wtResp = parts.wtResp;
    p.tilt = parts.tilt || null;
    p.bodyT = NOW; p.bodyLog = []; p.bodyV = BODY_VER;
    p.zW0 = zW(p);
  }

  /** 選手に身体をつけて、入部時の補正を能力に足す */
  function attach(p, parts) {
    setParts(p, parts);
    p.bodyOff = {}; p.bodyAcc = {};
    applyChange(p);
    return p;
  }

  /** 身体の効きを、能力にそろえる。「新しい補正 − すでに足した補正」だけを足す
      （同じ補正を二重に足さない）。端数は選手ごとに溜めておく。
      戻り値は、このとき実際に変わった能力 { key: 増減 } */
  function applyChange(p) {
    if (!p.bodyOff) { p.bodyOff = {}; p.bodyAcc = {}; }
    const changed = {};
    if (p.fixedBody) return changed;           // 体格が変わらない選手（熊）は、体格による補正を受けない
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
      const before = p[key];
      p[key] = stat(p, key, p[key] + whole);
      if (p[key] !== before) changed[key] = p[key] - before;
    });
    return changed;
  }

  /** 古い保存データの選手に、身体を補う。能力は変えない
      （いまの能力にはすでに補正が入っていることにする）。 */
  function ensure(p) {
    if (!p) return p;
    /* 古い基準の選手は、基準との差（標準化した値）をそのまま新しい基準に移して、
       身長・体重を直す。能力は動かさない */
    if (p.ht != null && p.bodyV !== BODY_VER) {
      if (!p.fixedBody) {
        const old = OLD_REFS[p.bodyV || 1] || OLD_REFS[1];
        const k = SCALE / old.scale;
        const pos = posOf(p.grade, tOf(p));
        const kind = kindOf(p);
        const z = (p.ht - interp(old.ht[kind], pos)) / old.htSd;
        const bmiOld = p.wt / Math.pow(p.ht / 100, 2);
        const zb = (bmiOld - interp(old.bmi, pos)) / old.bmiSd;
        const ht0 = p.ht, wt0 = p.wt;
        p.ht = Math.round((interp(HT_REF[kind], pos) + z * HT_SD) * 10) / 10;
        p.wt = Math.round((interp(BMI_REF, pos) + zb * BMI_SD) * Math.pow(p.ht / 100, 2) * 10) / 10;
        if (p.initial && p.initial.ht != null) {
          p.initial.ht = Math.round((p.ht - (ht0 - p.initial.ht) * k) * 10) / 10;
          p.initial.wt = Math.round((p.wt - (wt0 - p.initial.wt) * k) * 10) / 10;
        }
        (p.bodyLog || []).forEach((e) => { e.dh = Math.round(e.dh * k * 10) / 10; e.dw = Math.round(e.dw * k * 10) / 10; });
        p.zW0 = zW(p);
      }
      p.bodyV = BODY_VER;
    }
    if (p.fixedBody && p.bodyT == null) p.bodyT = NOW;
    if (p.ht == null) {
      setParts(p, roll(p.kind, p.pos, p.grade));
      p.bodyOff = {}; p.bodyAcc = {};
      STAT_KEYS.forEach((key) => { if (p[key] != null) p.bodyOff[key] = offset(p, key); });
    }
    if (p.bodyT == null) p.bodyT = NOW;
    if (!p.bodyLog) p.bodyLog = [];
    return p;
  }

  /* ---------- 月が進む ---------- */

  /* 体重の季節の動き（その月に入るときの増減の平均 kg）。
     冬（12〜3月）は体づくりの時期で増えやすく、個人差も大きい。夏（7・8月）は落ちやすい */
  const WT_SEASON = { 12: 0.30, 1: 0.30, 2: 0.30, 3: 0.25, 7: -0.35, 8: -0.35 };
  const WINTER = { 12: 1, 1: 1, 2: 1, 3: 1 };

  const r1 = (v) => Math.round(v * 10) / 10;

  /** 1か月進める（その月に入るときの変化）。4月に入るときは、学年が上がった
      あとで呼ぶ（その前の学年ぶんの伸びを数える）。履歴に1件残す */
  function stepMonth(p) {
    ensure(p);
    if (p.fixedBody) { p.bodyT += 1; return p; }
    const to = p.bodyT + 1, mo = monthOf(to);
    const g = Math.min(3, Math.max(1, p.grade || 1));
    const gEff = mo === 4 ? Math.max(1, g - 1) : g;
    const grow = Math.max(0, (HT_GROW[gEff] != null ? HT_GROW[gEff] : 0.3) * HT_TYPE_FACTOR[String(p.htType || 0)] / 12 + RNG.norm(0, 0.05));
    const htOld = p.ht, wtOld = p.wt;
    const h0 = htOld / 100;
    p.ht = htOld + grow;
    const h1 = p.ht / 100;
    /* 標準の体格の変化（学年が上がるぶん＋身長が伸びたぶん） */
    const posNew = posOf(g, to);
    const oldExp = interp(BMI_REF, Math.max(0, posNew - 1 / 12)) * h0 * h0;
    const expNow = interp(BMI_REF, posNew) * h1 * h1;
    const winter = WINTER[mo] ? 1 : 0;
    const dw = (expNow - oldExp) * 0.9 + SCALE * (0.10 * (p.wtTrend || 0) * (1 + winter * 1.5) +
      (WT_SEASON[mo] || 0) + RNG.norm(0, winter ? 0.75 : 0.35) * (1 + winter * 0.25 * Math.abs(p.wtTrend || 0)));
    p.wt = RNG.clamp(wtOld + dw, 48 * SCALE, 125 * SCALE);
    p.bodyT = to;
    const changed = applyChange(p);
    p.bodyLog.push({
      t: to,
      dh: r1(r1(p.ht) - r1(htOld)),
      dw: r1(r1(p.wt) - r1(wtOld)),
      s: changed,
    });
    return p;
  }

  /** 選手たちを、target の月まで1か月ずつ進める（すでに過ぎていれば何もしない） */
  function advanceTo(players, target) {
    players.forEach((p) => {
      if (!p) return;
      ensure(p);
      let guard = 0;
      while (p.bodyT < target && guard++ < 60) stepMonth(p);
    });
    if (target > NOW) NOW = target;
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
    roll, attach, applyChange, ensure, stepMonth, advanceTo, setWeight, label,
    setNow, now, monthIdx, monthOf, yearOf, START_YEAR, rollTilt,
    idxOf, idxHeight, idxPhys, offset, heightPhysOffset, weightOffset, gm, ceil,
    hz, pz, zW, bmiOf, refHt,
    isGenius, geniusLabel, stat, GENIUS_LABEL,
  };
})();
