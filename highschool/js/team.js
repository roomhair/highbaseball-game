/* ==================================================
   高校野球  team.js

   チーム（部員の集まり）と、打順・守備位置の組み立て。
   ・野手13人＋投手7人の20人。ここは最初のチーム作りから最後まで変わらない
     （引退した人数だけ新入生が入るので、人数は保たれる）。
   ・DH制で戦う。打順9人のうち1人は指名打者で、投手は打席に立たない。
   ================================================== */
'use strict';

const Team = (() => {

  /** 空のチーム */
  function create(name) {
    return {
      name: name,
      batters: [],     // 野手13人
      pitchers: [],    // 投手7人
      lineup: [],      // [{pid, pos}] × 9（先頭が1番打者）
      rotation: [],    // 投手の起用順（先頭が先発）
    };
  }

  function all(team) { return team.batters.concat(team.pitchers); }

  function find(team, pid) {
    return all(team).find((p) => p.id === pid) || null;
  }

  /** ある選手がその守備位置をどれだけ守れるか（0〜100） */
  function defScore(p, posKey) {
    if (posKey === 'DH') return 50;
    /* 左投げの選手は、捕手・二塁・三塁・遊撃には置かない */
    if (p.throws === 'L' && Player.RIGHT_ONLY.indexOf(posKey) >= 0) return 1;
    /* 投手が自分のところの打球を処理するときは、適性の減点をしない */
    if (posKey === 'P') return Math.max(1, p.field * 0.7 + p.catch * 0.2 + p.arm * 0.1);
    const pen = Player.aptPenalty(p.apt ? p.apt[posKey] : 'G');
    const base = p.field * 0.55 + p.catch * 0.27 + p.arm * 0.18;
    /* 守る場所ごとに、要る能力が違う */
    const tilt =
      posKey === 'C'  ? p.arm * 0.12 + p.catch * 0.18 :
      posKey === 'SS' || posKey === '2B' ? p.field * 0.14 + p.speed * 0.06 :
      posKey === 'CF' ? p.speed * 0.16 + p.field * 0.04 :
      posKey === 'RF' || posKey === 'LF' ? p.arm * 0.10 : 0;
    return Math.max(1, base + tilt * 0.5 - pen);
  }

  /* 守らせる順番。埋めにくい場所から先に決める */
  const FILL_ORDER = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B'];

  /** 打順と守備位置をおまかせで組む */
  function autoLineup(team) {
    const pool = team.batters.slice();
    const chosen = [];   // {p, pos}
    const used = new Set();

    FILL_ORDER.forEach((posKey) => {
      let best = null, bestScore = -1e9;
      pool.forEach((p) => {
        if (used.has(p.id)) return;
        /* 守備が第一だが、打てる選手を外に出したくないので打力も少し見る */
        const s = defScore(p, posKey) * 1.0 + Player.rating(p) * 0.35;
        if (s > bestScore) { bestScore = s; best = p; }
      });
      if (best) { used.add(best.id); chosen.push({ p: best, pos: posKey }); }
    });

    /* 指名打者は、残っている中でいちばん打てる選手 */
    let dh = null, dhScore = -1e9;
    pool.forEach((p) => {
      if (used.has(p.id)) return;
      const s = p.meet * 0.4 + p.power * 0.45 + p.speed * 0.15;
      if (s > dhScore) { dhScore = s; dh = p; }
    });
    if (dh) { used.add(dh.id); chosen.push({ p: dh, pos: 'DH' }); }

    team.lineup = orderBatters(chosen);
    autoRotation(team);
    return team;
  }

  /** 打順に並べる。1番は走れて当てられる選手、3〜4番は長打 */
  function orderBatters(chosen) {
    const list = chosen.slice();
    const score = {
      lead: (p) => p.speed * 0.5 + p.meet * 0.45 - p.power * 0.10,
      two:  (p) => p.meet * 0.7 + p.speed * 0.2,
      three:(p) => p.meet * 0.45 + p.power * 0.45 + p.speed * 0.10,
      four: (p) => p.power * 0.65 + p.meet * 0.35,
    };
    const out = [];
    const take = (fn) => {
      let best = null, bs = -1e9, bi = -1;
      list.forEach((c, i) => { const s = fn(c.p); if (s > bs) { bs = s; best = c; bi = i; } });
      if (bi >= 0) list.splice(bi, 1);
      return best;
    };
    out[0] = take(score.lead);
    out[2] = take(score.three);
    out[3] = take(score.four);
    out[1] = take(score.two);
    /* 残りは力のある順に5番から。最後の2枠は自然と下位打線になる */
    list.sort((a, b) => Player.rating(b.p) - Player.rating(a.p));
    let k = 4;
    list.forEach((c) => { out[k++] = c; });
    return out.filter(Boolean).map((c) => ({ pid: c.p.id, pos: c.pos }));
  }

  /** 投手の起用順。いちばん良い投手が先発 */
  function autoRotation(team) {
    team.rotation = team.pitchers.slice()
      .sort((a, b) => Player.rating(b) - Player.rating(a))
      .map((p) => p.id);
    return team.rotation;
  }

  /** 打順に入っていない野手（控え） */
  function bench(team) {
    const inLineup = new Set(team.lineup.map((s) => s.pid));
    return team.batters.filter((p) => !inLineup.has(p.id));
  }

  /** 守備位置 → 選手 の対応表。打球が飛んだ先を決めるときに使う */
  function defenders(team, pitcherId) {
    const map = {};
    team.lineup.forEach((s) => {
      if (s.pos === 'DH') return;
      map[s.pos] = find(team, s.pid);
    });
    map.P = find(team, pitcherId);
    return map;
  }

  /** チーム力（0〜100）。相手の強さを決めるときの目安にし、画面にも出す。
     1試合で投げるのはほとんど先発1人なので、控え投手を同じ重みで混ぜない。
     ここが実際の強さとずれていると「チーム力の割に勝てない」に見えてしまう。 */
  function strength(team) {
    const bat = team.lineup.length
      ? team.lineup.map((s) => Player.rating(find(team, s.pid)) || 0)
      : team.batters.map(Player.rating);
    const order = (team.rotation && team.rotation.length)
      ? team.rotation.map((id) => Player.rating(find(team, id)) || 0)
      : team.pitchers.map(Player.rating).sort((a, b) => b - a);
    const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 40);
    const starter = order[0] || 40;
    const relief = avg(order.slice(1, 3));
    const pit = starter * 0.68 + relief * 0.32;
    return Math.round(avg(bat) * 0.58 + pit * 0.42);
  }

  /**
   * 試合が終わったあとの投手の疲れ。
   * たくさん投げた日は溜まり、少しだけの日はほぼ変わらず、
   * まったく投げなかった日はしっかり抜ける。
   */
  function restPitchers(team) {
    team.pitchers.forEach((p) => {
      const outs = (p.game && p.game.outs) || 0;
      const rest = outs === 0 ? 34 : 6;
      p.fatigue = Math.max(0, Math.min(100, Math.round((p.fatigue || 0) + outs * 1.4 - rest)));
    });
  }

  /** 大会と大会のあいだ、オフシーズンでは抜けきる */
  function healPitchers(team) {
    team.pitchers.forEach((p) => { p.fatigue = 0; });
  }

  /** 疲れの見せ方 */
  function fatigueLabel(p) {
    const f = p.fatigue || 0;
    if (f >= 70) return '疲労大';
    if (f >= 40) return 'やや疲労';
    if (f >= 18) return '軽い疲れ';
    return '万全';
  }

  /** いちばん良い選手（負けたときに引き抜かれる1人） */
  function bestPlayer(team) {
    return all(team).slice().sort((a, b) => Player.rating(b) - Player.rating(a))[0] || null;
  }

  /** 打順・守備の並びが壊れていないか直す（引き抜きや卒業のあと） */
  function repair(team) {
    const ids = new Set(team.batters.map((p) => p.id));
    const ok = team.lineup.filter((s) => ids.has(s.pid));
    if (ok.length < 9) { autoLineup(team); return team; }
    team.lineup = ok.slice(0, 9);
    const pids = new Set(team.pitchers.map((p) => p.id));
    team.rotation = (team.rotation || []).filter((id) => pids.has(id));
    team.pitchers.forEach((p) => { if (!team.rotation.includes(p.id)) team.rotation.push(p.id); });
    return team;
  }

  return {
    create, all, find, defScore, autoLineup, autoRotation, orderBatters,
    bench, defenders, strength, bestPlayer, repair, FILL_ORDER,
    restPitchers, healPitchers, fatigueLabel,
  };
})();
