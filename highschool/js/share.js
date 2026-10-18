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
    const accent = isBigStage ? '#8f2233' : '#1d5c3a';
    const ink = '#16181a', mute = '#6b7076', faint = '#979ba1', rule = '#e4e0d6', hot = '#c0283c';

    const who = (d) => d ? d.name : null;
    const decisions = [];
    if (r.winPitcher) decisions.push('勝投手　' + who(r.winPitcher));
    if (r.losePitcher) decisions.push('敗投手　' + who(r.losePitcher));
    if (r.savePitcher) decisions.push('セーブ　' + who(r.savePitcher));
    if (r.homers && r.homers.length) {
      decisions.push('本塁打　' + r.homers.map((h) => who(h) + (h.hr > 1 ? '×' + h.hr : '')).join('　'));
    }
    const board = boardOf(sim);
    const grid = paGrid(state, sim);
    const pit = pitchingLines(state.team);
    const bat = grid ? [] : battingLines(state.team);   // 打席結果があれば、打撃の一覧は要らない

    const padX = 30, W = COLW;
    const lineH = 30;
    const gridRowH = (row) => Math.max(1, ...row.cells.map((c) => c.length)) * 20 + 14;

    /* 高さを先に数える */
    let H = 70 + 80 + 70 + 24;                         // 見出し・勝敗・スコア
    if (r.cold || r.walkoff) H += 28;
    H += decisions.length * 28 + 14;
    if (board) H += 40 + 3 * 34 + 14;
    if (grid) H += 46 + 54 + grid.rows.reduce((a, row) => a + gridRowH(row), 0);
    if (bat.length) H += 46 + bat.length * lineH;
    if (pit.length) H += 46 + pit.length * lineH;
    H += 56;

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const FONT = 'sans-serif';

    ctx.fillStyle = '#faf9f5';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = accent; ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, W - 10, H - 10);

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
    ctx.fillStyle = accent; ctx.font = 'bold 64px ' + FONT;
    ctx.fillText(win ? '勝利' : '敗戦', W / 2, y);
    y += 70;
    ctx.fillStyle = ink; ctx.font = 'bold 30px ' + FONT;
    const myName = (state.team && state.team.name) || '';
    ctx.fillText(myName + '  ' + r.myRuns + ' - ' + r.opRuns + '  ' + (r.oppName || ''), W / 2, y);
    if (r.cold || r.walkoff) {
      y += 30; ctx.font = '18px ' + FONT; ctx.fillStyle = mute;
      ctx.fillText(r.cold ? 'コールドゲーム' : 'サヨナラ', W / 2, y);
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

  /** 共有シートも downloads も無い環境（主にPC）向けのフォールバック */
  async function fallbackSave(file) {
    if (window.claude && window.claude.use) {
      try {
        const downloads = await window.claude.use('downloads');
        if (downloads) { await downloads.save({ filename: file.name, data: file }); return; }
      } catch (e) { /* 断られた・使えない環境では下のフォールバックへ */ }
    }
    /* ここで <a download> は使わない（それがまさに「ファイルダウンロード」なので）。
       新しいタブに開くだけにして、保存するかは見る人に委ねる */
    const url = URL.createObjectURL(file);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  /** 画像として保存する。
      navigator.share は「ユーザー操作から直接呼ばれたか」をブラウザが見ているため、
      ボタンを押した同期の流れの中で（await を挟まずに）呼ぶ。
      1枚待ってから呼ぶと、呼び出しが認められず共有シートが開かないことがある。
      iOS/Androidの共有シートには「画像を保存」＝カメラロールへの直接保存が
      出るので、ファイルダウンロードよりもこちらが素直。
      共有シートが使えない環境（Artifact埋め込みなど）だけ、
      window.claude の downloads 機能、それも無理ならPCのように
      新しいタブに開くだけ、の順にフォールバックする。 */
  function saveImage(state, sim) {
    const canvas = draw(state, sim);
    const file = toFile(canvas, '強奪高校野球.png');

    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).catch(() => {});
      return;
    }
    fallbackSave(file);
  }

  /** SNSに共有する。画像ごと渡せる環境ではそれを、無理なら文章だけ。
      saveImage と同じ理由で、navigator.share はボタンを押した同期の
      流れの中で呼ぶ（canvas.toBlob の非同期な待ちを挟まない）。 */
  function shareResult(state, sim) {
    const r = state.lastResult;
    const text = (state.team && state.team.name || '') + ' ' + r.myRuns + '-' + r.opRuns + ' ' +
      (r.oppName || '') + '　' + (r.win ? '勝利！' : '敗戦…') + '（強奪高校野球）';

    const canvas = draw(state, sim);
    const file = toFile(canvas, '強奪高校野球.png');

    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], text }).catch(() => {});
      return;
    }
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
      return;
    }
    /* Web Share が無い環境（主にPC）は、Xの投稿画面を新しいタブで開く。
       サンドボックスされた埋め込み先などでは window.open 自体が失敗することもある */
    const url = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text);
    try { window.open(url, '_blank', 'noopener'); } catch (e) { /* 開けない環境では諦める */ }
  }

  return { saveImage, shareResult };
})();
