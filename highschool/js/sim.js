/* ==================================================
   高校野球  sim.js

   試合そのもの。1球ずつではなく1打席ずつ決める。
   ・試合の中身は先にぜんぶ計算してしまい、結果を log に並べる。
     画面はそれを順に見せているだけなので、スキップは
     「残りの log をまとめて流す」だけで済む。
   ・打球は「ゴロ／ライナー／フライ／小飛」と「引っ張り／センター／流し」の
     組み合わせで方向まで決める。そうしないと「遊ゴロ」「右安」のような
     スコアブックらしい表示が出せない。
   ================================================== */
'use strict';

const Sim = (() => {

  const C = RNG.clamp.bind(RNG);

  /* ---------- 能力を 0〜1 に直す ---------- */

  function veloScore(p) { return C((p.velo - 112) / 48, 0, 1); }

  /** 投手の球威（球速と変化球）。
     変化球だけで押し切れると高校野球らしくないので、球速のほうを重く見る */
  function stuffOf(p) { return C(veloScore(p) * 0.60 + Player.breakScore(p) * 0.40, 0, 1); }

  /** 守備陣のまとまり（0〜1）。安打になりにくさに効く */
  function defenseOf(team, pitcherId) {
    const d = Team.defenders(team, pitcherId);
    let sum = 0, n = 0;
    FIELD_POSITIONS.forEach((k) => {
      const p = d[k];
      if (p) { sum += Team.defScore(p, k); n++; }
    });
    return n ? C(sum / n / 100, 0, 1) : 0.4;
  }

  /* ---------- 打球の種類と方向 ---------- */

  /* 弾道ごとのゴロ／ライナー／フライ／小飛の割合 */
  const BALL_MIX = {
    1: [0.58, 0.21, 0.19, 0.02],
    2: [0.48, 0.21, 0.28, 0.03],
    3: [0.38, 0.21, 0.37, 0.04],
    4: [0.30, 0.20, 0.45, 0.05],
  };

  function battedType(traj) {
    const mix = BALL_MIX[traj] || BALL_MIX[2];
    let r = Math.random();
    if ((r -= mix[0]) < 0) return 'GB';
    if ((r -= mix[1]) < 0) return 'LD';
    if ((r -= mix[2]) < 0) return 'FB';
    return 'PU';
  }

  /** 引っ張り／センター返し／流し のどれかを返す */
  function sprayZone(pull) {
    const t = C(pull / 100, -1, 1);
    const w = [
      Math.max(0.04, 0.34 + 0.30 * t),          // 引っ張り
      Math.max(0.10, 0.33 - 0.05 * Math.abs(t)), // センター
      Math.max(0.04, 0.33 - 0.30 * t),          // 流し
    ];
    const total = w[0] + w[1] + w[2];
    let r = Math.random() * total;
    if ((r -= w[0]) < 0) return 'pull';
    if ((r -= w[1]) < 0) return 'center';
    return 'oppo';
  }

  /* 右打者を基準にした方向の割り当て。左打者は左右を入れ替える。
     同じ位置を何度も並べてあるのは、出やすさの重み付けのため。
     投手・捕手のゴロはあまり出ないので、1つずつしか入れていない。 */
  const INF_BY_ZONE = {
    pull:   ['3B', '3B', 'SS', 'SS', 'SS'],
    center: ['SS', '2B', 'SS', '2B', 'SS', '2B', 'SS', '2B', 'P', 'C'],
    oppo:   ['1B', '1B', '2B', '2B', '2B'],
  };
  const OF_BY_ZONE = { pull: 'LF', center: 'CF', oppo: 'RF' };

  function mirror(posKey) {
    return { '1B': '3B', '3B': '1B', SS: '2B', '2B': 'SS', LF: 'RF', RF: 'LF' }[posKey] || posKey;
  }

  function fieldSpot(zone, type, bats) {
    let key = (type === 'GB' || type === 'PU')
      ? RNG.pick(INF_BY_ZONE[zone])
      : OF_BY_ZONE[zone];
    /* ライナーは内野を抜けることも、正面を突くこともある */
    if (type === 'LD' && RNG.chance(0.35)) key = RNG.pick(INF_BY_ZONE[zone]);
    if (bats === 'L') key = mirror(key);
    return key;
  }

  /* ---------- 1打席 ---------- */

  /**
   * 打席の結果を決める。返り値は
   *   { code, text, bbType, spot, out(アウト数) }
   * code は 'K','BB','HBP','1B','2B','3B','HR','OUT','E'
   *
   * 投手を渡す resolvePA と、球威・制球の数字だけを渡す resolveVs に分けてある。
   * 練習試合ぶんの通算成績も resolveVs を通して作るので、
   * 「通算成績の割に打たない」ということが起きない。
   */
  function resolvePA(bat, pit, defTeam, defRating, fatigue, defenders, offForm, defForm) {
    const d = 1 - (defForm || 0) / 130;
    const stuff = C(stuffOf(pit) * (1 - 0.22 * fatigue) * d, 0, 1);
    const ctrl = C((pit.control / 100) * (1 - 0.28 * fatigue) * d, 0, 1);
    return resolveVs(bat, stuff, ctrl, defRating, defenders, offForm);
  }

  function resolveVs(bat, stuff, ctrl, defRating, defenders, form) {
    /* その日の調子。ふだんは小さいが、まれに「今日は打てる」日がある。
       これがあるおかげで、力の差がある相手にもたまに勝てる */
    const f = form || 0;
    const contact = C((bat.meet + f) / 100, 0.02, 1);
    const pw = C((bat.power + f) / 100, 0.02, 1);

    /* 三振・四球・死球 */
    const pK = C(0.150 + 0.36 * (stuff - contact), 0.02, 0.55);
    const pBB = C(0.082 + 0.17 * (0.5 - ctrl) - 0.03 * (contact - 0.5), 0.015, 0.32);
    const pHBP = C(0.010 + 0.02 * (0.5 - ctrl), 0.002, 0.045);

    let r = Math.random();
    if ((r -= pK) < 0) {
      return { code: 'K', text: RNG.chance(0.3) ? '見三振' : '空三振', out: 1 };
    }
    if ((r -= pBB) < 0) return { code: 'BB', text: '四球', out: 0 };
    if ((r -= pHBP) < 0) return { code: 'HBP', text: '死球', out: 0 };

    /* ここからインプレー */
    const type = battedType(bat.traj);
    const zone = sprayZone(bat.pull);
    const spot = fieldSpot(zone, type, bat.bats);
    const isOF = spot === 'LF' || spot === 'CF' || spot === 'RF';

    /* 本塁打。フライとライナーからしか出ない */
    if (type === 'FB' || type === 'LD') {
      const pHR = C(
        0.026 + 0.145 * (pw - 0.42) + 0.016 * (bat.traj - 2) +
        0.03 * (contact - 0.5) - 0.050 * (stuff - 0.45),
        0.0008, 0.20
      ) * (type === 'FB' ? 1.25 : 0.55);
      if (RNG.chance(pHR)) {
        const ofKey = bat.bats === 'L' ? mirror(OF_BY_ZONE[zone]) : OF_BY_ZONE[zone];
        return { code: 'HR', text: posShort(ofKey) + '本', out: 0, spot: ofKey };
      }
    }

    /* 失策。内野ゴロと、守りにくい打球で起きる。
       守る選手が分かっているときはその選手の守備、
       分からないとき（通算成績を作るとき）はチーム全体の守備で見る */
    if (type === 'GB' || (type === 'LD' && !isOF) || (type === 'FB' && isOF)) {
      const fielder = defenders ? defenders[spot] : null;
      const eff = fielder ? Team.defScore(fielder, spot) : defRating * 100;
      const base = type === 'GB' ? 0.045 : 0.018;
      const pE = C(base + (52 - eff) / 100 * 0.24, 0.004, 0.26);
      if (RNG.chance(pE)) {
        return { code: 'E', text: posShort(spot) + '失', out: 0, spot, by: fielder ? fielder.id : null };
      }
    }

    /* 安打になるか。打球の種類でまったく違う */
    const babip = C(
      0.300 + 0.30 * (contact - stuff) + 0.07 * (pw - 0.5) +
      0.05 * (bat.speed / 100 - 0.5) - 0.28 * (defRating - 0.45),
      0.09, 0.58
    );
    const byType = { GB: 0.235, LD: 0.660, FB: 0.215, PU: 0.020 }[type];
    const pHit = C(byType * (babip / 0.30), 0.01, 0.92);

    if (RNG.chance(pHit)) {
      /* 長打になるか。フライとライナーのほうが伸びる */
      let kind = '1B';
      const sp = bat.speed / 100;
      if (type === 'FB') {
        const q = Math.random();
        kind = q < 0.42 ? '2B' : (q < 0.42 + 0.02 + sp * 0.05 ? '3B' : '1B');
      } else if (type === 'LD') {
        const q = Math.random();
        kind = q < 0.22 ? '2B' : (q < 0.22 + 0.01 + sp * 0.025 ? '3B' : '1B');
      } else if (type === 'GB') {
        kind = RNG.chance(0.04 + sp * 0.03) ? '2B' : '1B';
      }
      /* 長打の方向は外野で言う */
      const ofKey = bat.bats === 'L' ? mirror(OF_BY_ZONE[zone]) : OF_BY_ZONE[zone];
      const mark = kind === '1B' ? '安' : (kind === '2B' ? '二' : '三');
      const where = kind === '1B' ? spot : ofKey;
      return { code: kind, text: posShort(where) + mark, out: 0, spot: where };
    }

    /* アウト。どういうアウトだったかを文字にする */
    const mark = type === 'GB' ? 'ゴロ' : (type === 'LD' ? '直' : '飛');
    return { code: 'OUT', text: posShort(spot) + mark, out: 1, spot, bbType: type, isOF };
  }

  /* ---------- 試合を組み立てる ---------- */

  /** その試合のチームの調子。20回に1回ほど、大きく振れる日がある */
  function rollForm() {
    return RNG.chance(0.05) ? RNG.norm(0, 11) : RNG.norm(0, 3.5);
  }

  function sideState(team, isHome) {
    Team.repair(team);
    const rot = team.rotation.slice();
    return {
      team, isHome,
      form: rollForm(),
      order: 0,
      runs: 0, hits: 0, errors: 0, lob: 0,
      byInning: [],
      pitcherId: rot[0],
      penId: rot.slice(1),
      usedPitchers: [rot[0]],
      bf: 0,           // いまの投手が受けた打者数
      pitcherRuns: 0,  // いまの投手が許した点
    };
  }

  function resetGameStats(team) {
    Team.all(team).forEach((p) => {
      p.game = p.kind === 'pitcher' ? Player.emptyPit() : Player.emptyBat();
      if (p.kind === 'pitcher') p.batGame = Player.emptyBat();
      p.gameHl = [];
    });
  }

  function capacityOf(p) { return 14 + p.stamina * 0.55; }

  /**
   * 試合を最後まで計算する。
   * @param {object} away 先攻チーム
   * @param {object} home 後攻チーム
   */
  function play(away, home) {
    resetGameStats(away); resetGameStats(home);

    const A = sideState(away, false);
    const H = sideState(home, true);
    const log = [];

    const startA = Team.find(away, A.pitcherId), startH = Team.find(home, H.pitcherId);
    if (startA) { startA.game.gs = 1; startA.game.g = 1; }
    if (startH) { startH.game.gs = 1; startH.game.g = 1; }

    let inning = 1, over = false, cold = false, walkoff = false;

    while (!over && inning <= CONFIG.GAME.MAX_INNINGS) {
      for (const half of ['top', 'bottom']) {
        const off = half === 'top' ? A : H;
        const def = half === 'top' ? H : A;

        /* 後攻が勝っている状態で最終回の裏は行わない */
        if (half === 'bottom' && inning >= CONFIG.GAME.INNINGS && H.runs > A.runs) {
          over = true; break;
        }

        const tie = inning >= CONFIG.GAME.TIEBREAK_FROM;
        log.push({ k: 'half', inning, half, tie, score: [A.runs, H.runs] });
        const got = playHalf(off, def, log, inning, half, tie, A, H);
        off.byInning[inning - 1] = got;

        if (half === 'bottom' && inning >= CONFIG.GAME.INNINGS && H.runs > A.runs) {
          walkoff = true; over = true; break;
        }
        /* コールドゲーム */
        if (half === 'bottom' || (half === 'top' && H.runs > A.runs)) {
          const diff = Math.abs(A.runs - H.runs);
          for (const rule of CONFIG.GAME.COLD) {
            if (inning >= rule.inning && diff >= rule.diff) { cold = true; over = true; break; }
          }
        }
        if (over) break;
      }
      if (over) break;
      if (inning >= CONFIG.GAME.INNINGS && A.runs !== H.runs) { over = true; break; }
      inning++;
    }

    /* 攻撃が無かった回は null（スコアボードでは「×」）にしておく。
       後攻が勝っていれば最終回の裏は行われない。 */
    const last = Math.max(A.byInning.length, H.byInning.length);
    for (let i = 0; i < last; i++) {
      if (A.byInning[i] == null) A.byInning[i] = 0;
      if (H.byInning[i] == null) H.byInning[i] = null;
    }

    creditDecision(A, H);
    log.push({ k: 'end', score: [A.runs, H.runs], cold, walkoff, innings: last });

    return {
      away: summary(A), home: summary(H), log,
      winner: A.runs > H.runs ? 'away' : (H.runs > A.runs ? 'home' : 'draw'),
      cold, walkoff, innings: last,
    };
  }

  function summary(S) {
    return {
      team: S.team, runs: S.runs, hits: S.hits, errors: S.errors,
      byInning: S.byInning, usedPitchers: S.usedPitchers,
    };
  }

  /** 勝敗投手。細かい規則までは追わず、投球回と失点で決めている */
  function creditDecision(A, H) {
    const win = A.runs > H.runs ? A : (H.runs > A.runs ? H : null);
    if (!win) return;
    const lose = win === A ? H : A;
    const pick = (S, fn) => {
      const list = S.usedPitchers.map((id) => Team.find(S.team, id)).filter(Boolean);
      return list.sort(fn)[0] || null;
    };
    const w = pick(win, (a, b) => b.game.outs - a.game.outs);
    if (w) w.game.w = 1;
    const l = pick(lose, (a, b) => (b.game.er - a.game.er) || (b.game.outs - a.game.outs));
    if (l) l.game.l = 1;
    /* 完投・完封 */
    if (win.usedPitchers.length === 1 && w) {
      w.game.cg = 1;
      if (lose.runs === 0) w.game.sho = 1;
    }
  }

  /* ---------- 半イニング ---------- */

  function playHalf(off, def, log, inning, half, tie, A, H) {
    const offTeam = off.team, defTeam = def.team;
    let outs = 0;
    let bases = [null, null, null];
    let got = 0;

    /* タイブレークは無死一二塁から。走者は前の打順の2人にしておく */
    if (tie) {
      const i1 = (off.order + 7) % 9, i2 = (off.order + 8) % 9;
      bases[0] = Team.find(offTeam, off.team.lineup[i2].pid);
      bases[1] = Team.find(offTeam, off.team.lineup[i1].pid);
    }

    while (outs < 3) {
      /* 投手交代の見きわめ */
      maybeChangePitcher(def, log, inning, half);

      const pit = Team.find(defTeam, def.pitcherId);
      const slotIndex = off.order % 9;
      const slot = offTeam.lineup[slotIndex];
      const bat = Team.find(offTeam, slot.pid);
      off.order = (off.order + 1) % 9;
      if (!bat || !pit) { outs = 3; break; }

      /* 盗塁。一塁だけが埋まっているときに、足のある選手がしかける */
      if (bases[0] && !bases[1] && outs < 2) {
        const runner = bases[0];
        const pAttempt = C((runner.speed - 45) / 200, 0, 0.30);
        if (RNG.chance(pAttempt)) {
          const cat = Team.defenders(defTeam, def.pitcherId).C;
          const arm = cat ? (cat.arm * 0.6 + cat.catch * 0.4) : 40;
          const ok = RNG.chance(C(0.50 + (runner.speed - arm) / 130, 0.20, 0.93));
          if (ok) {
            bases[1] = runner; bases[0] = null; runner.game.sb++;
            log.push(snap('steal', { text: runner.name + ' 盗塁成功', ok: true }, off, def, inning, half, outs, bases, A, H, bat, pit));
          } else {
            bases[0] = null; outs++;
            log.push(snap('steal', { text: runner.name + ' 盗塁失敗', ok: false }, off, def, inning, half, outs, bases, A, H, bat, pit));
            if (outs >= 3) break;
          }
        }
      }

      const fatigue = Math.max(0, (def.bf - capacityOf(pit)) / 18);
      const defenders = Team.defenders(defTeam, def.pitcherId);
      const defRating = defenseOf(defTeam, def.pitcherId);
      const res = resolvePA(bat, pit, defTeam, defRating, fatigue, defenders, off.form, def.form);
      res.slotIndex = slotIndex;

      def.bf++;
      pit.game.bf++;

      const before = outs;
      const out = advance(res, bases, outs, bat, off, def, pit);
      outs = out.outs;
      bases = out.bases;
      got += out.runs;
      off.runs += out.runs;
      def.pitcherRuns += out.runs;

      recordBat(bat, res, out);
      recordPit(pit, res, out);
      if (res.code === 'E' && res.by) {
        const fl = Team.find(defTeam, res.by);
        if (fl) { fl.game.e = (fl.game.e || 0) + 1; }
        def.errors++;
      }
      if (res.code === '1B' || res.code === '2B' || res.code === '3B' || res.code === 'HR') off.hits++;

      log.push(snap('pa', {
        text: res.text, code: res.code, rbi: out.rbi, runs: out.runs,
        desc: out.desc || '',
      }, off, def, inning, half, outs, bases, A, H, bat, pit, before, slotIndex));

      /* サヨナラ */
      if (off.isHome && inning >= CONFIG.GAME.INNINGS && off.runs > (off === A ? H.runs : A.runs)) {
        return got;
      }
      if (outs >= 3) break;
    }

    off.lob += bases.filter(Boolean).length;
    return got;
  }

  function snap(kind, extra, off, def, inning, half, outs, bases, A, H, bat, pit, prevOuts, slotIndex) {
    const e = Object.assign({ k: kind }, extra);
    e.inning = inning; e.half = half; e.outs = outs;
    e.prevOuts = prevOuts == null ? outs : prevOuts;
    e.bases = bases.map((b) => (b ? b.id : null));
    e.score = [A.runs, H.runs];
    e.batter = bat ? bat.id : null;
    e.batterName = bat ? bat.name : '';
    e.pitcher = pit ? pit.id : null;
    /* いま打った打順（1〜9）。盗塁など打席の外の出来事では次打者を指す */
    e.order = (slotIndex == null ? off.order : slotIndex) + 1;
    return e;
  }

  /* ---------- 走者を進める ---------- */

  function advance(res, bases0, outs, bat, off, def, pit) {
    const bases = bases0.slice();
    const outsBefore = outs;
    let runs = 0, rbi = 0, desc = '';
    const scored = [];

    const score = (r) => { if (r) { runs++; scored.push(r); } };
    const sp = (r) => (r ? r.speed / 100 : 0.4);

    switch (res.code) {
      case 'K':
        outs++; break;

      case 'BB': case 'HBP': {
        /* 押し出しになる形だけ進める */
        if (bases[0]) {
          if (bases[1]) {
            if (bases[2]) { score(bases[2]); rbi++; }
            bases[2] = bases[1];
          }
          bases[1] = bases[0];
        }
        bases[0] = bat;
        break;
      }

      case '1B': {
        if (bases[2]) { score(bases[2]); rbi++; bases[2] = null; }
        if (bases[1]) {
          if (RNG.chance(0.50 + sp(bases[1]) * 0.35)) { score(bases[1]); rbi++; }
          else bases[2] = bases[1];
          bases[1] = null;
        }
        if (bases[0]) {
          if (!bases[2] && RNG.chance(0.20 + sp(bases[0]) * 0.30)) bases[2] = bases[0];
          else bases[1] = bases[0];
          bases[0] = null;
        }
        bases[0] = bat;
        break;
      }

      case '2B': {
        if (bases[2]) { score(bases[2]); rbi++; bases[2] = null; }
        if (bases[1]) { score(bases[1]); rbi++; bases[1] = null; }
        if (bases[0]) {
          if (RNG.chance(0.35 + sp(bases[0]) * 0.35)) { score(bases[0]); rbi++; }
          else bases[2] = bases[0];
          bases[0] = null;
        }
        bases[1] = bat;
        break;
      }

      case '3B': {
        for (let i = 2; i >= 0; i--) if (bases[i]) { score(bases[i]); rbi++; bases[i] = null; }
        bases[2] = bat;
        break;
      }

      case 'HR': {
        for (let i = 2; i >= 0; i--) if (bases[i]) { score(bases[i]); rbi++; bases[i] = null; }
        score(bat); rbi++;
        break;
      }

      case 'E': {
        /* 失策。打者は生きて、走者はひとつ進む */
        if (bases[2]) { score(bases[2]); bases[2] = null; }
        if (bases[1]) { bases[2] = bases[1]; bases[1] = null; }
        if (bases[0]) { bases[1] = bases[0]; bases[0] = null; }
        bases[0] = bat;
        break;
      }

      case 'OUT': {
        if (res.bbType === 'GB') {
          /* 併殺の目 */
          if (bases[0] && outs < 2) {
            const pDP = C(0.40 - (bat.speed - 50) * 0.004, 0.08, 0.66);
            if (RNG.chance(pDP)) {
              outs += 2;
              bases[0] = null;
              if (outs < 3 && bases[1]) { bases[2] = bases[1]; bases[1] = null; }
              res.text = posShort(res.spot) + '併';
              break;
            }
          }
          outs++;
          if (outs < 3) {
            if (bases[2] && RNG.chance(0.35)) { score(bases[2]); rbi++; bases[2] = null; }
            if (bases[1] && !bases[2] && RNG.chance(0.45)) { bases[2] = bases[1]; bases[1] = null; }
            if (bases[0] && !bases[1]) { bases[1] = bases[0]; bases[0] = null; }
          }
        } else {
          /* 犠飛 */
          const deep = res.isOF;
          if (bases[2] && outs < 2 && deep && RNG.chance(0.55)) {
            outs++;
            score(bases[2]); rbi++; bases[2] = null;
            res.text = '犠飛';
            res.sf = true;
            break;
          }
          outs++;
        }
        break;
      }
      default: outs++;
    }

    /* 得点した走者に得点を付ける */
    scored.forEach((r) => { if (r.game) r.game.r++; });

    return { outs, bases, runs, rbi, desc, prevOuts: outsBefore };
  }

  /* ---------- 成績を付ける ---------- */

  function recordBat(bat, res, out) {
    const s = bat.game;
    s.pa++;
    s.rbi += out.rbi;
    switch (res.code) {
      case 'K': s.ab++; s.so++; break;
      case 'BB': case 'HBP': s.bb++; break;
      case '1B': s.ab++; s.h++; break;
      case '2B': s.ab++; s.h++; s.d2++; break;
      case '3B': s.ab++; s.h++; s.d3++; break;
      case 'HR': s.ab++; s.h++; s.hr++; break;
      case 'E': s.ab++; break;
      default:
        if (res.sf) s.sf++; else s.ab++;
    }
  }

  function recordPit(pit, res, out) {
    const s = pit.game;
    s.outs += Math.max(0, out.outs - out.prevOuts);
    s.r += out.runs;
    /* 失策がからんだ点も、ここでは自責点として扱っている（簡略化） */
    s.er += out.runs;
    switch (res.code) {
      case 'K': s.so++; break;
      case 'BB': case 'HBP': s.bb++; break;
      case '1B': case '2B': case '3B': s.h++; break;
      case 'HR': s.h++; s.hr++; break;
      default: break;
    }
  }

  /* ---------- 投手交代 ---------- */

  function maybeChangePitcher(def, log, inning, half) {
    if (!def.penId.length) return;
    const pit = Team.find(def.team, def.pitcherId);
    if (!pit) return;
    const cap = capacityOf(pit);
    const tired = def.bf > cap + 12;
    const beaten = def.pitcherRuns >= 7 && def.bf >= 12;
    if (!tired && !beaten) return;

    const nextId = def.penId.shift();
    const next = Team.find(def.team, nextId);
    if (!next) return;
    def.pitcherId = nextId;
    def.usedPitchers.push(nextId);
    def.bf = 0; def.pitcherRuns = 0;
    next.game.g = 1;
    log.push({
      k: 'sub', inning, half, text: '投手交代　' + pit.name + ' → ' + next.name,
      side: def.isHome ? 'home' : 'away', pitcher: nextId,
    });
  }

  /* ---------- 練習試合ぶんの通算成績 ----------
     ゲームには出てこない練習試合を、試合とまったく同じ計算で回して数字にする。
     こうしておかないと「通算打率の割に大会では打たない」が起きる。
     相手は「その選手が実際にぶつかるくらいの相手」を想定する。 */

  /* level ごとの、相手の先発投手の球威・制球と、守備のまとまり。
     実際に Tournament.makeTeam で作ったチームから測った値を並べてある */
  const PEER = [
    [15, 0.295, 0.323, 0.219],
    [25, 0.323, 0.407, 0.318],
    [35, 0.385, 0.513, 0.430],
    [45, 0.470, 0.624, 0.549],
    [55, 0.531, 0.717, 0.648],
    [65, 0.629, 0.829, 0.764],
    [75, 0.703, 0.907, 0.853],
    [85, 0.752, 0.970, 0.952],
    [95, 0.806, 0.993, 0.997],
  ];

  function peerProfile(level) {
    const lv = C(level, PEER[0][0], PEER[PEER.length - 1][0]);
    for (let i = 1; i < PEER.length; i++) {
      if (lv <= PEER[i][0]) {
        const a = PEER[i - 1], b = PEER[i];
        const t = (lv - a[0]) / (b[0] - a[0]);
        return {
          stuff: a[1] + (b[1] - a[1]) * t,
          ctrl:  a[2] + (b[2] - a[2]) * t,
          def:   a[3] + (b[3] - a[3]) * t,
        };
      }
    }
    const last = PEER[PEER.length - 1];
    return { stuff: last[1], ctrl: last[2], def: last[3] };
  }

  /** その level のチームで、打順に入るくらいの打者像 */
  function peerBatter(level) {
    const m = RNG.stat(level + 8);   // スタメンは控えより8ほど上
    return { meet: m, power: m, speed: m, traj: 2, bats: 'R', pull: 12 };
  }

  /** 打者の練習試合ぶんの成績 */
  function careerBat(bat, pa, level) {
    const pf = peerProfile(level);
    const s = Player.emptyBat();
    for (let i = 0; i < pa; i++) {
      const res = resolveVs(bat, pf.stuff, pf.ctrl, pf.def, null);
      s.pa++;
      switch (res.code) {
        case 'K':  s.ab++; s.so++; break;
        case 'BB': case 'HBP': s.bb++; break;
        case '1B': s.ab++; s.h++; break;
        case '2B': s.ab++; s.h++; s.d2++; break;
        case '3B': s.ab++; s.h++; s.d3++; break;
        case 'HR': s.ab++; s.h++; s.hr++; break;
        case 'E':  s.ab++; break;
        default:
          /* 外野フライの一部は犠飛になる */
          if (res.isOF && RNG.chance(0.04)) s.sf++; else s.ab++;
      }
    }
    const single = s.h - s.d2 - s.d3 - s.hr;
    /* 打点と得点は前後の打者しだい。実際の試合で出ている割合から見積もる */
    s.rbi = Math.round(single * 0.26 + s.d2 * 0.43 + s.d3 * 0.58 + s.hr * 1.60 + s.sf);
    s.r = Math.round((s.h + s.bb - s.hr) * 0.303 + s.hr);
    s.sb = Math.round(pa * C((bat.speed - 40) / 100 * 0.016, 0, 0.05));
    return s;
  }

  /** 投手の練習試合ぶんの成績 */
  function careerPit(pit, outsTarget, level) {
    const foe = peerBatter(level);
    const pf = peerProfile(level);
    const stuff = stuffOf(pit), ctrl = pit.control / 100;
    const s = Player.emptyPit();
    let guard = 0;
    while (s.outs < outsTarget && guard++ < outsTarget * 12 + 200) {
      const res = resolveVs(foe, stuff, ctrl, pf.def, null);
      s.bf++;
      switch (res.code) {
        case 'K': s.so++; s.outs++; break;
        case 'BB': case 'HBP': s.bb++; break;
        case '1B': case '2B': case '3B': s.h++; break;
        case 'HR': s.h++; s.hr++; break;
        case 'E': break;
        default: s.outs++;
      }
    }
    s.r = Math.round((s.h - s.hr) * 0.31 + s.bb * 0.14 + s.hr * 1.45);
    s.er = s.r;
    return s;
  }

  return {
    play, resolvePA, resolveVs, stuffOf, veloScore, defenseOf, capacityOf,
    peerProfile, peerBatter, careerBat, careerPit,
  };
})();
