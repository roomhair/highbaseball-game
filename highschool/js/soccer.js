/* ==================================================
   高校野球  soccer.js

   夏の県大会でコールド負けした野球部の部員がやる気を無くし、サッカーを始めたあとの「第二の物語」。
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

  /* ---------- 能力 ----------
     世の中のサッカーゲーム（EA SPORTS FC・eFootball）の主要能力のうち、
     大事なものだけを8つ持たせる。フィールドの選手は7つ、GKはそれに
     キーパーの能力が加わる（GKも足・パス・体は試合に効く）。 */

  const STATS = [
    { key: 'sho', label: 'シュート' },
    { key: 'pas', label: 'パス' },
    { key: 'dri', label: 'ドリブル' },
    { key: 'def', label: '守備' },
    { key: 'spd', label: 'スピード' },
    { key: 'sta', label: 'スタミナ' },
    { key: 'str', label: 'フィジカル' },
    { key: 'gk',  label: 'キーパー' },
  ];
  const FIELD_KEYS = ['sho', 'pas', 'dri', 'def', 'spd', 'sta', 'str'];
  const GK_KEYS = ['gk', 'pas', 'spd', 'sta', 'str'];
  const ALL_KEYS = STATS.map((x) => x.key);
  /* 表に並べる能力（全員同じ並び） */
  const MAIN_FIELD = STATS;
  const MAIN_GK = STATS;

  /** 試合の計算で使う形にそろえる */
  function mains(s) {
    return { spd: s.spd, sho: s.sho, pas: s.pas, dri: s.dri, def: s.def, phy: (s.str + s.sta) / 2, sta: s.sta, str: s.str, gk: s.gk };
  }

  function mainList(p) {
    const s = p.soc || p.s || p;
    return STATS.map((x) => ({ key: x.key, label: x.label, value: Math.round(s[x.key]) }));
  }

  const POS = ['GK', 'DF', 'MF', 'FW'];
  const POS_NAME = { GK: 'ゴールキーパー', DF: 'ディフェンダー', MF: 'ミッドフィルダー', FW: 'フォワード' };
  const FORMATION = { GK: 1, DF: 4, MF: 4, FW: 2 };
  /* 自軍で選べるフォーメーション（DF-MF-FW の人数）。相手はいつも 4-4-2 */
  const FORMATIONS = {
    '4-4-2': { GK: 1, DF: 4, MF: 4, FW: 2 },
    '4-3-3': { GK: 1, DF: 4, MF: 3, FW: 3 },
    '3-5-2': { GK: 1, DF: 3, MF: 5, FW: 2 },
    '4-5-1': { GK: 1, DF: 4, MF: 5, FW: 1 },
    '5-3-2': { GK: 1, DF: 5, MF: 3, FW: 2 },
  };
  function formationOf(S) { return FORMATIONS[(S && S.formation) || '4-4-2'] || FORMATIONS['4-4-2']; }
  const REVIVE_SEASONS = 3;

  function rateFor(s, pos) {
    const m = mains(s);
    if (pos === 'GK') return m.gk * 0.8 + m.pas * 0.1 + m.str * 0.1;
    if (pos === 'DF') return m.def * 0.45 + m.phy * 0.2 + m.spd * 0.15 + m.pas * 0.1 + m.dri * 0.1;
    if (pos === 'MF') return m.pas * 0.35 + m.dri * 0.2 + m.def * 0.15 + m.phy * 0.15 + m.sho * 0.15;
    return m.sho * 0.4 + m.spd * 0.2 + m.dri * 0.2 + m.phy * 0.1 + m.pas * 0.1;
  }

  function bestPos(s) {
    let best = 'MF', bv = -1;
    POS.forEach((k) => { const v = rateFor(s, k) - (k === 'GK' ? 6 : 0); if (v > bv) { bv = v; best = k; } });
    return best;
  }

  function rating(p) { return Math.round(rateFor(p.soc, p.soc.pos)); }

  /**
   * 野球選手をサッカー選手として見直す。野球の数字を写すのではなく、
   * 体の強さ・足・肩・守備を手がかりに、ばらつきを大きく取って作り直す。
   */
  function convert(p) {
    const n = (m, sd) => RNG.stat(RNG.norm(m, sd || 10));
    const isPit = p.kind === 'pitcher';
    const t = p.talent || 0;
    const sp = p.speed || 45, pw = p.power || 45, mt = p.meet || 45, fd = p.field || 45, ar = p.arm || 45, ct = p.catch || 45;
    const s = {
      sho: n(32 + t * 4 + (mt - 45) * 0.15 + pw * 0.06, 12),
      pas: n(34 + ar * 0.12 + t * 2, 11),
      dri: n(32 + sp * 0.15 + mt * 0.1, 11),
      def: n(fd * 0.3 + 24, 11),
      spd: n(sp * 0.55 + 18),
      sta: n((isPit ? p.stamina : 45) * 0.4 + 20),
      str: n(pw * 0.35 + 20),
      gk: n(ct * 0.42 + (p.pos === 'C' ? 12 : 0) + 9, 11),
    };
    s.pos = bestPos(s);
    p.soc = s;
    /* サッカーを始めたときの能力。野球に戻るとき、ここからどれだけ上がったかを見る */
    p.socBase = Object.assign({}, s);
    p.socCareer = { g: 0, goals: 0, assists: 0, cs: 0 };
    return p;
  }

  /** 古い保存データの能力（7つ・16個の版）を、いまの8つに作り直す */
  function migrate(S) {
    if (!S || !S.players) return;
    S.players.forEach((p) => {
      const o = p.soc;
      if (!o || o.sho != null) return;
      const r = (v) => RNG.stat(Math.round(v));
      let s;
      if (o.fin != null) {
        s = {
          sho: r(o.fin * 0.8 + o.hea * 0.2), pas: r(o.spa * 0.4 + o.lpa * 0.3 + o.vis * 0.3),
          dri: r(o.dri * 0.6 + o.bco * 0.4), def: r(o.daw * 0.4 + o.tac * 0.4 + o.hea * 0.2),
          spd: o.spd, sta: o.sta, str: o.str, gk: r(o.gkr * 0.35 + o.gkh * 0.3 + o.gkd * 0.25 + o.gkk * 0.1),
        };
      } else {
        s = { sho: o.atk, pas: o.pas, dri: r((o.atk + o.spd) / 2), def: o.def, spd: o.spd, sta: o.sta, str: o.phy, gk: o.gk };
      }
      s.pos = bestPos(s);
      p.soc = s;
    });
    S.opp = null;
  }

  /** 新入部員（1年生）。level はだいたいの強さの目安 */
  function newRecruit(level) {
    const p = Player.newBatter({ grade: 1, practice: false });
    p.name = NAMES.personName ? (NAMES.personName().last + NAMES.personName().first) : p.name;
    const n = (sd) => RNG.stat(RNG.norm(level, sd || 9));
    p.soc = {};
    ALL_KEYS.forEach((k) => { p.soc[k] = n(k === 'gk' ? 12 : 9); });
    const want = RNG.pick(['GK', 'DF', 'DF', 'MF', 'MF', 'FW', 'FW']);
    const boost = { GK: ['gk'], DF: ['def', 'str'], MF: ['pas', 'dri'], FW: ['sho', 'spd'] }[want];
    boost.forEach((k) => { p.soc[k] = RNG.stat(p.soc[k] + 12); });
    if (want !== 'GK') p.soc.gk = RNG.stat(p.soc.gk - 8);
    p.soc.pos = bestPos(p.soc);
    p.socBase = Object.assign({}, p.soc);
    p.socCareer = { g: 0, goals: 0, assists: 0, cs: 0 };
    return p;
  }

  /* ---------- 野球部に戻る ----------
     部員は野球の能力をそのまま持っている（サッカーの能力は別に持たせてある）ので、
     戻るときは「野球をしていた頃の能力」に、サッカーの練習と試合で上がった分を
     野球の能力に置き換えて足す。 */

  /* サッカーの能力 → 野球の能力。上がった数字に掛ける割合。
     [野手の行き先, 割合, 投手の行き先]（行き先が null なら、その区分には回さない） */
  const TO_BASEBALL = {
    spd: ['speed', 0.5, 'speed'],
    str: ['power', 0.4, 'power'],
    sho: ['meet', 0.35, 'meet'],
    dri: ['meet', 0.2, 'meet'],
    pas: ['arm', 0.4, 'control'],
    def: ['field', 0.5, 'field'],
    gk:  ['catch', 0.5, 'catch'],
    sta: [null, 0.5, 'stamina'],
  };
  const BASEBALL_LABEL = { meet: 'ミート', power: 'パワー', speed: '走力', arm: '肩力', field: '守備', catch: '捕球', control: '制球', stamina: 'スタミナ' };
  const BASEBALL_ORDER = ['control', 'stamina', 'meet', 'power', 'speed', 'arm', 'field', 'catch'];

  /** 野球部に戻した場合の部員と、どの選手のどの能力がいくつ上がったかの一覧を作る。
      ここでは能力を書き換えず、書き換えたあとの値を返す（apply で確定） */
  function backToBaseball(S) {
    const report = [];
    S.players.forEach((p) => {
      const base = p.socBase || p.soc;
      const isPit = p.kind === 'pitcher';
      const add = {};
      Object.keys(TO_BASEBALL).forEach((k) => {
        const d = (p.soc[k] || 0) - (base[k] || 0);
        if (d <= 0) return;
        const [bat, rate, pit] = TO_BASEBALL[k];
        const to = isPit ? pit : bat;
        if (to) add[to] = (add[to] || 0) + d * rate;
      });
      const ups = [];
      BASEBALL_ORDER.forEach((bk) => {
        if (add[bk] == null) return;
        const gain = Math.round(add[bk]);
        if (gain < 1) return;
        const before = p[bk];
        const after = Math.min(100, before + gain);
        if (after > before) ups.push({ key: bk, label: BASEBALL_LABEL[bk], amount: after - before, before, after });
      });
      if (ups.length) report.push({ pid: p.id, name: p.name, grade: p.grade, role: isPit ? '投手' : (p.pos || ''), ups });
    });
    report.sort((a, b) => b.ups.reduce((x, u) => x + u.amount, 0) - a.ups.reduce((x, u) => x + u.amount, 0));
    return report;
  }

  /** 戻す。野球の能力に上がった分を足し、部員を野球部（Team）にまとめて返す */
  function applyBaseball(S, report) {
    const byId = {};
    S.players.forEach((p) => { byId[p.id] = p; });
    report.forEach((r) => {
      const p = byId[r.pid];
      if (!p) return;
      r.ups.forEach((u) => { p[u.key] = u.after; });
    });
    const team = Team.create(S.schoolName);
    S.players.forEach((p) => {
      delete p.soc; delete p.socBase; delete p.socCareer;
      if (p.kind === 'pitcher') team.pitchers.push(p); else team.batters.push(p);
    });
    /* 定員（野手16・投手8）をこえたぶんは、評価の低い選手から外す */
    const trim = (list, n) => {
      while (list.length > n) {
        let worst = 0;
        list.forEach((q, i) => { if (Player.rating(q) < Player.rating(list[worst])) worst = i; });
        list.splice(worst, 1);
      }
    };
    trim(team.batters, 18); trim(team.pitchers, 8);
    /* 足りないときは、打線と継投が組めるだけ補う（あとの新入生で定員まで埋まる） */
    while (team.batters.length < 13) team.batters.push(Player.newBatter({ grade: RNG.chance(0.5) ? 1 : 2, practice: true }));
    while (team.pitchers.length < 6) team.pitchers.push(Player.newPitcher({ grade: RNG.chance(0.5) ? 1 : 2, practice: true }));
    Dataset.uniqueNames([team.batters.concat(team.pitchers)]);
    Team.autoLineup(team);
    return team;
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
    S.baseLevel = strength(S) - 3;
    return S;
  }

  /* ---------- 先発11人 ---------- */

  function autoLineup(S, formation) {
    if (formation) S.formation = formation;
    const F = formationOf(S);
    const pool = S.players.slice();
    const used = new Set();
    const out = [];
    ['GK', 'FW', 'DF', 'MF'].forEach((pos) => {
      const list = pool.filter((p) => !used.has(p.id)).sort((a, b) => rateFor(b.soc, pos) - rateFor(a.soc, pos));
      list.slice(0, F[pos]).forEach((p) => { used.add(p.id); out.push({ pid: p.id, pos }); });
    });
    const order = { GK: 0, DF: 1, MF: 2, FW: 3 };
    S.lineup = out.sort((a, b) => order[a.pos] - order[b.pos]);
  }

  /** 先発の組み方に足りないところ・多すぎるところ（オーダー変更の画面で使う） */
  function lineupProblems(formation, lineup) {
    const F = FORMATIONS[formation] || FORMATIONS['4-4-2'];
    const cnt = { GK: 0, DF: 0, MF: 0, FW: 0 };
    lineup.forEach((x) => { cnt[x.pos]++; });
    return POS.filter((k) => cnt[k] !== F[k]).map((k) => ({ pos: k, now: cnt[k], need: F[k] }));
  }

  /** オーダーを決める。足りなければ false を返して何もしない */
  function setLineup(S, formation, lineup) {
    if (lineupProblems(formation, lineup).length) return false;
    const order = { GK: 0, DF: 1, MF: 2, FW: 3 };
    S.formation = formation;
    S.lineup = lineup.slice().sort((a, b) => order[a.pos] - order[b.pos]);
    return true;
  }

  function findP(S, pid) { return S.players.find((p) => p.id === pid) || null; }

  function mySide(S) {
    return S.lineup.filter((x) => findP(S, x.pid)).map((x) => {
      const p = findP(S, x.pid);
      return { pid: p.id, name: p.name, last: p.last || '', pos: x.pos, s: p.soc, p };
    }).map((x, i) => Object.assign(x, { num: i + 1 }));
  }

  function strength(S) {
    const side = mySide(S);
    return Math.round(side.reduce((s, x) => s + rateFor(x.s, x.pos), 0) / Math.max(1, side.length));
  }

  function lineRatings(side) {
    const g = (pos) => side.filter((x) => x.pos === pos);
    const avg = (arr, f) => arr.length ? arr.reduce((s, x) => s + f(mains(x.s)), 0) / arr.length : 30;
    return {
      atk: avg(g('FW'), (m) => m.sho * 0.6 + m.spd * 0.2 + m.dri * 0.2) * 0.65 +
           avg(g('MF'), (m) => m.sho * 0.4 + m.pas * 0.3 + m.dri * 0.3) * 0.35,
      mid: avg(g('MF'), (m) => m.pas * 0.5 + m.dri * 0.15 + m.phy * 0.2 + m.def * 0.15),
      def: avg(g('DF'), (m) => m.def * 0.6 + m.phy * 0.2 + m.spd * 0.2) * 0.75 + avg(g('MF'), (m) => m.def) * 0.25,
      gk: avg(g('GK'), (m) => m.gk),
      sta: avg(side, (m) => m.phy),
    };
  }

  /** 相手の11人をその強さで作る（Tournament.makeTeam と同じ考え方） */
  function makeOpp(level) {
    const side = [];
    Object.keys(FORMATION).forEach((pos) => {
      for (let i = 0; i < FORMATION[pos]; i++) {
        const n = (sd) => RNG.stat(RNG.norm(level, sd || 7));
        const s = {};
        ALL_KEYS.forEach((k) => { s[k] = n(); });
        const boost = { GK: ['gk'], DF: ['def'], MF: ['pas'], FW: ['sho'] }[pos];
        boost.forEach((k) => { s[k] = RNG.stat(s[k] + 10); });
        if (pos !== 'GK') s.gk = RNG.stat(s.gk - 12);
        const nm = NAMES.personName();
        side.push({ pid: 'o' + pos + i, name: nm.last + nm.first, last: nm.last, pos, s, num: side.length + 1 });
      }
    });
    return side;
  }

  /* ---------- 試合 ----------
     高校サッカーのルールに合わせてある。
     ・前後半40分（準決勝・決勝は45分）。決勝だけは同点なら10分ハーフの延長戦。
     ・それでも同点（決勝以外は80分で同点）ならPK戦。5人ずつ蹴り、決まらなければ
       1人ずつ交互に、差がつくまで続ける。
     攻めの場面（チャンス）の積み重ねで決める。中盤で上回ったほうが攻める回数が
     多く、パスをつないでシュートまで持ち込み、攻撃力と相手の守備・GKの差で
     ゴールになるかが決まる。各場面には、パスをつないだ選手の並びと、
     シュートの結末（ゴール・セーブ・枠外・バー・ブロック）も入れてあり、
     試合中の画面はそれをそのまま動きにする。 */

  function halfLenFor(roundName) {
    return (roundName === '準決勝' || roundName === '決勝') ? 45 : 40;
  }

  /** パスをつないだ選手の並び（後ろから前へ。最後がシュートを打つ選手） */
  function buildUp(side, shooter) {
    const rank = { GK: 0, DF: 1, MF: 2, FW: 3 };
    const pool = side.filter((x) => x !== shooter && x.pos !== 'GK');
    const n = Math.min(pool.length, RNG.range(2, 3));
    const picked = [];
    const left = pool.slice();
    for (let i = 0; i < n; i++) {
      const w = left.map((x) => ({ x, weight: x.pos === 'MF' ? 3 : (x.pos === 'DF' ? 1.5 : 1.5) }));
      const x = RNG.weighted(w).x;
      picked.push(x);
      left.splice(left.indexOf(x), 1);
    }
    picked.sort((a, b) => rank[a.pos] - rank[b.pos]);
    return picked.concat([shooter]).map((x) => x.pid);
  }

  const MISS_TEXT = {
    save: ['シュートはGKがセーブ', 'ミドルシュートをGKが弾いた', 'ゴール前の一撃をGKが止めた'],
    wide: ['シュートは枠の外', 'クロスに合わせたがわずかに外れた', 'ゴール上へ大きくふかした'],
    bar: ['シュートはバーを叩いた', 'シュートはポストに嫌われた'],
    block: ['シュートはDFがブロック', 'ミドルシュートはDFがブロック'],
  };

  /** minFrom〜minTo の間で、攻める回数を決めて場面を作る */
  function makeChances(home, away, H, A, minFrom, minTo, scale, startScore) {
    const events = [];
    let hg = startScore[0], ag = startScore[1];
    const scorers = (side) => {
      const w = side.map((x) => ({ x, weight: x.pos === 'FW' ? 5 + mains(x.s).sho / 10 : x.pos === 'MF' ? 2 + mains(x.s).sho / 20 : x.pos === 'DF' ? 0.6 : 0.02 }));
      return RNG.weighted(w).x;
    };
    const chancesH = Math.max(1, Math.round(RNG.norm((6.2 + (H.mid - A.mid) * 0.12 + 0.4) * scale, 1.8 * Math.sqrt(scale))));
    const chancesA = Math.max(1, Math.round(RNG.norm((6.2 + (A.mid - H.mid) * 0.12) * scale, 1.8 * Math.sqrt(scale))));
    const list = [];
    for (let i = 0; i < chancesH; i++) list.push({ side: 'home', min: RNG.range(minFrom, minTo) });
    for (let i = 0; i < chancesA; i++) list.push({ side: 'away', min: RNG.range(minFrom, minTo) });
    list.sort((a, b) => a.min - b.min);
    list.forEach((c) => {
      const atkSide = c.side === 'home' ? home : away;
      const R = c.side === 'home' ? H : A, D = c.side === 'home' ? A : H;
      const tired = c.min > 60 ? (R.sta - D.sta) * 0.004 : 0;
      const pGoal = RNG.clamp(0.13 + (R.atk - (D.def * 0.6 + D.gk * 0.4)) * 0.006 + tired, 0.03, 0.42);
      const shooter = scorers(atkSide);
      const build = buildUp(atkSide, shooter);
      if (RNG.chance(pGoal)) {
        if (c.side === 'home') hg++; else ag++;
        events.push({ min: c.min, side: c.side, kind: 'goal', outcome: 'goal', pid: shooter.pid, name: shooter.name,
          build, assist: build.length > 1 ? build[build.length - 2] : null, score: [hg, ag] });
      } else {
        const outcome = RNG.weighted([{ k: 'save', weight: 38 }, { k: 'wide', weight: 24 }, { k: 'bar', weight: 6 }, { k: 'block', weight: 22 }]).k;
        events.push({ min: c.min, side: c.side, kind: 'chance', outcome, pid: shooter.pid, name: shooter.name,
          text: RNG.pick(MISS_TEXT[outcome]), build, score: [hg, ag] });
      }
    });
    return { events, hg, ag };
  }

  function playMatch(home, away, opts) {
    opts = opts || {};
    const half = opts.halfLen || 40;
    const total = half * 2;
    const H = lineRatings(home), A = lineRatings(away);
    const r = makeChances(home, away, H, A, 1, total, total / 90, [0, 0]);
    r.events.sort((a, b) => a.min - b.min);
    return { hg: r.hg, ag: r.ag, events: r.events, H, A };
  }

  /** 延長戦（決勝だけ）。10分ハーフの前後半。場面は少なめ */
  function playExtra(home, away, H, A, startScore, total) {
    const r = makeChances(home, away, H, A, total + 1, total + 20, 0.32, startScore);
    r.events.sort((a, b) => a.min - b.min);
    return r;
  }

  /** PK戦。5人ずつ交互に蹴り、決まらなければ1人ずつ、差がつくまで続ける */
  function playPK(home, away, H, A) {
    const order = (side) => side.filter((x) => x.pos !== 'GK')
      .sort((a, b) => (mains(b.s).sho * 0.7 + b.s.str * 0.3) - (mains(a.s).sho * 0.7 + a.s.str * 0.3));
    const sh = { home: order(home), away: order(away) };
    const gk = { home: H.gk, away: A.gk };
    const goals = { home: 0, away: 0 }, taken = { home: 0, away: 0 };
    const kicks = [];
    const kick = (side, i) => {
      const x = sh[side][i % sh[side].length];
      const other = side === 'home' ? 'away' : 'home';
      const p = RNG.clamp(0.76 + (mains(x.s).sho - 50) * 0.002 - (gk[other] - 50) * 0.0025, 0.55, 0.92);
      const scored = RNG.chance(p);
      taken[side]++;
      if (scored) goals[side]++;
      kicks.push({ side, pid: x.pid, name: x.name, scored, score: [goals.home, goals.away], round: i + 1 });
    };
    const decided = () => {
      // 5本ずつの間は、残りの本数で追いつけなくなった時点で決まる
      if (taken.home >= 5 && taken.away >= 5) return taken.home === taken.away && goals.home !== goals.away;
      const left = (s) => 5 - taken[s];
      return goals.home > goals.away + left('away') || goals.away > goals.home + left('home');
    };
    for (let i = 0; i < 5 && !decided(); i++) {
      kick('home', i); if (decided()) break;
      kick('away', i);
    }
    let i = 5;
    while (!decided() && i < 30) { kick('home', i); kick('away', i); i++; }
    if (goals.home === goals.away) goals[RNG.chance(0.5) ? 'home' : 'away']++;   // 念のため
    return { kicks, home: goals.home, away: goals.away, winner: goals.home > goals.away ? 'home' : 'away' };
  }

  /* ---------- 大会（野球と同じ並び） ----------
     夏の県大会 → 夏の全国大会 → オフシーズン → 特訓 → 秋の県大会 →
     秋の地区大会 → 神宮大会相当 → 特訓 → 春の大会（出場できれば）→ 新入生。
     山の組み方は野球と同じ Tournament.create を使い、1回戦の強さだけ
     サッカー部の強さ（部員の評価の平均）を目安に決める。 */

  const F = () => CONFIG.FIELD;

  /* 相手の強さは自軍に合わせて動かさない（野球と同じ）。転向したときの
     チーム力を目安にした固定の値から始まるので、特訓や新入生で部員が
     強くなれば、そのぶん勝ち上がりやすくなる。大会ごとの差は野球の表と同じ */
  function baseLevel(S) {
    if (S.baseLevel == null) S.baseLevel = strength(S) - 3;
    return S.baseLevel;
  }

  function tourFrom(S, kind) {
    const base = baseLevel(S);
    const off = (k) => (F()[k].from - F().local.from);
    switch (kind) {
      case 'national': return (S.localFinalLevel != null ? S.localFinalLevel : base) + Tournament.rollDrift();
      case 'fallPref': return base + off('fallPref');
      case 'fallDistrict': return (S.fallPrefFinalLevel != null ? S.fallPrefFinalLevel : base) + F().fallDistrict.bonus;
      case 'fallJingu': return (S.fallDistrictFinalLevel != null ? S.fallDistrictFinalLevel : base) + F().fallJingu.bonus;
      case 'spring': return base + off('spring');
      default: return base;
    }
  }

  /** 大会の山を組む。kind は野球と同じ（local・national・fallPref・fallDistrict・fallJingu・spring） */
  function createTour(S, kind) {
    return Tournament.create(kind, tourFrom(S, kind), 1, new Set());
  }

  function currentRound(tour) { return tour.rounds[tour.index] || null; }

  /** 次の相手（11人）。試合前の画面で見せるため、先に作っておく。
      同じ回の間は同じ顔ぶれ（試合の前後で変わらない） */
  function buildOpp(S) {
    const round = currentRound(S.tour);
    if (!S.opp || S.opp.index !== S.tour.index || S.opp.kind !== S.tour.kind) {
      S.opp = { kind: S.tour.kind, index: S.tour.index, name: round.schoolName, side: makeOpp(round.level) };
    }
    return S.opp;
  }

  /** 自分の試合をする */
  function playUser(S) {
    const round = currentRound(S.tour);
    const oppSide = buildOpp(S).side;
    const mine = mySide(S);
    const homeIsMe = RNG.chance(0.5);
    const half = halfLenFor(round.name);
    const total = half * 2;
    const home = homeIsMe ? mine : oppSide, away = homeIsMe ? oppSide : mine;
    const r = playMatch(home, away, { halfLen: half });
    let events = r.events, hg = r.hg, ag = r.ag;
    /* 決勝だけは、同点なら10分ハーフの延長戦 */
    let extra = false;
    if (hg === ag && round.name === '決勝') {
      extra = true;
      const ex = playExtra(home, away, r.H, r.A, [hg, ag], total);
      events = events.concat(ex.events);
      hg = ex.hg; ag = ex.ag;
    }
    /* まだ同点ならPK戦（GKの評価・シュートの強さで決まる） */
    let pk = false;
    let win;
    if (hg === ag) {
      pk = playPK(home, away, r.H, r.A);
      win = pk.winner === (homeIsMe ? 'home' : 'away');
    } else {
      win = homeIsMe ? hg > ag : ag > hg;
    }
    const my = homeIsMe ? hg : ag, op = homeIsMe ? ag : hg;
    const mySideKey = homeIsMe ? 'home' : 'away';
    const ups = [];
    mine.forEach((x) => {
      const p = x.p;
      p.socCareer.g++;
      const goals = events.filter((e) => e.kind === 'goal' && e.side === mySideKey && e.pid === p.id).length;
      const assists = events.filter((e) => e.kind === 'goal' && e.side === mySideKey && e.assist === p.id).length;
      p.socCareer.goals += goals;
      p.socCareer.assists = (p.socCareer.assists || 0) + assists;
      if (op === 0 && (x.pos === 'GK' || x.pos === 'DF')) p.socCareer.cs++;
      const perf = goals * 1.5 + assists * 0.6 + (op === 0 && x.pos !== 'FW' ? 1 : 0) + (win ? 0.5 : 0);
      const u = grow(p, 1.1 + perf * 0.5);
      if (u.length) ups.push({ pid: p.id, name: p.name, grade: p.grade, pos: p.soc.pos, ups: u });
    });
    S.players.forEach((p) => {
      if (!mine.some((x) => x.p === p)) {
        const u = grow(p, 0.35);
        if (u.length) ups.push({ pid: p.id, name: p.name, grade: p.grade, pos: p.soc.pos, ups: u });
      }
    });
    const lineupOf = (side) => side.map((x) => ({ pid: x.pid, name: x.name, pos: x.pos, num: x.num, s: x.s }));
    const res = {
      home: homeIsMe, my, op, win, pk, extra, half, total,
      events, ups, oppName: round.schoolName, roundName: round.name, kind: S.tour.kind,
      myLineup: lineupOf(mine), oppLineup: lineupOf(oppSide), formation: S.formation || '4-4-2',
    };
    S.lastMatch = res;
    return res;
  }

  function grow(p, points) {
    const ups = [];
    const keys = RNG.shuffle((p.soc.pos === 'GK' ? GK_KEYS : FIELD_KEYS).slice()).slice(0, 3);
    keys.forEach((key) => {
      const before = p.soc[key];
      const room = Math.max(0, 100 - before) / 22;
      const add = Math.round(points * RNG.clamp(RNG.norm(0.9, 0.4), 0, 2) * Math.min(1, Math.pow(room, 1.9)));
      if (add > 0) { p.soc[key] = RNG.stat(before + add); ups.push({ key, label: STATS.find((s) => s.key === key).label, amount: p.soc[key] - before, before, after: p.soc[key] }); }
    });
    return ups;
  }

  /** 1回戦の次へ進む。山を勝ち切ったら true を返す */
  function advance(S) {
    S.tour.index++;
    if (S.tour.index >= S.tour.rounds.length) return true;
    return false;
  }

  /* ---------- 特訓（野球と同じ作り） ----------
     カードは「強さの段階」を持つ。人数と、1人あたりの上がり幅が段階で決まり、
     1人に複数の能力が同時に上がることもある。選手と上がる能力は
     カードに全部出して、選ぶ前に分かるようにする。 */

  const TIERS = [
    { key: 's',  weight: 30, label: '',        people: [1, 2],  amt: [3, 6],   stats: [80, 18, 2] },
    { key: 'm',  weight: 40, label: '',        people: [2, 3],  amt: [5, 8],  stats: [60, 33, 7] },
    { key: 'l',  weight: 22, label: 'みっちり', people: [3, 5],  amt: [8, 13], stats: [40, 45, 15] },
    { key: 'xl', weight: 4,  label: '猛特訓',   people: [6, 9],  amt: [12, 20], stats: [0, 40, 60] },
  ];

  function pickTier() {
    let r = Math.random() * TIERS.reduce((a, t) => a + t.weight, 0);
    for (const t of TIERS) { r -= t.weight; if (r <= 0) return t; }
    return TIERS[0];
  }

  /** 上がる能力の数（1〜3） */
  function statCount(t) {
    const r = Math.random() * 100;
    return r < t.stats[0] ? 1 : (r < t.stats[0] + t.stats[1] ? 2 : 3);
  }

  function trainingCard(S) {
    const tier = pickTier();
    const n = Math.min(S.players.length, RNG.range(tier.people[0], tier.people[1]));
    const pool = RNG.shuffle(S.players.slice()).slice(0, n);
    const lead = RNG.pick(STATS.filter((x) => x.key !== 'gk'));
    const label = (k) => STATS.find((x) => x.key === k).label;
    const targets = [];
    pool.forEach((p) => {
      const keys = p.soc.pos === 'GK' ? GK_KEYS : FIELD_KEYS;
      const first = keys.indexOf(lead.key) >= 0 ? lead.key : RNG.pick(keys.filter((k) => k !== 'spd' || true));
      const rest = RNG.shuffle(keys.filter((k) => k !== first));
      [first].concat(rest).slice(0, statCount(tier)).forEach((key) => {
        targets.push({ pid: p.id, key, label: label(key), amount: RNG.range(tier.amt[0], tier.amt[1]) });
      });
    });
    return {
      tier: tier.key, tierLabel: tier.label, title: lead.label + 'の練習',
      multi: targets.length > pool.length, targets,
    };
  }

  /** 特訓の状態を作る。limits は { picks, passes }（野球と同じ回数） */
  function startTraining(S, limits) {
    const l = limits || { picks: 5, passes: 3 };
    return { picks: 0, passes: 0, pickLimit: l.picks, passLimit: l.passes, done: false, card: trainingCard(S), log: [] };
  }

  function nextCardOrDone(t, S) {
    if (t.picks >= t.pickLimit) { t.done = true; t.card = null; return; }
    t.card = trainingCard(S);
  }

  /** カードを選ぶ。対象の選手の能力が上がる */
  function trainingChoose(t, S) {
    if (t.done || !t.card) return;
    t.card.targets.forEach((x) => {
      const p = findP(S, x.pid);
      if (!p) return;
      const before = p.soc[x.key];
      p.soc[x.key] = RNG.stat(before + x.amount);
      t.log.push({ pid: p.id, name: p.name, grade: p.grade, label: x.label, before, after: p.soc[x.key], amount: p.soc[x.key] - before });
    });
    t.picks++;
    nextCardOrDone(t, S);
  }

  function canPass(t) { return !t.done && t.passes < t.passLimit; }

  /** カードを見送る */
  function trainingPass(t, S) {
    if (!canPass(t)) return;
    t.passes++;
    t.card = trainingCard(S);
  }

  /** 特訓の成果（結果画面用）。上がった能力だけ、選手ごとにまとめて並べる */
  function trainingSummary(t) {
    return (t.log || []).filter((r) => r.amount > 0);
  }

  /* ---------- 引退・新入部員 ----------
     野球と同じ。3年生は夏が終わった時点で引退し、学年はまだ上げない
     （秋・春の大会は引退後の部員で戦う）。春の大会まで終わってから
     学年を1つ上げ、空いた人数ぶんの新入生を迎える。 */

  function retiring(S) { return S.players.filter((p) => p.grade >= 3); }

  /** 3年生を外す（学年はまだ上げない） */
  function retire(S) {
    const gone = new Set(retiring(S).map((p) => p.id));
    S.players = S.players.filter((p) => !gone.has(p.id));
    autoLineup(S);
  }

  /** 学年を1つ上げる。戻り値は必要な新入生の人数（部員は20人を保つ） */
  function promote(S) {
    S.players.forEach((p) => { p.grade++; Body.yearUp(p); });
    return Math.max(0, 20 - S.players.length);
  }

  /** 新入生の候補を、野球と同じく何組か用意する */
  function freshSets(S, need, count) {
    const avg = strength(S);
    const sets = [];
    for (let k = 0; k < count; k++) {
      const level = RNG.clamp(avg - 8 + RNG.range(-4, 8), 15, 70);
      const list = [];
      for (let i = 0; i < need; i++) list.push(newRecruit(level));
      list.sort((a, b) => rating(b) - rating(a));
      sets.push(list);
    }
    return sets;
  }

  function enroll(S, players) {
    players.forEach((p) => S.players.push(p));
    autoLineup(S);
  }

  /** 野球部を復活させられるか（優勝経験があるか、3シーズン過ごしたか） */
  function canRevive(S) {
    return !!(S && (S.everChampion || S.seasons >= REVIVE_SEASONS));
  }

  return {
    STATS, FIELD_KEYS, GK_KEYS, MAIN_FIELD, MAIN_GK, mains, mainList, migrate, POS, POS_NAME, FORMATION, FORMATIONS, formationOf, lineupProblems, setLineup, REVIVE_SEASONS,
    convert, newRecruit, start, autoLineup, findP, mySide, strength, rating, rateFor,
    createTour, currentRound, playUser, buildOpp, halfLenFor, advance,
    startTraining, trainingChoose, trainingPass, canPass, trainingSummary,
    retiring, retire, promote, freshSets, enroll, canRevive, backToBaseball, applyBaseball,
  };
})();
