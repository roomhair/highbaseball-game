/* ==================================================
   高校野球  rng.js
   乱数まわりの小さな道具。能力値は「平均のまわりにばらける」形で
   作りたいので、一様乱数ではなく正規分布まがいの値を使う。
   ================================================== */
'use strict';

const RNG = {
  /** 0以上max未満の整数 */
  int(max) { return Math.floor(Math.random() * max); },

  /** min〜max（両端を含む）の整数 */
  range(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); },

  /** 配列から1つ */
  pick(list) { return list[Math.floor(Math.random() * list.length)]; },

  /** 確率 p で true */
  chance(p) { return Math.random() < p; },

  /** 平均0・標準偏差1のだいたい正規分布（一様乱数を足して作る簡便法） */
  gauss() {
    let s = 0;
    for (let i = 0; i < 4; i++) s += Math.random();
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
    let r = Math.random() * total;
    for (const it of list) { r -= it.weight; if (r <= 0) return it; }
    return list[list.length - 1];
  },

  /** 配列をその場でシャッフル */
  shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  },
};
