/* ==================================================
   高校野球  share.js

   試合結果をSNSに共有・保存するための画像づくり。
   外部ライブラリは使わず、<canvas> に直接描く。
   ・スコア・勝敗投手・本塁打だけでなく、自チームの打撃成績・投手成績も
     載せる（played=trueの選手だけ。誰も出ていない項目は載せない）。
   ・共有・保存はどちらも navigator.share を、ユーザー操作から間を空けず
     同期的に呼ぶ（canvas.toBlob の待ちを挟むと、ブラウザによっては
     「ユーザー操作からの呼び出し」と認められず共有シートが出せない）。
     そのため画像は toDataURL で同期的に作り、共有シートが使えない環境
     （PCや、Web Shareを許可されない埋め込み先）でだけ window.claude の
     downloads 機能や新規タブへフォールバックする。
   ================================================== */
'use strict';

const Share = (() => {

  const COLW = 900;

  /** dataURL（同期で作れる）から Blob を同期的に作る */
  function dataUrlToBlob(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const meta = dataUrl.slice(5, comma);       // "image/png;base64"
    const mime = meta.split(';')[0];
    const bin = atob(dataUrl.slice(comma + 1));
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  /** その試合で出場した選手だけの打撃成績（打数0の選手は載せない） */
  function battingLines(team) {
    return (team.batters || []).filter((p) => p.game && p.game.pa > 0).map((p) => {
      const g = p.game;
      let line = g.ab + '打数' + g.h + '安打';
      if (g.hr) line += ' ' + g.hr + '本塁打';
      if (g.rbi) line += ' ' + g.rbi + '打点';
      return { name: p.name, line };
    });
  }

  /** その試合で投げた投手だけの投球成績 */
  function pitchingLines(team) {
    return (team.pitchers || []).filter((p) => p.game && p.game.outs > 0).map((p) => {
      const g = p.game;
      const ip = Math.floor(g.outs / 3) + (g.outs % 3 ? ' ' + g.outs % 3 + '/3' : '');
      return { name: p.name, line: ip + '回 ' + g.h + '安打 ' + g.so + '奪三振 ' + g.er + '自責' };
    });
  }

  /** 打席結果の一覧（結果画面の「打席結果」と同じ中身）。
      sim が無い（途中から開き直したなど）ときは null を返し、呼ぶ側で省く */
  function paGrid(state, sim) {
    if (!sim || !sim.res || !sim.res.log) return null;
    const res = sim.res, team = state.team;
    const byPid = {};
    res.log.forEach((e) => {
      if (e.k !== 'pa' || !e.batter) return;
      const m = (byPid[e.batter] = byPid[e.batter] || {});
      (m[e.inning] = m[e.inning] || []).push(e);
    });
    const innings = Math.max(9, res.innings || 9);
    const order = (team.lineup || []).map((sl) => ({ p: Team.find(team, sl.pid), pos: sl.pos }))
      .filter((x) => x.p);
    const extra = (team.batters || [])
      .filter((p) => byPid[p.id] && !order.some((x) => x.p.id === p.id))
      .map((p) => ({ p, pos: p.pos }));
    const rows = order.concat(extra).map((x, i) => ({
      no: i < 9 ? String(i + 1) : '―',
      pos: posShort(x.pos),
      name: x.p.name,
      cells: Array.from({ length: innings }, (_, k) => (byPid[x.p.id] || {})[k + 1] || []),
    }));
    return { innings, rows };
  }

  /** イニングごとのスコアボード（結果画面と同じ。R・H・E つき） */
  function boardOf(sim) {
    if (!sim || !sim.res) return null;
    const res = sim.res;
    const n = Math.max(9, res.innings || 9);
    const line = (side) => ({
      name: side.team.name,
      cells: Array.from({ length: n }, (_, i) => {
        const v = side.byInning[i];
        return v == null ? (i < res.innings ? '×' : '') : String(v);
      }),
      r: String(side.runs), h: String(side.hits), e: String(side.errors),
    });
    return { n, rows: [line(res.away), line(res.home)] };
  }

  /** state から共有カードを1枚の canvas に描く。高さは中身に合わせて伸ばす。
      結果画面の内容（勝敗・スコア・勝敗投手と本塁打・イニング別のスコアボード・
      打席結果・投手成績）を1枚にまとめる */
  function draw(state, sim) {
    const r = state.lastResult;
    const win = r.win;
    const isBigStage = state.tour && ['national', 'spring', 'fallJingu'].indexOf(state.tour.kind) >= 0;
    /* 大会の決勝に勝った（優勝）ときだけ、特別版にする */
    const champ = !!(win && r.last);
    const accent = champ ? '#b07d0a' : (isBigStage ? '#8f2233' : '#1d5c3a');
    const ink = '#16181a', mute = '#6b7076', faint = '#979ba1', rule = '#e4e0d6', hot = '#c0283c';

    const who = (d) => d ? d.name : null;
    const decisions = [];
    if (r.winPitcher) decisions.push('勝投手　' + who(r.winPitcher));
    if (r.losePitcher) decisions.push('敗投手　' + who(r.losePitcher));
    if (r.savePitcher) decisions.push('セーブ　' + who(r.savePitcher));
    if (r.homers && r.homers.length) {
      decisions.push('本塁打　' + r.homers.map((h) => who(h) + (h.hr > 1 ? '×' + h.hr : '')).join('　'));
    }
    (r.extraLines || []).forEach((l) => decisions.push(l));    // サッカーの得点者など
    const board = boardOf(sim);
    const grid = paGrid(state, sim);
    const pit = pitchingLines(state.team);
    const bat = grid ? [] : battingLines(state.team);   // 打席結果があれば、打撃の一覧は要らない

    const padX = 30, W = COLW;
    const lineH = 30;
    const gridRowH = (row) => Math.max(1, ...row.cells.map((c) => c.length)) * 20 + 14;

    /* 高さを先に数える */
    let H = 70 + 80 + 70 + 24;                         // 見出し・勝敗・スコア
    if (r.cold || r.walkoff || r.note) H += 28;
    H += decisions.length * 28 + 14;
    if (board) H += 40 + 3 * 34 + 14;
    if (grid) H += 46 + 54 + grid.rows.reduce((a, row) => a + gridRowH(row), 0);
    if (bat.length) H += 46 + bat.length * lineH;
    if (pit.length) H += 46 + pit.length * lineH;
    H += 84;

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const FONT = 'sans-serif';

    ctx.fillStyle = champ ? '#fff7dc' : '#faf9f5';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = accent; ctx.lineWidth = champ ? 14 : 10;
    ctx.strokeRect(7, 7, W - 14, H - 14);
    if (champ) {
      ctx.lineWidth = 3; ctx.strokeStyle = '#e3b64a';
      ctx.strokeRect(22, 22, W - 44, H - 44);
      /* 紙吹雪。決まった並びで散らす（同じ試合なら毎回同じ絵になる） */
      const cols = ['#e3b64a', '#e5483c', '#2f6fe4', '#6bbf8a', '#ffffff'];
      let seed = 7;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      for (let i = 0; i < 70; i++) {
        ctx.fillStyle = cols[i % cols.length];
        const x = 40 + rnd() * (W - 80), y = 40 + rnd() * 300;
        ctx.save(); ctx.translate(x, y); ctx.rotate(rnd() * Math.PI);
        ctx.fillRect(-5, -2.5, 10, 5); ctx.restore();
      }
    }

    /* 文字を、決まった幅に収まる大きさで描く */
    const fit = (text, x, y, maxW, size, align) => {
      let px = size;
      ctx.font = px + 'px ' + FONT;
      while (px > 9 && ctx.measureText(text).width > maxW) { px -= 1; ctx.font = px + 'px ' + FONT; }
      ctx.textAlign = align || 'left';
      ctx.fillText(text, x, y);
    };
    const hline = (y) => {
      ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(W - padX, y);
      ctx.strokeStyle = rule; ctx.lineWidth = 1; ctx.stroke();
    };
    const heading = (title, y) => {
      ctx.fillStyle = accent; ctx.font = 'bold 20px ' + FONT; ctx.textAlign = 'left';
      ctx.fillText(title, padX, y);
      hline(y + 10);
    };

    /* 見出し・勝敗・スコア */
    let y = 64;
    ctx.fillStyle = faint; ctx.textAlign = 'center'; ctx.font = '20px ' + FONT;
    ctx.fillText(String(r.tourName || '') + '　' + String(r.round || ''), W / 2, y);
    y += 80;
    ctx.fillStyle = accent; ctx.font = 'bold ' + (champ ? 88 : 64) + 'px ' + FONT;
    ctx.fillText(champ ? '優勝' : (win ? '勝利' : '敗戦'), W / 2, y);
    y += 70;
    ctx.fillStyle = ink; ctx.font = 'bold 30px ' + FONT;
    const myName = (state.team && state.team.name) || '';
    ctx.fillText(myName + '  ' + r.myRuns + ' - ' + r.opRuns + '  ' + (r.oppName || ''), W / 2, y);
    if (champ) {
      y += 32; ctx.font = 'bold 22px ' + FONT; ctx.fillStyle = accent;
      ctx.fillText(String(r.tourName || '') + ' 制覇　おめでとう！', W / 2, y);
    } else if (r.cold || r.walkoff || r.note) {
      y += 30; ctx.font = '18px ' + FONT; ctx.fillStyle = mute;
      ctx.fillText(r.note || (r.cold ? 'コールドゲーム' : 'サヨナラ'), W / 2, y);
    }
    y += 20;
    ctx.font = '18px ' + FONT; ctx.fillStyle = mute; ctx.textAlign = 'center';
    decisions.forEach((line) => { y += 28; ctx.fillText(line, W / 2, y); });
    y += 14;

    /* イニング別のスコアボード */
    if (board) {
      y += 40;
      const nameW = 130, totW = 44;
      const innW = (W - padX * 2 - nameW - totW * 3) / board.n;
      ctx.fillStyle = faint; ctx.font = '16px ' + FONT; ctx.textAlign = 'center';
      for (let i = 0; i < board.n; i++) ctx.fillText(String(i + 1), padX + nameW + innW * (i + 0.5), y);
      ['R', 'H', 'E'].forEach((h, k) => ctx.fillText(h, padX + nameW + innW * board.n + totW * (k + 0.5), y));
      hline(y + 10);
      board.rows.forEach((row) => {
        y += 34;
        ctx.fillStyle = ink; ctx.textAlign = 'left';
        fit(row.name, padX, y, nameW - 8, 18, 'left');
        ctx.fillStyle = ink; ctx.font = '18px ' + FONT; ctx.textAlign = 'center';
        row.cells.forEach((c, i) => ctx.fillText(c, padX + nameW + innW * (i + 0.5), y));
        ctx.font = 'bold 18px ' + FONT;
        [row.r, row.h, row.e].forEach((v, k) =>
          ctx.fillText(v, padX + nameW + innW * board.n + totW * (k + 0.5), y));
      });
      hline(y + 12);
      y += 14;
    }

    /* 打席結果（結果画面の一覧と同じ並び） */
    if (grid) {
      y += 46;
      heading(myName + '　打席結果', y);
      const noW = 30, posW = 34, nameW = 138;
      const innW = (W - padX * 2 - noW - posW - nameW) / grid.innings;
      y += 30;
      ctx.fillStyle = faint; ctx.font = '15px ' + FONT; ctx.textAlign = 'center';
      for (let i = 0; i < grid.innings; i++) {
        ctx.fillText(String(i + 1), padX + noW + posW + nameW + innW * (i + 0.5), y);
      }
      y += 24;
      grid.rows.forEach((row, ri) => {
        const rh = gridRowH(row);
        const top = y - 12;
        if (ri % 2 === 0) { ctx.fillStyle = 'rgba(0,0,0,.03)'; ctx.fillRect(padX, top, W - padX * 2, rh); }
        const mid = top + rh / 2 + 6;
        ctx.fillStyle = faint; ctx.font = '15px ' + FONT; ctx.textAlign = 'center';
        ctx.fillText(row.no, padX + noW / 2, mid);
        ctx.fillStyle = mute;
        ctx.fillText(row.pos, padX + noW + posW / 2, mid);
        ctx.fillStyle = ink;
        fit(row.name, padX + noW + posW, mid, nameW - 8, 17, 'left');
        row.cells.forEach((list, i) => {
          const cx = padX + noW + posW + nameW + innW * (i + 0.5);
          list.forEach((e, k) => {
            const label = e.text + (e.runs ? '+' + e.runs : '');
            ctx.fillStyle = e.runs ? hot : ink;
            fit(label, cx, top + 24 + k * 20, innW - 4, 15, 'center');
          });
        });
        y += rh;
      });
      y += 0;
    }

    /* 打席結果が出せないとき（途中から開き直したなど）だけ、打撃の一覧を載せる */
    const lines = (title, rows) => {
      if (!rows.length) return;
      y += 46;
      heading(title, y);
      y += 8;
      rows.forEach((row) => {
        y += lineH;
        ctx.fillStyle = ink; ctx.font = '17px ' + FONT; ctx.textAlign = 'left';
        ctx.fillText(row.name, padX + 30, y);
        ctx.fillStyle = mute; ctx.textAlign = 'right';
        ctx.fillText(row.line, W - padX - 30, y);
      });
      y -= 0;
    };
    lines('打撃成績', bat);
    lines('投手成績', pit);

    ctx.textAlign = 'center'; ctx.font = '16px ' + FONT; ctx.fillStyle = faint;
    ctx.fillText('強奪高校野球', W / 2, H - 22);
    return cv;
  }

  /** canvas を、ユーザー操作からの呼び出しとして扱われる形のまま
      File にする（同期。toBlob の非同期な待ちを挟まない） */
  function toFile(canvas, filename) {
    const dataUrl = canvas.toDataURL('image/png');
    const blob = dataUrlToBlob(dataUrl);
    return new File([blob], filename, { type: 'image/png' });
  }

  const FILE_NAME = '強奪高校野球.png';
  const SITE_URL = 'https://baseball.roomhaird.com/highschool/';
  let pending = null;     // 開いているプレビューの画像（dataURL と File）

  /** 共有に添える文章（野球チームメーカーと同じ作り：結果・ひとこと・サイトのURL） */
  function shareText(state) {
    const r = state.lastResult;
    const my = (state.team && state.team.name) || '';
    const champ = r.win && r.last;
    const lines = [
      '強奪高校野球で ' + (r.tourName || '') + ' ' + (r.round || '') + ' を戦った結果……',
      '',
      my + ' ' + r.myRuns + ' - ' + r.opRuns + ' ' + (r.oppName || ''),
      champ ? (r.tourName || '') + 'を制して優勝しました！🏆' : (r.win ? '勝利！' : '敗戦…'),
      '',
      'あなたもこの高校を勝たせられますか？',
    ];
    return lines.join('\n');
  }

  function canShareFile(file) {
    return !!(file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] }));
  }

  function xIntent(text) {
    const href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(SITE_URL);
    try { window.open(href, '_blank', 'noopener'); } catch (e) { /* 開けない環境では諦める */ }
  }

  function downloadImage(dataUrl) {
    const a = document.createElement('a');
    a.href = dataUrl; a.download = FILE_NAME;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  /** 画像を端末に保存する。共有シートが使えるときは、その中の「画像を保存」で
      カメラロールに入る。使えないとき（パソコンなど）はファイルとして保存する */
  function saveNow() {
    if (!pending) return;
    const p = pending;
    if (canShareFile(p.file)) {
      navigator.share({ files: [p.file] }).catch((e) => { if (!e || e.name !== 'AbortError') downloadImage(p.dataUrl); });
      return;
    }
    downloadImage(p.dataUrl);
  }

  /** SNSに共有する。画像ごと渡せる環境ではそれを、無理なら文章とURLだけでXの投稿画面を開く
      （どちらの道でも、投稿を確定するのは自分） */
  function shareNow(state) {
    if (!pending) return;
    const p = pending;
    const text = shareText(state);
    if (canShareFile(p.file)) {
      navigator.share({ files: [p.file], text: text + '\n' + SITE_URL }).catch((e) => { if (!e || e.name !== 'AbortError') xIntent(text); });
      return;
    }
    xIntent(text);
  }

  /** 作った画像を見せて、「共有」「保存」「キャンセル」を選ばせる。
      File は先に作っておく（Safari はボタンを押した流れから外れると共有シートを開かないため） */
  function preview(state, sim, mode) {
    const canvas = draw(state, sim);
    const dataUrl = canvas.toDataURL('image/png');
    pending = { dataUrl, file: null };
    if (canvas.toBlob && typeof File === 'function') {
      canvas.toBlob((blob) => {
        try { if (blob && pending && pending.dataUrl === dataUrl) pending.file = new File([blob], FILE_NAME, { type: 'image/png' }); } catch (e) { /* 保存リンクのほうを使う */ }
      }, 'image/png');
    }
    const first = mode === 'save' ? 'save' : 'share';
    UI.modal(
      '<div class="sharepv"><img alt="作った共有画像" src="' + dataUrl + '"></div>' +
      '<div class="actions actions--modal sharepv__actions">' +
        '<button type="button" class="btn' + (first === 'share' ? ' btn--primary' : '') + '" id="sh-share">共有</button>' +
        '<button type="button" class="btn' + (first === 'save' ? ' btn--primary' : '') + '" id="sh-save">保存</button>' +
        '<button type="button" class="btn" id="sh-cancel">キャンセル</button>' +
      '</div>',
      { kind: 'share', onOpen(body) {
        body.querySelector('#sh-share').addEventListener('click', () => shareNow(state));
        body.querySelector('#sh-save').addEventListener('click', saveNow);
        body.querySelector('#sh-cancel').addEventListener('click', () => { pending = null; UI.closeModal(); });
      } });
  }

  /** サッカーの結果を、野球の結果と同じ形に直して共有・保存の画像にする */
  function previewSoccer(state, res, mode) {
    const S = state.soccer;
    const isLast = S.tour.index >= S.tour.rounds.length - 1;
    const myKey = res.home ? 'home' : 'away';
    const scorers = {};
    res.events.filter((e) => e.kind === 'goal' && e.side === myKey)
      .forEach((e) => { scorers[e.name] = (scorers[e.name] || 0) + 1; });
    const names = Object.keys(scorers);
    const fake = {
      team: { name: S.schoolName, batters: [], pitchers: [] },
      tour: { kind: S.tour.kind },
      lastResult: {
        win: !!res.win, last: !!(res.win && isLast),
        tourName: Game.soccerLabel(S.tour.kind), round: res.roundName,
        myRuns: res.my, opRuns: res.op, oppName: res.oppName,
        note: res.pk ? 'PK戦 ' + (res.home ? res.pk.home : res.pk.away) + '−' + (res.home ? res.pk.away : res.pk.home)
          : (res.extra ? '延長戦' : ''),
        extraLines: names.length ? ['得点　' + names.map((n) => n + (scorers[n] > 1 ? '×' + scorers[n] : '')).join('　')] : [],
      },
    };
    preview(fake, null, mode);
  }

  return { preview, previewSoccer, draw };
})();
