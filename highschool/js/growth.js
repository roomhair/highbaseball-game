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
  const GRADE_GAIN = { 1: 1.30, 2: 1.10, 3: 0.95 };

  /**
   * 能力は上に行くほど伸びにくい。
   * 1試合の伸びを大きくすると、頭打ちが無い限り大会の途中で全員Sになってしまう。
   *
   * ただし「残りに比例」にはしていない。それだと弱い選手ほど速く伸びるので、
   * 特訓で積み上げた差が大会の途中で勝手に埋まってしまい、
   * 上手に遊んでも勝率に出なくなる。
   * 65あたりまでは満額で伸ばし、そこから上だけを急に鈍らせている。
   */
  function headroom(value) {
    const G = CONFIG.GROWTH;
    const left = RNG.clamp(Math.max(0, 100 - value) / G.HEAD_SPAN, 0, 1);
    return RNG.clamp(Math.pow(left, G.HEAD_CURVE), 0.04, 1);
  }

  function gainFor(value, points) {
    return Math.max(0, Math.round(
      points * headroom(value) * RNG.clamp(RNG.norm(1, 0.35), 0.2, 1.9)));
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
      const G = CONFIG.GROWTH;
      let points = played ? G.BASE + RNG.clamp(perf, -1.5, 8) * G.PERF : G.BENCH;
      points *= GRADE_GAIN[p.grade] || 1;
      points *= RNG.clamp(RNG.norm(1, 0.28), 0.3, 1.9);

      const ups = [];
      const stats = statListFor(p);
      /* その試合の伸びしろの合計を出し、持っている能力ぜんぶに配る。
         1つに固めると +40 も跳ねて何が伸びたのか分からなくなるので、
         配る先を広くして、1つあたりは MAX_STEP で頭を押さえてある。
         出番が無かった選手は、そのうち2つだけ。 */
      const budget = points * (isPit ? G.PER_GAME_PIT : G.PER_GAME_BAT);
      const picked = RNG.shuffle(stats.slice()).slice(0, played ? stats.length : 2);
      /* 配る比率もばらけさせる。毎回きれいに等分だと機械的に見える */
      const w = picked.map(() => 0.45 + Math.random());
      const wsum = w.reduce((a, b) => a + b, 0) || 1;
      picked.forEach((st, i) => {
        const before = p[st.key];
        const add = Math.min(G.MAX_STEP, gainFor(before, budget * w[i] / wsum));
        if (add > 0) {
          p[st.key] = RNG.stat(before + add);
          if (p[st.key] > before) {
            ups.push({ key: st.key, label: st.label, amount: p[st.key] - before, before, after: p[st.key] });
          }
        }
      });
      /* 守備についた選手は、その場所の適性が上がることがある。
         下手なうちほど上がりやすく（G 30%）、上手くなるほど鈍る（B 5%）。
         守った場所だけが上がる（右翼を守って捕手が上手くなる道理はない） */
      if (!isPit && played) {
        const slot = (team.lineup || []).find((sl) => sl.pid === p.id);
        const up = slot ? Player.tryAptUp(p, slot.pos) : null;
        if (up) {
          ups.push({ key: 'apt', label: posName(slot.pos) + '適性', pos: slot.pos,
                     amount: 1, before: up.before, after: up.after, apt: true });
        }
      }

      /* 投手は球速も少しずつ上がる */
      if (isPit && played && RNG.chance(CONFIG.GROWTH.VELO_CHANCE)) {
        const before = p.velo;
        p.velo = Math.min(165, before + RNG.range(1, 2));
        if (p.velo > before) {
          ups.push({ key: 'velo', label: '球速', amount: p.velo - before, before, after: p.velo, unit: 'km/h' });
        }
      }

      /* ---- 覚醒 ---- */
      let awakened = false;
      if (!p.awakened && played) {
        const chance = RNG.clamp(0.004 + Math.max(0, perf) * 0.004, 0.004, 0.035);
        if (RNG.chance(chance)) {
          awakened = true;
          p.awakened = true;
          /* 覚醒も、少数の能力に固めず持っている能力ぜんぶに配る。
             合計は変えていないが、1つが +15 跳ねることは無くなる。
             通常の成長と同じ能力に乗ることがあるので（mergeUps でまとまる）、
             ここを絞らないと合わせて +24 になってしまっていた */
          const per = isPit ? [4, 9] : [3, 8];
          stats.forEach((st) => {
            const before = p[st.key];
            p[st.key] = RNG.stat(before + RNG.range(per[0], per[1]));
            ups.push({ key: st.key, label: st.label, amount: p[st.key] - before, before, after: p[st.key], awake: true });
          });
          if (isPit) {
            const vb = p.velo;
            p.velo = Math.min(168, vb + RNG.range(3, 7));
            ups.push({ key: 'velo', label: '球速', amount: p.velo - vb, before: vb, after: p.velo, unit: 'km/h', awake: true });
            /* 決め球が一段階よくなる */
            if (p.pitches.length) {
              const lb = p.pitches[0].level;
              p.pitches[0].level = Math.min(7, lb + 1);
              ups.push({ key: 'pitch', label: p.pitches[0].name, amount: p.pitches[0].level - lb,
                         before: lb, after: p.pitches[0].level, awake: true });
            }
          } else if (p.traj < 4 && RNG.chance(0.18)) {
            const tb = p.traj;
            p.traj++;
            ups.push({ key: 'traj', label: '弾道', amount: 1, before: tb, after: p.traj, awake: true });
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
      if (hit) {
        hit.amount += u.amount;
        hit.after = u.after;                 // 最後に落ち着いた値を残す
        hit.awake = hit.awake || u.awake;
      }
      else out.push(Object.assign({}, u));
    });
    return out.sort((a, b) => upRank(a) - upRank(b));
  }

  /* 画面に出すときの並び。毎回ばらばらだと、どこが伸びたのか探すことになる。
     選手の詳細や特訓の画面と同じ並びにしてある。
     ここに無いもの（守備適性・変化球など）は後ろにまとめる */
  const UP_ORDER = ['traj', 'meet', 'power', 'speed', 'arm', 'field', 'catch',
                    'velo', 'control', 'stamina'];

  function upRank(u) {
    const i = UP_ORDER.indexOf(u.key);
    return i < 0 ? UP_ORDER.length : i;
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

  /** オフシーズンの練習試合ぶん（通算成績にだけ積む）。
     相手は地方大会に出てくるくらいの高校を想定する。ここを自軍の強さに
     合わせてしまうと、強くなっても通算成績が伸びなくなってしまう */
  function offseasonPractice(team) {
    /* 大会の真ん中あたり（1回戦から3試合ぶん上がったところ）を相手にする */
    const peer = Math.round(CONFIG.FIELD.local.from + Tournament.stepMean('local') * 3);
    Team.all(team).forEach((p) => {
      const games = RNG.range(8, 18);
      if (p.kind === 'pitcher') Player.addStats(p.career, Player.seedPracticePit(p, games, peer));
      else Player.addStats(p.career, Player.seedPracticeBat(p, games, peer));
    });
  }

  return { afterGame, commitStats, resetTour, offseasonPractice, batPerf, pitPerf };
})();
