/* ==================================================
   高校野球  soccer.js

   ２年連続で夏の地方大会1回戦に敗れた野球部が解散したあとの「第二の物語」。
   roomhair/collegebaseball-game の大学野球版サッカー部（js/engine/soccer.js）
   をもとに、この高校野球ゲームに合わせて作り直してある。
   ・大学版は18大学・3部制のリーグ戦（昇降格つき）だったが、この
     ゲームの対戦相手はもともと大会ごとに作る「その場限り」の存在
     （Tournament.makeTeam と同じやり方）なので、リーグ戦ではなく
     野球と同じ「トーナメントを1つ勝ち上がる」形にしてある。
   ・部員は野球の能力をそのまま使うのではなく、体格・足・肩などから、
     サッカー選手として作り直す（攻撃・守備・パス・スピード・
     フィジカル・スタミナ・GK）。
   ・優勝するか、サッカー部で3年（3シーズン）過ごすと、野球部を
     復活させられる（野球へ戻れなくなることはない）。
   ================================================== */
'use strict';

const Soccer = (() => {

  const STATS = [
    { key: 'atk', label: '攻撃' }, { key: 'def', label: '守備' }, { key: 'pas', label: 'パス' },
    { key: 'spd', label: 'スピード' }, { key: 'phy', label: 'フィジカル' }, { key: 'sta', label: 'スタミナ' },
    { key: 'gk', label: 'GK' },
  ];
  const POS = ['GK', 'DF', 'MF', 'FW'];
  const POS_NAME = { GK: 'ゴールキーパー', DF: 'ディフェンダー', MF: 'ミッドフィルダー', FW: 'フォワード' };
  const FORMATION = { GK: 1, DF: 4, MF: 4, FW: 2 };
  const REVIVE_SEASONS = 3;

  /* ---------- 能力 ---------- */

  function rateFor(s, pos) {
    if (pos === 'GK') return s.gk * 0.75 + s.phy * 0.1 + s.def * 0.15;
    if (pos === 'DF') return s.def * 0.5 + s.phy * 0.2 + s.spd * 0.15 + s.pas * 0.15;
    if (pos === 'MF') return s.pas * 0.45 + s.sta * 0.2 + s.atk * 0.2 + s.def * 0.15;
    return s.atk * 0.55 + s.spd * 0.25 + s.phy * 0.2;
  }

  function bestPos(s) {
    let best = 'MF', bv = -1;
    POS.forEach((k) => { const v = rateFor(s, k) - (k === 'GK' ? 6 : 0); if (v > bv) { bv = v; best = k; } });
    return best;
  }

  function rating(p) { return Math.round(rateFor(p.soc, p.soc.pos)); }

  /**
   * 野球選手をサッカー選手として見直す。野球の数字を写すのではなく、
   * 体の強さ・足・持久力を手がかりに、ばらつきを大きく取って作り直す。
   * （大学版は選手の「性格」も使っていたが、このゲームには無いので
   * 固定の値で代えてある）
   */
  function convert(p) {
    const n = (m, sd) => RNG.stat(RNG.norm(m, sd || 10));
    const isPit = p.kind === 'pitcher';
    const s = {
      spd: n((p.speed || 45) * 0.55 + 18, 10),
      phy: n((p.power || 45) * 0.35 + 20, 10),
      sta: n((isPit ? p.stamina : 45) * 0.4 + 20, 10),
      atk: n(34 + (p.talent || 0) * 4, 12),
      def: n((p.field || 45) * 0.35 + 22, 11),
      pas: n(38 + (p.arm || 45) * 0.1, 11),
      gk: n((p.catch || 45) * 0.45 + (p.pos === 'C' ? 12 : 0) + 8, 11),
    };
    s.pos = bestPos(s);
    p.soc = s;
    p.socCareer = { g: 0, goals: 0, assists: 0, cs: 0 };
    return p;
  }

  /** 新入部員（1年生）。level はだいたいの強さの目安 */
  function newRecruit(level) {
    const p = Player.newBatter({ grade: 1, practice: false });
    p.name = NAMES.personName ? (NAMES.personName().last + NAMES.personName().first) : p.name;
    const n = (sd) => RNG.stat(RNG.norm(level, sd || 9));
    p.soc = { spd: n(), phy: n(), sta: n(), atk: n(11), def: n(11), pas: n(), gk: n(12) };
    const want = RNG.pick(['GK', 'DF', 'DF', 'MF', 'MF', 'FW', 'FW']);
    const boostKey = { GK: 'gk', DF: 'def', MF: 'pas', FW: 'atk' }[want];
    p.soc[boostKey] = RNG.stat(p.soc[boostKey] + 12);
    p.soc.pos = bestPos(p.soc);
    p.socCareer = { g: 0, goals: 0, assists: 0, cs: 0 };
    return p;
  }

  /* ---------- 部の発足 ---------- */

  /** 野球部解散からサッカー部へ。部員を引き継ぐ */
  function start(team) {
    const players = Team.all(team).map(convert);
    const S = {
      players, lineup: [], seasons: 0, titles: 0, everChampion: false,
      tour: null, lastMatch: null, schoolName: team.name,
    };
    autoLineup(S);
    return S;
  }

  /* ---------- 先発11人 ---------- */

  function autoLineup(S) {
    const pool = S.players.slice();
    const used = new Set();
    const out = [];
    ['GK', 'FW', 'DF', 'MF'].forEach((pos) => {
      const list = pool.filter((p) => !used.has(p.id)).sort((a, b) => rateFor(b.soc, pos) - rateFor(a.soc, pos));
      list.slice(0, FORMATION[pos]).forEach((p) => { used.add(p.id); out.push({ pid: p.id, pos }); });
    });
    const order = { GK: 0, DF: 1, MF: 2, FW: 3 };
    S.lineup = out.sort((a, b) => order[a.pos] - order[b.pos]);
  }

  function findP(S, pid) { return S.players.find((p) => p.id === pid) || null; }

  function mySide(S) {
    return S.lineup.filter((x) => findP(S, x.pid)).map((x) => {
      const p = findP(S, x.pid);
      return { pid: p.id, name: p.name, pos: x.pos, s: p.soc, p };
    });
  }

  function strength(S) {
    const side = mySide(S);
    return Math.round(side.reduce((s, x) => s + rateFor(x.s, x.pos), 0) / Math.max(1, side.length));
  }

  function lineRatings(side) {
    const g = (pos) => side.filter((x) => x.pos === pos);
    const avg = (arr, f) => arr.length ? arr.reduce((s, x) => s + f(x.s), 0) / arr.length : 30;
    return {
      atk: avg(g('FW'), (s) => s.atk * 0.6 + s.spd * 0.2 + s.phy * 0.2) * 0.65 +
           avg(g('MF'), (s) => s.atk * 0.5 + s.pas * 0.5) * 0.35,
      mid: avg(g('MF'), (s) => s.pas * 0.6 + s.sta * 0.2 + s.phy * 0.2),
      def: avg(g('DF'), (s) => s.def * 0.6 + s.phy * 0.2 + s.spd * 0.2) * 0.75 + avg(g('MF'), (s) => s.def) * 0.25,
      gk: avg(g('GK'), (s) => s.gk),
      sta: avg(side, (s) => s.sta),
    };
  }

  /** 相手の11人をその強さで作る（Tournament.makeTeam と同じ考え方） */
  function makeOpp(level) {
    const side = [];
    Object.keys(FORMATION).forEach((pos) => {
      for (let i = 0; i < FORMATION[pos]; i++) {
        const n = (sd) => RNG.stat(RNG.norm(level, sd || 7));
        const s = { spd: n(), phy: n(), sta: n(), atk: n(), def: n(), pas: n(), gk: n() };
        const k = { GK: 'gk', DF: 'def', MF: 'pas', FW: 'atk' }[pos];
        s[k] = RNG.stat(s[k] + 10);
        side.push({ pid: 'o' + pos + i, name: '', pos, s });
      }
    });
    return side;
  }

  /* ---------- 試合 ----------
     90分を「攻め」の場面の積み重ねで決める。中盤で上回ったほうが攻める回数が
     多く、攻撃力と相手の守備・GKの差でゴールになるかが決まる。 */
  function playMatch(home, away) {
    const H = lineRatings(home), A = lineRatings(away);
    const events = [];
    let hg = 0, ag = 0;
    const scorers = (side) => {
      const w = side.map((x) => ({ x, weight: x.pos === 'FW' ? 5 + x.s.atk / 10 : x.pos === 'MF' ? 2 + x.s.atk / 20 : x.pos === 'DF' ? 0.6 : 0.02 }));
      return RNG.weighted(w).x;
    };
    const chancesH = Math.max(3, Math.round(RNG.norm(9 + (H.mid - A.mid) * 0.18 + 0.6, 2.2)));
    const chancesA = Math.max(3, Math.round(RNG.norm(9 + (A.mid - H.mid) * 0.18, 2.2)));
    const list = [];
    for (let i = 0; i < chancesH; i++) list.push({ side: 'home', min: RNG.range(1, 90) });
    for (let i = 0; i < chancesA; i++) list.push({ side: 'away', min: RNG.range(1, 90) });
    list.sort((a, b) => a.min - b.min);
    list.forEach((c) => {
      const atkSide = c.side === 'home' ? home : away;
      const R = c.side === 'home' ? H : A, D = c.side === 'home' ? A : H;
      const tired = c.min > 60 ? (R.sta - D.sta) * 0.004 : 0;
      const pGoal = RNG.clamp(0.13 + (R.atk - (D.def * 0.6 + D.gk * 0.4)) * 0.006 + tired, 0.03, 0.42);
      const shooter = scorers(atkSide);
      if (RNG.chance(pGoal)) {
        if (c.side === 'home') hg++; else ag++;
        events.push({ min: c.min, side: c.side, kind: 'goal', pid: shooter.pid, name: shooter.name, score: [hg, ag] });
      } else {
        const what = RNG.pick(['シュートはGKがセーブ', 'シュートは枠の外', 'シュートはバーを叩いた', 'クロスに合わせたがわずかに外れた', 'ミドルシュートはDFがブロック']);
        events.push({ min: c.min, side: c.side, kind: 'chance', pid: shooter.pid, name: shooter.name, text: what, score: [hg, ag] });
      }
    });
    events.sort((a, b) => a.min - b.min);
    let s = [0, 0];
    events.forEach((e) => { if (e.score) s = e.score; else e.score = s.slice(); });
    return { hg, ag, events };
  }

  /* ---------- 大会（トーナメント。野球の地方大会と同じ考え方） ---------- */

  const ROUND_NAMES = ['1回戦', '2回戦', '準々決勝', '準決勝', '決勝'];

  /** 山を組む。1回戦の強さ（自軍の強さに合わせる）から、1試合ごとに
      少しずつ強くなっていく */
  function createTournament(myStrength) {
    const from = RNG.clamp(myStrength + RNG.range(-8, 2), 10, 70);
    const levels = [from];
    for (let i = 1; i < ROUND_NAMES.length; i++) {
      const mustRise = i >= ROUND_NAMES.length - 2;
      let add = RNG.range(-2, 7);
      if (mustRise && add < 1) add = 1 + Math.random() * 4;
      levels.push(RNG.clamp(levels[i - 1] + add, 10, 96));
    }
    return { rounds: ROUND_NAMES.map((name, i) => ({ name, level: Math.round(levels[i]) })), index: 0 };
  }

  function currentRound(tour) { return tour.rounds[tour.index] || null; }

  /** 自分の試合をする */
  function playUser(S) {
    const round = currentRound(S.tour);
    const oppSide = makeOpp(round.level);
    const mine = mySide(S);
    const homeIsMe = RNG.chance(0.5);
    const r = homeIsMe ? playMatch(mine, oppSide) : playMatch(oppSide, mine);
    const my = homeIsMe ? r.hg : r.ag, op = homeIsMe ? r.ag : r.hg;
    /* トーナメントなので引き分けは無い。同点ならPK戦で決める
       （GKの評価が高いほど少しだけ勝ちやすい） */
    let win = my > op, pk = false;
    if (my === op) {
      pk = true;
      const H = lineRatings(homeIsMe ? mine : oppSide), A = lineRatings(homeIsMe ? oppSide : mine);
      const myGk = homeIsMe ? H.gk : A.gk, opGk = homeIsMe ? A.gk : H.gk;
      win = RNG.chance(0.5 + (myGk - opGk) * 0.002);
    }
    const mySideKey = homeIsMe ? 'home' : 'away';
    const ups = [];
    mine.forEach((x) => {
      const p = x.p;
      p.socCareer.g++;
      const goals = r.events.filter((e) => e.kind === 'goal' && e.side === mySideKey && e.pid === p.id).length;
      p.socCareer.goals += goals;
      if (op === 0 && (x.pos === 'GK' || x.pos === 'DF')) p.socCareer.cs++;
      const perf = goals * 1.5 + (op === 0 && x.pos !== 'FW' ? 1 : 0) + (win ? 0.5 : 0);
      const u = grow(p, 1.1 + perf * 0.5);
      if (u.length) ups.push({ pid: p.id, name: p.name, ups: u });
    });
    S.players.forEach((p) => {
      if (!mine.some((x) => x.p === p)) {
        const u = grow(p, 0.35);
        if (u.length) ups.push({ pid: p.id, name: p.name, ups: u });
      }
    });
    const res = { home: homeIsMe, my, op, win, pk, events: r.events, ups };
    S.lastMatch = res;
    return res;
  }

  function grow(p, points) {
    const ups = [];
    const keys = RNG.shuffle(STATS.map((s) => s.key)).slice(0, 3);
    keys.forEach((key) => {
      const before = p.soc[key];
      const room = Math.max(0, 100 - before) / 22;
      const add = Math.round(points * RNG.clamp(RNG.norm(0.9, 0.4), 0, 2) * Math.min(1, Math.pow(room, 1.9)));
      if (add > 0) { p.soc[key] = RNG.stat(before + add); ups.push({ key, label: STATS.find((s) => s.key === key).label, amount: p.soc[key] - before }); }
    });
    return ups;
  }

  /** 1回戦の次へ進む。山を勝ち切ったら true を返す */
  function advance(S) {
    S.tour.index++;
    if (S.tour.index >= S.tour.rounds.length) return true;
    return false;
  }

  /* ---------- 引退・新入部員 ---------- */

  function retiring(S) { return S.players.filter((p) => p.grade >= 3); }

  function endRetirement(S) {
    const gone = new Set(retiring(S).map((p) => p.id));
    S.players = S.players.filter((p) => !gone.has(p.id));
    S.players.forEach((p) => { p.grade++; });
    autoLineup(S);
  }

  /** 卒業した分だけ新入部員を迎える（部員は20人を保つ） */
  function fillRecruits(S) {
    const need = Math.max(0, 20 - S.players.length);
    const avg = strength(S);
    for (let i = 0; i < need; i++) S.players.push(newRecruit(RNG.clamp(avg - 10 + RNG.range(-5, 8), 15, 70)));
    autoLineup(S);
  }

  /** 野球部を復活させられるか（優勝経験があるか、3シーズン過ごしたか） */
  function canRevive(S) {
    return !!(S && (S.everChampion || S.seasons >= REVIVE_SEASONS));
  }

  return {
    STATS, POS, POS_NAME, FORMATION, REVIVE_SEASONS, ROUND_NAMES,
    convert, newRecruit, start, autoLineup, findP, mySide, strength, rating, rateFor,
    createTournament, currentRound, playUser, advance, retiring, endRetirement, fillRecruits, canRevive,
  };
})();
