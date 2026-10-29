/* ==================================================
   高校野球  pro.js

   プロ入りした選手の、プロでの成績（架空）。

   ・ドラフトで指名された時点で、引退までの全シーズンをまとめて作って
     おく（以後は変わらない）。見せるのは1年ずつ。引退した1年後の秋の
     大会が終わるたびに、1年目・2年目…と増やしていく。
   ・プロ1年目は、卒業した年の翌年。ゲーム1年目に卒業した選手なら2027年。
   ・成績は能力で決まる。基準は、近年のNPB（NPB公式の年度別成績・
     リーグ平均）の水準に合わせてある。
       打者 リーグ平均 打率.245前後 / OPS.690前後 / 本塁打は1打席あたり2%前後
            規定打席に乗る主力で 打率.260 OPS.730 / 本塁打 10〜15本
            優秀な打者 打率.300 OPS.900 / 本塁打 30本 / 打点 100
            タイトルの目安 本塁打王 30〜40本 打点王 90〜110 盗塁王 25〜45
                           首位打者 .310〜.340
       投手 リーグ平均 防御率3.3前後（近年は投高で3.0前後）
            先発の主力で 防御率3.5 / 150回 / 8〜10勝
            優秀な投手 防御率2.2 / 180回 / 14〜16勝 / 奪三振 180
            タイトルの目安 最多勝 13〜18 最優秀防御率 1.8〜2.5 最多奪三振 170〜220
   ・高卒でプロに入るので、1年目はほとんど出番がない（二軍で育成）。
     数年かけて伸び、20代半ばにピークを迎え、30代で落ちていく。
   ================================================== */
'use strict';

const Pro = (() => {

  const LG_OPS = 0.690, LG_ERA = 3.30;

  const sigmoid = (x) => 1 / (1 + Math.exp(-x));

  /** 試行 n 回・確率 p の成功回数（大きい n は正規近似） */
  function binom(n, p) {
    n = Math.max(0, Math.round(n));
    p = RNG.clamp(p, 0, 1);
    if (n === 0 || p === 0) return 0;
    if (n > 60) {
      const m = n * p, sd = Math.sqrt(n * p * (1 - p));
      return Math.max(0, Math.min(n, Math.round(m + RNG.gauss() * sd)));
    }
    let c = 0;
    for (let i = 0; i < n; i++) if (RNG.rand() < p) c++;
    return c;
  }

  const clampN = RNG.clamp;

  /* ---------- シーズンごとの力（s） ----------
     s は「プロの主力を0とした、その年の力」。ピーク時の力 sPeak に、
     年次の伸び・衰えをかけて決まる */
  function peakOf(p, round) {
    const q = clampN((Player.rating(p) - 52) / 30, 0, 1);
    const draftBonus = { 1: 0.35, 2: 0.2, 3: 0.1, 4: 0, 5: -0.1, 6: -0.25 }[round] || 0;
    return -2.0 + 1.9 * q + draftBonus + RNG.norm(0, 0.85);
  }

  /** k年目（1〜）の力。高卒なので最初は大きく下で、8年目ごろに頂点へ */
  function levelAt(sPeak, k, devRate) {
    const grow = 2.6 * Math.exp(-(k - 1) / (2.8 * devRate));
    const age = k >= 13 ? 0.14 * Math.pow(k - 12, 1.15) : 0;
    return sPeak - grow - age;
  }

  /** その年に一軍でどれだけ使われるか（0〜1）。けがで抜ける年もある */
  function usage(s) {
    const base = sigmoid((s + 0.85) * 1.7);
    const health = RNG.rand() < 0.12 ? RNG.range(30, 70) / 100 : clampN(RNG.norm(0.95, 0.07), 0.7, 1);
    return clampN(base * health, 0, 1);
  }

  /* ---------- 打者 ---------- */

  function batSeason(p, s, k) {
    const frac = usage(s);
    const g = Math.round(143 * frac);
    if (g < 1 || frac < 0.04) return { k, g: 0, pa: 0, ab: 0, h: 0, d2: 0, d3: 0, hr: 0, rbi: 0, bb: 0, hbp: 0, sf: 0, sb: 0, tb: 0, war: 0 };
    const pa = Math.max(1, Math.round(g * RNG.norm(3.55, 0.25) * (frac < 0.3 ? 0.55 : 1)));
    const cz = (p.meet - 60) / 15, pwz = (p.power - 60) / 15, spz = (p.speed - 55) / 15;
    const contact = s * 0.6 + cz * 0.3;
    const pow = s * 0.6 + pwz * 0.4;
    const spd = s * 0.3 + spz * 0.7;
    const sdScale = Math.sqrt(500 / Math.max(pa, 40));
    const avg = clampN(0.236 + 0.022 * contact + RNG.norm(0, 0.016) * Math.min(sdScale, 4), 0.1, 0.365);
    const hbp = binom(pa, 0.009);
    const sf = binom(pa, 0.007);
    const bbRate = clampN(0.082 + 0.013 * contact + 0.006 * pow, 0.03, 0.17);
    const bb = binom(pa, bbRate);
    const ab = Math.max(1, pa - bb - hbp - sf);
    const h = Math.min(ab, binom(ab, avg));
    const hrRate = clampN(0.019 * Math.exp(0.38 * pow), 0.002, 0.075);
    const hr = Math.min(h, binom(pa, hrRate));
    const rest = h - hr;
    const d2 = Math.min(rest, binom(rest, clampN(0.22 + 0.02 * spd + 0.015 * pow, 0.12, 0.34)));
    const d3 = Math.min(rest - d2, binom(rest, clampN(0.014 + 0.012 * spd, 0.002, 0.07)));
    const tb = h + d2 + 2 * d3 + 3 * hr;
    const rbi = Math.max(0, Math.round((hr * 1.45 + h * 0.2 + pa * 0.02) * RNG.norm(1, 0.07) * (0.9 + 0.1 * clampN(s + 1, 0, 2))));
    const sb = binom(pa, clampN(0.011 * Math.exp(0.6 * spd), 0, 0.085));
    const obp = (h + bb + hbp) / (ab + bb + hbp + sf);
    const ops = obp + tb / ab;
    const fieldZ = (p.field - 60) / 20;
    const batRuns = (ops - LG_OPS) * pa * 0.34;
    const war = (batRuns + 0.033 * pa + fieldZ * 6 * (pa / 600) + sb * 0.18) / 10;
    return { k, g, pa, ab, h, d2, d3, hr, rbi, bb, hbp, sf, sb, tb, war: Math.round(war * 10) / 10 };
  }

  /* ---------- 投手 ---------- */

  function pitSeason(p, s, k, role) {
    const frac = usage(s);
    const starter = role === 'SP';
    const gs = starter ? Math.round(26 * frac) : 0;
    const g = starter ? gs + (frac < 0.25 && gs < 3 ? RNG.range(0, 3) : 0) : Math.round(62 * frac);
    if (g < 1 || frac < 0.04) return { k, role, g: 0, outs: 0, w: 0, l: 0, so: 0, er: 0, war: 0 };
    const ipPer = starter ? clampN(5.3 + (p.stamina || 50) / 100 * 1.5 + RNG.norm(0, 0.35), 4.2, 7.6) : clampN(RNG.norm(1.0, 0.12), 0.7, 1.4);
    const ip = Math.max(0.3, (starter ? Math.max(gs, 1) : g) * ipPer);
    const outs = Math.round(ip * 3);
    const zv = (p.velo - 138) / 6, zc = (p.control - 55) / 15;
    const sP = s * 0.7 + 0.2 * (zv * 0.5 + zc * 0.5);
    const sd = 0.9 * Math.sqrt(60 / Math.max(ip, 15));
    const era = clampN(3.6 - 0.75 * sP + RNG.norm(0, sd) * Math.min(1.8, Math.sqrt(160 / Math.max(ip, 30)) * 0.6), 0.8, 12);
    const er = Math.round(era * ip / 9);
    const k9 = clampN(7.2 + 1.1 * zv + 0.7 * sP + RNG.norm(0, 0.6), 3.5, 13);
    const so = Math.round(ip * k9 / 9);
    let w, l;
    if (starter) {
      const dec = (gs || 1) * 0.72;
      const share = clampN(0.5 + 0.1 * sP + RNG.norm(0, 0.07), 0.15, 0.82);
      w = Math.round(dec * share); l = Math.round(dec * (1 - share));
    } else {
      w = Math.round(g * clampN(0.055 + 0.015 * sP, 0, 0.14)); l = Math.round(g * clampN(0.045 - 0.008 * sP, 0, 0.1));
    }
    const repl = starter ? 1.5 : 0.85;
    const war = ((LG_ERA - era) * ip / 9 + repl * ip / 9) / 10;
    return { k, role, g, outs, w, l, so, er, war: Math.round(war * 10) / 10 };
  }

  /* ---------- タイトルの目安（その年のリーグ最高の水準。毎年少しずつ違う） ---------- */

  function titleLines(isPit) {
    if (isPit) {
      return {
        w: Math.round(clampN(RNG.norm(14.5, 1.8), 11, 19)),
        era: Math.round(clampN(RNG.norm(2.15, 0.35), 1.3, 3.0) * 100) / 100,
        so: Math.round(clampN(RNG.norm(185, 22), 140, 250)),
      };
    }
    return {
      hr: Math.round(clampN(RNG.norm(33, 4.5), 24, 46)),
      rbi: Math.round(clampN(RNG.norm(98, 8), 78, 125)),
      sb: Math.round(clampN(RNG.norm(30, 8), 15, 55)),
      avg: Math.round(clampN(RNG.norm(0.318, 0.018), 0.28, 0.36) * 1000) / 1000,
    };
  }

  /* ---------- 全シーズン ---------- */

  /** 引退までの全シーズンを作る。first は1年目の西暦 */
  function generate(player, round, first) {
    const isPit = player.kind === 'pitcher';
    const sPeak = peakOf(player, round);
    const devRate = clampN(RNG.norm(1, 0.25), 0.55, 1.6);
    const role = isPit ? ((player.stamina || 0) >= 48 && RNG.chance(0.75) ? 'SP' : 'RP') : null;
    const seasons = [];
    let idle = 0;
    for (let k = 1; k <= 22; k++) {
      const s = levelAt(sPeak, k, devRate) + RNG.norm(0, 0.35);
      const row = isPit ? pitSeason(player, s, k, role) : batSeason(player, s, k);
      row.y = first + k - 1;
      row.lines = titleLines(isPit);
      seasons.push(row);
      /* 一軍に出られない年が続けば、戦力外になる */
      idle = row.g === 0 ? idle + 1 : 0;
      if (k >= 3 && idle >= 2 && RNG.chance(0.6)) break;
      if (k >= 4 && s < -1.6 && RNG.chance(0.35)) break;
      if (k >= 10 && s < -0.2 && RNG.chance(0.18 + 0.05 * (k - 10))) break;
      if (k >= 15 && RNG.chance(0.2 + 0.07 * (k - 15))) break;
    }
    /* 育成指名は、短く終わりやすい */
    if (round === 6 && seasons.length > 4 && RNG.chance(0.5)) seasons.length = RNG.range(2, 4);
    return { seasons, kind: isPit ? 'pitcher' : 'batter' };
  }

  /* ---------- 成績の読み取り ---------- */

  const f3 = (v) => (v < 1 ? ('.' + String(Math.round(v * 1000)).padStart(3, '0')) : v.toFixed(3));
  const era2 = (er, outs) => (outs ? (er * 27 / outs).toFixed(2) : '-');

  /** 1シーズンぶんの表示用の値と、タイトル級かどうか（太字） */
  function rowView(s, isPit) {
    const L = s.lines || {};
    if (!isPit) {
      const has = s.pa > 0;
      const avg = s.ab ? s.h / s.ab : 0;
      const obp = (s.ab + s.bb + s.hbp + s.sf) ? (s.h + s.bb + s.hbp) / (s.ab + s.bb + s.hbp + s.sf) : 0;
      const ops = s.ab ? obp + s.tb / s.ab : 0;
      const qual = s.pa >= 443;
      return {
        g: s.g, pa: s.pa,
        avg: has ? f3(avg) : '-', hr: s.hr, rbi: s.rbi, ops: has ? f3(ops) : '-', sb: s.sb, war: s.war.toFixed(1),
        bold: {
          avg: qual && L.avg != null && avg >= L.avg,
          hr: L.hr != null && s.hr >= L.hr,
          rbi: L.rbi != null && s.rbi >= L.rbi,
          sb: L.sb != null && s.sb >= L.sb,
        },
      };
    }
    const era = s.outs ? s.er * 27 / s.outs : null;
    return {
      g: s.g, ip: s.outs, w: s.w, l: s.l, era: era == null ? '-' : era.toFixed(2), so: s.so, war: s.war.toFixed(1),
      bold: {
        w: L.w != null && s.w >= L.w,
        era: era != null && s.outs >= 429 && L.era != null && era <= L.era,
        so: L.so != null && s.so >= L.so,
      },
    };
  }

  /** 通算（公開されているシーズンぶん） */
  function totalView(list, isPit) {
    const t = list.reduce((a, s) => {
      Object.keys(s).forEach((k) => { if (typeof s[k] === 'number' && k !== 'y' && k !== 'k') a[k] = (a[k] || 0) + s[k]; });
      return a;
    }, {});
    const war = (Math.round((t.war || 0) * 10) / 10).toFixed(1);
    if (!isPit) {
      const ab = t.ab || 0;
      const den = ab + (t.bb || 0) + (t.hbp || 0) + (t.sf || 0);
      const obp = den ? ((t.h || 0) + (t.bb || 0) + (t.hbp || 0)) / den : 0;
      return {
        g: t.g || 0, pa: t.pa || 0, avg: ab ? f3((t.h || 0) / ab) : '-', hr: t.hr || 0, rbi: t.rbi || 0,
        ops: ab ? f3(obp + (t.tb || 0) / ab) : '-', sb: t.sb || 0, war,
      };
    }
    return {
      g: t.g || 0, ip: t.outs || 0, w: t.w || 0, l: t.l || 0, era: era2(t.er || 0, t.outs || 0), so: t.so || 0, war,
    };
  }

  /* ---------- 毎年の公開 ---------- */

  /** 秋の大会がすべて終わったとき。gid のセーブの、プロ入りした選手の成績を1年ぶん増やす。
      gameYear はいまのゲームの年（1年目〜）。引退した翌年の秋から始まる。
      変わったら true */
  function revealAutumn(list, gid, gameYear) {
    let changed = false;
    list.forEach((x) => {
      if (!x.player) return;
      if (!x.pro) { x.pro = generate(x.player, x.round, Body.START_YEAR + x.year); changed = true; }
      if (x.shown == null) { x.shown = 0; changed = true; }
      if (x.gid == null) {
        /* 古い記録は、いまのセーブのものとして、経った年ぶんをいっぺんに公開する */
        x.gid = gid; x.lastReveal = gameYear;
        x.shown = clampN(gameYear - x.year, 0, x.pro.seasons.length);
        changed = true;
        return;
      }
      if (x.gid !== gid || x.lastReveal === gameYear || x.year >= gameYear) return;
      x.lastReveal = gameYear;
      if (x.shown < x.pro.seasons.length) { x.shown++; changed = true; }
    });
    return changed;
  }

  /** 記録に、プロの成績の元を持たせる（ドラフト指名の直後に呼ぶ） */
  function attach(rec) {
    if (!rec.pro) rec.pro = generate(rec.player, rec.round, Body.START_YEAR + rec.year);
    if (rec.shown == null) rec.shown = 0;
    return rec;
  }

  return { generate, rowView, totalView, revealAutumn, attach, titleLines, batSeason, pitSeason, peakOf, levelAt };
})();
