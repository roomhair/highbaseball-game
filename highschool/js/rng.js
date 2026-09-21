/* ==================================================
   高校野球  rng.js
   乱数まわりの小さな道具。能力値は「平均のまわりにばらける」形で
   作りたいので、一様乱数ではなく正規分布まがいの値を使う。
   ================================================== */
'use strict';

/* 種を与えているあいだは、同じ種から必ず同じ並びの乱数が出る。
   試合の途中でブラウザを閉じても、開き直したときに同じ試合を
   そのまま続けられるようにするために使う（mulberry32）。
   種を与えていないふだんは Math.random のまま。 */
let _seed = null;

function _rand() {
  if (_seed === null) return Math.random();
  _seed = (_seed + 0x6D2B79F5) >>> 0;
  let t = _seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const RNG = {
  /** 乱数の出どころはここ1つ。種を与えるとここが切り替わる */
  rand() { return _rand(); },
  /** 種を与える（試合のあいだだけ） */
  seed(n) { _seed = n >>> 0; },
  /** 種を外してふだんの乱数に戻す */
  unseed() { _seed = null; },
  /** 種を使っているか */
  seeded() { return _seed !== null; },
  /** 新しい種を1つ作る */
  newSeed() { return Math.floor(Math.random() * 4294967296) >>> 0; },

  /** 0以上max未満の整数 */
  int(max) { return Math.floor(_rand() * max); },

  /** min〜max（両端を含む）の整数 */
  range(min, max) { return min + Math.floor(_rand() * (max - min + 1)); },

  /** 配列から1つ */
  pick(list) { return list[Math.floor(_rand() * list.length)]; },

  /** 確率 p で true */
  chance(p) { return _rand() < p; },

  /** 平均0・標準偏差1のだいたい正規分布（一様乱数を足して作る簡便法） */
  gauss() {
    let s = 0;
    for (let i = 0; i < 4; i++) s += _rand();
    return (s - 2) * 1.732;   // 分散をおおよそ1にそろえる
  },

  /** 平均mu・標準偏差sigma */
  norm(mu, sigma) { return mu + this.gauss() * sigma; },

  /** 1〜100に収めて整数化（能力値はこの範囲しか取らない） */
  stat(v) { return Math.max(1, Math.min(100, Math.round(v))); },

  clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); },

  /** 重み付きで1つ選ぶ。list は {weight} を持つ配列 */
  weighted(list) {
    let total = 0;
    for (const it of list) total += it.weight;
    let r = _rand() * total;
    for (const it of list) { r -= it.weight; if (r <= 0) return it; }
    return list[list.length - 1];
  },

  /** 配列をその場でシャッフル */
  shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(_rand() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  },
};
