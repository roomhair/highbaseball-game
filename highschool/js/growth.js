/* ==================================================
   高校野球  growth.js

   試合が終わったあとの成長と、まれに起きる「覚醒」。
   ・出た選手は、その試合でどれだけ活躍したかに応じて伸びる。
     ベンチの選手もわずかに伸びる（練習はしているので）。
   ・覚醒は一人につき高校3年間で一度だけ。何度も起きると
     「たまに起きるから嬉しい」が薄れてしまう。
   ・活躍した試合は文章にして残しておき、引退のときに上位3つを見せる。
   ================================================== */
'use strict';

const Growth = (() => {

  /** 打者のその試合の出来（0を平均、大きいほど良い） */
  function batPerf(s) {
    if (!s.pa) return 0;
    return s.h * 1.0 + s.d2 * 0.5 + s.d3 * 1.0 + s.hr * 2.0 +
           s.rbi * 0.5 + s.bb * 0.3 + s.sb * 0.4 - s.so * 0.15 - (s.ab - s.h) * 0.12;
  }

  /** 投手のその試合の出来 */
  function pitPerf(s) {
    if (!s.outs) return 0;
    const ip = s.outs / 3;
    return ip * 0.9 + s.so * 0.30 - s.er * 0.85 - s.bb * 0.15 - s.h * 0.08;
  }

  /* 学年が下のほうが伸びしろがある */
  const GRADE_GAIN = { 1: 1.25, 2: 1.08, 3: 0.92 };

  /** 能力は上に行くほど伸びにくい */
  function gainFor(value, points) {
    const head = RNG.clamp((100 - value) / 55, 0.15, 1);
    return Math.max(0, Math.round(points * head * RNG.clamp(RNG.norm(1, 0.35), 0.2, 1.9)));
  }

  function statListFor(p) {
    return p.kind === 'pitcher' ? PITCHER_STATS : BATTER_STATS;
  }

  /**
   * 試合後の成長。戻り値は画面に出すための一覧。
   * ctx = { year, tourLabel, roundName, oppName, win, walkoff, myRuns, oppRuns }
   */
  function afterGame(team, ctx) {
    const report = [];
    Team.all(team).forEach((p) => {
      const isPit = p.kind === 'pitcher';
      const s = p.game;
      const played = isPit ? s.outs > 0 : s.pa > 0;
      const perf = isPit ? pitPerf(s) : batPerf(s);

      /* 伸びしろの元。出た選手ほど、活躍した選手ほど多い */
      let points = played ? 1.0 + RNG.clamp(perf, -1.5, 8) * 0.22 : 0.35;
      points *= GRADE_GAIN[p.grade] || 1;
      points *= RNG.clamp(RNG.norm(1, 0.28), 0.3, 1.9);

      const ups = [];
      const stats = statListFor(p);
      const n = points > 2.2 ? 2 : 1;
      const picked = RNG.shuffle(stats.slice()).slice(0, n);
      picked.forEach((st) => {
        const add = gainFor(p[st.key], points * 1.15);
        if (add > 0) {
          p[st.key] = RNG.stat(p[st.key] + add);
          ups.push({ key: st.key, label: st.label, amount: add });
        }
      });
      /* 投手は球速も少しずつ上がる */
      if (isPit && played && RNG.chance(0.28)) {
        const add = RNG.range(1, 2);
        p.velo = Math.min(165, p.velo + add);
        ups.push({ key: 'velo', label: '球速', amount: add, unit: 'km/h' });
      }

      /* ---- 覚醒 ---- */
      let awakened = false;
      if (!p.awakened && played) {
        const chance = RNG.clamp(0.004 + Math.max(0, perf) * 0.004, 0.004, 0.035);
        if (RNG.chance(chance)) {
          awakened = true;
          p.awakened = true;
          const boostStats = RNG.shuffle(stats.slice()).slice(0, isPit ? 2 : 3);
          boostStats.forEach((st) => {
            const add = RNG.range(7, 15);
            p[st.key] = RNG.stat(p[st.key] + add);
            ups.push({ key: st.key, label: st.label, amount: add, awake: true });
          });
          if (isPit) {
            const add = RNG.range(3, 7);
            p.velo = Math.min(168, p.velo + add);
            ups.push({ key: 'velo', label: '球速', amount: add, unit: 'km/h', awake: true });
            /* 決め球が一段階よくなる */
            if (p.pitches.length) {
              p.pitches[0].level = Math.min(7, p.pitches[0].level + 1);
              ups.push({ key: 'pitch', label: p.pitches[0].name, amount: 1, awake: true });
            }
          } else if (p.traj < 4 && RNG.chance(0.45)) {
            p.traj++;
            ups.push({ key: 'traj', label: '弾道', amount: 1, awake: true });
          }
        }
      }

      if (ups.length || awakened) {
        report.push({ pid: p.id, name: p.name, grade: p.grade, kind: p.kind, played, awakened, ups: mergeUps(ups) });
      }

      /* ---- 名場面 ---- */
      const hl = highlightOf(p, ctx, perf);
      if (hl) {
        p.hl.push(hl);
        p.hl.sort((a, b) => b.score - a.score);
        if (p.hl.length > 12) p.hl.length = 12;
      }
    });

    /* 覚醒した選手を先に、そのあと伸びの大きい順 */
    report.sort((a, b) =>
      (b.awakened - a.awakened) ||
      (b.ups.reduce((s, u) => s + u.amount, 0) - a.ups.reduce((s, u) => s + u.amount, 0)));
    return report;
  }

  /** 同じ能力への上げ幅は1行にまとめる（通常の成長と覚醒が重なることがある） */
  function mergeUps(ups) {
    const out = [];
    ups.forEach((u) => {
      const hit = out.find((x) => x.label === u.label);
      if (hit) { hit.amount += u.amount; hit.awake = hit.awake || u.awake; }
      else out.push(Object.assign({}, u));
    });
    return out;
  }

  /** その試合が「名場面」に残るか */
  function highlightOf(p, ctx, perf) {
    const isPit = p.kind === 'pitcher';
    const s = p.game;
    if (isPit ? !s.outs : !s.pa) return null;

    let score = perf;
    if (ctx.win) score += 1.2;
    if (ctx.walkoff && !isPit) score += 1.5;
    /* 大きい舞台ほど値打ちがある */
    const stage = ctx.roundName === '決勝' ? 2.2 : (ctx.roundName === '準決勝' ? 1.4 : 0.6);
    score += stage * (ctx.tourLabel === 'national' ? 1.6 : 1);
    if (score < 2.2) return null;

    const where = (ctx.tourName || '') + ctx.roundName + '・' + ctx.oppName + '戦';
    let line;
    if (isPit) {
      const ip = Math.floor(s.outs / 3) + (s.outs % 3 ? 'と' + (s.outs % 3) + '/3' : '');
      line = ip + '回 ' + s.h + '安打 ' + s.er + '失点 ' + s.so + '奪三振';
      if (s.sho) line += '（完封）';
      else if (s.cg) line += '（完投）';
    } else {
      line = s.ab + '打数' + s.h + '安打' + (s.hr ? ' ' + s.hr + '本塁打' : '') +
             (s.rbi ? ' ' + s.rbi + '打点' : '');
      if (ctx.walkoff) line += '（サヨナラ）';
    }
    return { score: Math.round(score * 10) / 10, year: ctx.year, where, line, win: !!ctx.win };
  }

  /** 試合の成績を、大会と通算に足しこむ */
  function commitStats(team) {
    Team.all(team).forEach((p) => {
      const played = p.kind === 'pitcher' ? (p.game.outs > 0 || p.game.g > 0) : p.game.pa > 0;
      if (played) { p.game.g = 1; } else { p.game.g = 0; }
      Player.addStats(p.tour, p.game);
      Player.addStats(p.career, p.game);
    });
  }

  /** 大会が始まるときに、大会成績をまっさらにする */
  function resetTour(team) {
    Team.all(team).forEach((p) => {
      p.tour = p.kind === 'pitcher' ? Player.emptyPit() : Player.emptyBat();
    });
  }

  /** オフシーズンの練習試合ぶん（通算成績にだけ積む） */
  function offseasonPractice(team) {
    Team.all(team).forEach((p) => {
      const games = RNG.range(8, 18);
      if (p.kind === 'pitcher') Player.addStats(p.career, Player.seedPracticePit(p, games));
      else Player.addStats(p.career, Player.seedPracticeBat(p, games));
    });
  }

  return { afterGame, commitStats, resetTour, offseasonPractice, batPerf, pitPerf };
})();
