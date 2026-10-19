/* ==================================================
   高校野球  park.js

   試合中のグラウンド（大きい絵）。打席ごとに、
   投球 → 打球（ゴロは転がり、フライは高く上がる）→ 守備（捕りに走る）→
   走者の進塁・生還 → 結果の文字（ヒット・アウト・三振・ホームランなど）
   を動きで見せる。ホームランは花火、得点は「+1」を出す。
   ・試合の中身は sim.js が先に決めている。ここは log の1行を絵にするだけ。
   ・アニメーションは Web Animations（element.animate）で動かすので、
     次の打席が来たら前の動きは途中でも打ち切って最後の位置に置く。
   ================================================== */
'use strict';

const Park = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const HOME = [100, 152];
  const BASES = [[140.5, 111.5], [100, 71], [59.5, 111.5]];
  const MOUND = [100, 113];
  const SPOT = {
    P: [100, 111], C: [100, 162],
    '1B': [133, 104], '2B': [119, 84], '3B': [67, 104], SS: [81, 84],
    LF: [48, 56], CF: [100, 40], RF: [152, 56],
  };
  const GAP = { LF: [60, 40], CF: [100, 30], RF: [140, 40] };
  const DEEP = { LF: [34, 30], CF: [100, 18], RF: [166, 30] };
  const COLOR = { my: '#2f6fe4', op: '#e5483c' };

  let root = null, svg = null, layer = null, fxLayer = null;
  let mySide = 'away', offense = 'away';
  let fielders = {};
  let runners = new Map();     // 選手ID → { g, base }
  let batterNode = null;
  let anims = [];
  let outsLamps = [];

  function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k]));
    if (parent) parent.appendChild(n);
    return n;
  }

  function colorOf(side) { return side === mySide ? COLOR.my : COLOR.op; }

  /* ---------- 球場 ---------- */

  function drawField() {
    svg.innerHTML = '';
    // スタンドと外野
    el('rect', { x: -20, y: -10, width: 240, height: 200, class: 'pk-stand' }, svg);
    el('path', { d: 'M100 152 L8 60 A130 130 0 0 1 192 60 Z', class: 'pk-track' }, svg);
    el('path', { d: 'M100 152 L14 66 A122 122 0 0 1 186 66 Z', class: 'pk-grass' }, svg);
    for (let r = 30; r < 125; r += 16) {
      el('path', { d: 'M' + (100 - r * 0.7071) + ' ' + (152 - r * 0.7071) + ' A' + r + ' ' + r + ' 0 0 1 ' + (100 + r * 0.7071) + ' ' + (152 - r * 0.7071), class: 'pk-mow' }, svg);
    }
    el('path', { d: 'M14 66 A122 122 0 0 1 186 66', class: 'pk-fence' }, svg);
    // 内野の土
    el('path', { d: 'M100 158 L148 110 Q100 52 52 110 Z', class: 'pk-dirt' }, svg);
    el('polygon', { points: '100,146 134,111.5 100,77 66,111.5', class: 'pk-infgrass' }, svg);
    // ファウルライン
    el('line', { x1: 100, y1: 152, x2: 14, y2: 66, class: 'pk-line' }, svg);
    el('line', { x1: 100, y1: 152, x2: 186, y2: 66, class: 'pk-line' }, svg);
    // マウンド・ベース・本塁
    el('circle', { cx: MOUND[0], cy: MOUND[1], r: 5, class: 'pk-mound' }, svg);
    BASES.forEach((b) => el('rect', { x: b[0] - 3, y: b[1] - 3, width: 6, height: 6, transform: 'rotate(45 ' + b[0] + ' ' + b[1] + ')', class: 'pk-base' }, svg));
    el('circle', { cx: HOME[0], cy: HOME[1] + 1, r: 8, class: 'pk-homecircle' }, svg);
    el('polygon', { points: '100,149 103,152 103,154.5 97,154.5 97,152', class: 'pk-plate' }, svg);
    layer = el('g', {}, svg);
    fxLayer = el('g', {}, svg);
    // アウトのランプ
    const og = el('g', { class: 'pk-outs' }, svg);
    el('text', { x: 6, y: 172, class: 'pk-outlabel' }, og).textContent = 'OUT';
    outsLamps = [0, 1, 2].map((i) => el('circle', { cx: 28 + i * 8, cy: 170, r: 3, class: 'pk-lamp' }, og));
  }

  function player(x, y, color, label) {
    const g = el('g', { class: 'pk-pl' }, layer);
    el('circle', { r: 4, fill: color, stroke: '#fff', 'stroke-width': 1 }, g);
    if (label) {
      const t = el('text', { y: 1.3, 'text-anchor': 'middle', class: 'pk-pltext' }, g);
      t.textContent = label;
    }
    setPos(g, x, y);
    return g;
  }

  const T = (x, y) => 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
  function setPos(g, x, y) { g.style.transform = T(x, y); g.__x = x; g.__y = y; }

  /** 位置を動かす（transform 属性を、時間をかけて書き換える） */
  function move(g, x, y, ms, delay) {
    const x0 = g.__x, y0 = g.__y;
    setPos(g, x, y);
    if (!ms) return;
    const a = g.animate([{ transform: T(x0, y0) }, { transform: T(x, y) }],
      { duration: ms, delay: delay || 0, easing: 'ease-in-out', fill: 'backwards' });
    anims.push(a);
  }

  function setOuts(n) {
    outsLamps.forEach((c, i) => c.classList.toggle('is-on', i < n));
  }

  /* ---------- 守備・走者 ---------- */

  const FIELD_LABEL = { P: '投', C: '捕', '1B': '一', '2B': '二', '3B': '三', SS: '遊', LF: '左', CF: '中', RF: '右' };

  function placeFielders() {
    Object.values(fielders).forEach((g) => g.remove());
    fielders = {};
    const def = offense === 'away' ? 'home' : 'away';
    Object.keys(SPOT).forEach((k) => {
      fielders[k] = player(SPOT[k][0], SPOT[k][1], colorOf(def), FIELD_LABEL[k]);
    });
  }

  function clearRunners() {
    runners.forEach((r) => r.g.remove());
    runners.clear();
    if (batterNode) { batterNode.remove(); batterNode = null; }
  }

  function placeBatter() {
    if (batterNode) batterNode.remove();
    batterNode = player(HOME[0] - 7, HOME[1] - 1, colorOf(offense), '');
    batterNode.classList.add('pk-batter');
  }

  /* ---------- 文字・演出 ---------- */

  function pop(text, cls, x, y, ms, delay) {
    const t = el('text', { x: x || 100, y: y || 100, 'text-anchor': 'middle', class: 'pk-pop ' + (cls || '') }, fxLayer);
    t.textContent = text;
    const a = t.animate([
      { opacity: 0, transform: 'translateY(6px) scale(.6)' },
      { opacity: 1, transform: 'translateY(0) scale(1.08)', offset: 0.25 },
      { opacity: 1, transform: 'translateY(-2px) scale(1)', offset: 0.75 },
      { opacity: 0, transform: 'translateY(-8px) scale(1)' },
    ], { duration: ms || 1100, delay: delay || 0, easing: 'ease-out', fill: 'both' });
    a.onfinish = () => t.remove();
    anims.push(a);
  }

  function fireworks(k) {
    const colors = ['#ffd54f', '#e5483c', '#2f6fe4', '#ffffff', '#7ed957'];
    for (let i = 0; i < 4; i++) {
      const cx = 30 + Math.random() * 140, cy = 18 + Math.random() * 40;
      for (let j = 0; j < 10; j++) {
        const ang = (Math.PI * 2 * j) / 10;
        const d = el('circle', { cx, cy, r: 1.6, fill: colors[(i + j) % colors.length] }, fxLayer);
        const a = d.animate([
          { transform: 'translate(0,0)', opacity: 1 },
          { transform: 'translate(' + (Math.cos(ang) * 16) + 'px,' + (Math.sin(ang) * 16) + 'px)', opacity: 0 },
        ], { duration: 900 * k, delay: i * 180 * k, easing: 'ease-out', fill: 'both' });
        a.onfinish = () => d.remove();
        anims.push(a);
      }
    }
  }

  /* ---------- 打球 ---------- */

  function landing(e) {
    if (!e || !e.spot) return null;
    if (e.code === 'HR') return { HR: true, p: (DEEP[e.spot] || [100, 18]).map((v, i) => (i ? v - 14 : v + (v - 100) * 0.15)) };
    if (e.code === '3B') return { p: DEEP[e.spot] || GAP[e.spot] || SPOT[e.spot] };
    if (e.code === '2B') return { p: GAP[e.spot] || SPOT[e.spot] };
    const s = SPOT[e.spot];
    if (!s) return null;
    // 安打は守備位置の前（間）に落ちる。アウトは守備位置そのもの
    if (e.code === '1B') return { p: [s[0] + (Math.random() - 0.5) * 14, s[1] + 8] };
    return { p: s };
  }

  function flightKind(e) {
    const t = e.text || '';
    if (e.code === 'HR' || t.indexOf('飛') >= 0) return 'fly';
    if (t.indexOf('直') >= 0 || e.code === '2B' || e.code === '3B') return 'liner';
    if (t.indexOf('ゴロ') >= 0 || t.indexOf('併') >= 0 || e.code === 'E') return 'ground';
    return Math.random() < 0.5 ? 'liner' : 'ground';
  }

  function ballNode() {
    const g = el('g', { class: 'pk-ball' }, fxLayer);
    const sh = el('ellipse', { rx: 2.2, ry: 1, class: 'pk-ballshadow' }, g);
    const b = el('circle', { r: 2.1, class: 'pk-ballbody' }, g);
    return { g, sh, b };
  }

  /** 投球（マウンド → 本塁） */
  function pitch(k) {
    const n = ballNode();
    setPos(n.g, HOME[0], HOME[1] - 2);
    const a = n.g.animate([{ transform: T(MOUND[0], MOUND[1]) }, { transform: T(HOME[0], HOME[1] - 2) }],
      { duration: 260 * k, easing: 'linear', fill: 'both' });
    anims.push(a);
    return { node: n, dur: 260 * k };
  }

  function hit(e, k, delay) {
    const land = landing(e);
    if (!land) return 0;
    const kind = flightKind(e);
    const n = ballNode();
    const [tx, ty] = land.p;
    setPos(n.g, tx, ty);
    const dur = (land.HR ? 900 : (kind === 'fly' ? 700 : (kind === 'liner' ? 420 : 480))) * k;
    // 高さはボールだけを上に持ち上げ、影は地面を真っすぐ進む
    const lift = land.HR ? 46 : (kind === 'fly' ? 30 : (kind === 'liner' ? 6 : 0));
    anims.push(n.g.animate([{ transform: T(HOME[0], HOME[1] - 2) }, { transform: T(tx, ty) }],
      { duration: dur, delay, easing: kind === 'ground' ? 'ease-out' : 'linear', fill: 'both' }));
    anims.push(n.b.animate([
      { transform: 'translateY(0) scale(1)' },
      { transform: 'translateY(' + (-lift) + 'px) scale(' + (1 + lift / 40) + ')', offset: 0.5 },
      { transform: 'translateY(0) scale(1)' },
    ], { duration: dur, delay, easing: 'ease-in-out', fill: 'both' }));
    if (land.HR) {
      setTimeout(() => n.g.remove(), delay + dur + 50);
    }
    // 守る選手が落ちどころへ走る（アウトなら捕る、安打なら追いかける）
    const f = fielders[e.spot];
    if (f && !land.HR) {
      const out = e.code === 'OUT' || e.code === 'E';
      const fx = out ? tx : f.__x + (tx - f.__x) * 0.7;
      const fy = out ? ty + 2 : f.__y + (ty - f.__y) * 0.7;
      move(f, fx, fy, dur * 0.95, delay);
    }
    return dur;
  }

  /* ---------- 走者 ---------- */

  /** 走者を、塁から塁へ順番に走らせる（2つ以上進むときは塁を回る） */
  function runPath(g, from, to, ms, delay) {
    const pts = [];
    const posOf = (b) => (b < 0 ? HOME : (b >= 3 ? HOME : BASES[b]));
    for (let b = from + 1; b <= to; b++) pts.push(posOf(b));
    if (!pts.length) return;
    const x0 = g.__x, y0 = g.__y;
    const last = pts[pts.length - 1];
    setPos(g, last[0], last[1]);
    const frames = [{ transform: T(x0, y0) }].concat(pts.map((p) => ({ transform: T(p[0], p[1]) })));
    anims.push(g.animate(frames, { duration: ms * pts.length, delay, easing: 'linear', fill: 'backwards' }));
  }

  function moveRunners(e, k, delay) {
    const after = (e.bases || []).slice();
    const prev = new Map();
    runners.forEach((r, id) => prev.set(id, r.base));
    const unit = 260 * k;
    let scored = 0;
    // いた走者
    prev.forEach((base, id) => {
      const r = runners.get(id);
      const nb = after.indexOf(id);
      if (nb >= 0) {
        if (nb !== base) runPath(r.g, base, nb, unit, delay);
        r.base = nb;
      } else if (e.runs && scored < e.runs) {
        // 本塁へ還った
        scored++;
        runPath(r.g, base, 3, unit, delay);
        const t = setTimeout(() => { r.g.remove(); }, delay + unit * (3 - base) + 80);
        anims.push({ cancel() { clearTimeout(t); r.g.remove(); }, finish() { clearTimeout(t); r.g.remove(); } });
        runners.delete(id);
        setTimeout(() => pop('+1', 'pk-pop--run', HOME[0] + 12, HOME[1] - 10, 900 * k), delay + unit * (3 - base));
      } else {
        // アウトになった（併殺など）
        const a = r.g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 * k, delay, fill: 'forwards' });
        a.onfinish = () => r.g.remove();
        anims.push(a);
        runners.delete(id);
      }
    });
    // 打者
    if (e.k === 'pa' && e.batter) {
      const nb = after.indexOf(e.batter);
      if (nb >= 0 && !runners.has(e.batter)) {
        const g = player(HOME[0], HOME[1], colorOf(offense), '');
        runners.set(e.batter, { g, base: nb });
        runPath(g, -1, nb, unit, delay);
      } else if (e.code === 'HR') {
        const g = player(HOME[0], HOME[1], colorOf(offense), '');
        setPos(g, HOME[0], HOME[1]);
        runPath(g, -1, 3, unit * 0.8, delay);
        setTimeout(() => g.remove(), delay + unit * 0.8 * 4 + 60);
      }
    }
    // 名前の無い走者（タイブレークの最初など）は位置だけそろえる
    after.forEach((id, b) => {
      if (id && !runners.has(id)) {
        const g = player(BASES[b][0], BASES[b][1], colorOf(offense), '');
        runners.set(id, { g, base: b });
      }
    });
  }

  /* ---------- 外から呼ぶところ ---------- */

  function finishAll() {
    anims.forEach((a) => { try { a.finish(); } catch (err) { /* もう終わっている */ } });
    anims = [];
    fxLayer && (fxLayer.innerHTML = '');
  }

  function mount(node, opts) {
    root = node;
    mySide = opts.mySide || 'away';
    root.innerHTML = '<svg class="park__svg" viewBox="0 22 200 156" role="img" aria-label="球場"></svg>';
    svg = root.querySelector('svg');
    drawField();
    offense = 'away';
    placeFielders();
    placeBatter();
    setOuts(0);
  }

  /** 1行ぶんを絵にする。speed は 1〜3（速いほど短く）。animate=false なら位置だけそろえる */
  function play(e, speed, animate) {
    if (!svg || !e) return;
    finishAll();
    const k = 1 / Math.max(1, speed || 1);
    if (e.k === 'half') {
      offense = e.half === 'top' ? 'away' : 'home';
      clearRunners();
      placeFielders();
      placeBatter();
      setOuts(0);
      if (e.tie) {
        [0, 1].forEach((b) => runners.set('tie' + b, { g: player(BASES[b][0], BASES[b][1], colorOf(offense), ''), base: b }));
      }
      if (animate !== false) pop((e.half === 'top' ? '表' : '裏') + 'の攻撃', 'pk-pop--half', 100, 112, 900 * k);
      return;
    }
    // 守備位置に戻す
    Object.keys(SPOT).forEach((p) => { if (fielders[p]) setPos(fielders[p], SPOT[p][0], SPOT[p][1]); });
    if (e.k === 'steal') {
      moveRunners(e, animate === false ? 0 : k, 0);
      setOuts(e.outs || 0);
      if (animate !== false) pop(e.ok ? '盗塁成功' : '盗塁失敗', e.ok ? 'pk-pop--good' : 'pk-pop--bad', 100, 100, 1000 * k);
      return;
    }
    if (e.k !== 'pa') return;
    if (animate === false) {
      clearRunners();
      (e.bases || []).forEach((id, b) => { if (id) runners.set(id, { g: player(BASES[b][0], BASES[b][1], colorOf(offense), ''), base: b }); });
      placeBatter();
      setOuts(e.outs || 0);
      return;
    }
    placeBatter();
    const p = pitch(k);
    let t = p.dur;
    const code = e.code;
    const label = {
      HR: ['ホームラン！', 'pk-pop--hr'], '3B': ['三塁打！', 'pk-pop--good'], '2B': ['二塁打！', 'pk-pop--good'],
      '1B': ['ヒット', 'pk-pop--good'], BB: ['フォアボール', 'pk-pop--good'], HBP: ['デッドボール', 'pk-pop--good'],
      E: ['エラー', 'pk-pop--good'], K: ['三振', 'pk-pop--bad'], OUT: ['アウト', 'pk-pop--bad'],
      SH: ['送りバント', ''], SQ: ['スクイズ', 'pk-pop--good'], SQF: ['スクイズ失敗', 'pk-pop--bad'],
      BF: ['バント失敗', 'pk-pop--bad'], BE: ['エラー', 'pk-pop--good'],
    }[code] || [e.text || '', ''];
    if (['1B', '2B', '3B', 'HR', 'OUT', 'E'].indexOf(code) >= 0 && e.spot) {
      // 打った瞬間、打者が一塁へ走り出す前に打球が飛ぶ
      p.node.g.remove();
      const dur = hit(e, k, t);
      t += dur;
    } else if (['SH', 'SQ', 'SQF', 'BF', 'BE'].indexOf(code) >= 0) {
      p.node.g.remove();
      const n = ballNode();
      setPos(n.g, 92 + Math.random() * 16, 132);
      anims.push(n.g.animate([{ transform: T(HOME[0], HOME[1] - 2) }, { transform: T(n.g.__x, 132) }],
        { duration: 300 * k, delay: t, easing: 'ease-out', fill: 'both' }));
      move(fielders.P, n.g.__x, 128, 300 * k, t);
      t += 300 * k;
    } else {
      // 三振・四死球はミットに収まる
      setTimeout(() => { if (p.node.g.parentNode) p.node.g.remove(); }, t + 120);
    }
    if (batterNode) {
      const bn = batterNode;
      if (code === 'K' || code === 'OUT' || code === 'SQF' || code === 'BF') {
        anims.push(bn.animate([{ opacity: 1 }, { opacity: 0.25 }], { duration: 250 * k, delay: t, fill: 'forwards' }));
      } else {
        bn.style.opacity = '0';
      }
    }
    moveRunners(e, k, t * 0.8);
    setTimeout(() => setOuts(e.outs || 0), t);
    if (code === 'HR') fireworks(k);
    pop(label[0], label[1], 100, 100, Math.max(700, 1200 * k), t * 0.6);
  }

  return { mount, play, finishAll };
})();
