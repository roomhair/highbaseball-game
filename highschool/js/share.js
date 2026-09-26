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

  /** state から共有カードを1枚の canvas に描く。高さは中身に合わせて伸ばす */
  function draw(state) {
    const r = state.lastResult;
    const win = r.win;
    const isNational = state.tour && state.tour.kind === 'national';
    const accent = isNational ? '#8f2233' : '#1d5c3a';
    const ink = '#16181a', mute = '#6b7076', faint = '#979ba1';

    const who = (d) => d ? d.name + (d.mine ? '' : '（相手）') : null;
    const decisions = [];
    if (r.winPitcher) decisions.push('勝投手　' + who(r.winPitcher));
    if (r.losePitcher) decisions.push('敗投手　' + who(r.losePitcher));
    if (r.savePitcher) decisions.push('セーブ　' + who(r.savePitcher));
    if (r.homers && r.homers.length) {
      decisions.push('本塁打　' + r.homers.map((h) => who(h) + (h.hr > 1 ? '×' + h.hr : '')).join('　'));
    }
    const bat = battingLines(state.team);
    const pit = pitchingLines(state.team);

    /* 高さは中身しだい。ヘッダ部分は固定、そのあとに打撃・投手の行数ぶんを足す */
    const lineH = 30;
    const headH = 330;
    const sectionGap = 46;
    let H = headH;
    if (bat.length) H += sectionGap + 8 + bat.length * lineH;
    if (pit.length) H += sectionGap + 8 + pit.length * lineH;
    H += 60;

    const cv = document.createElement('canvas');
    cv.width = COLW; cv.height = H;
    const ctx = cv.getContext('2d');

    /* 背景 */
    ctx.fillStyle = '#faf9f5';
    ctx.fillRect(0, 0, COLW, H);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, COLW - 10, H - 10);

    ctx.textAlign = 'center';
    ctx.fillStyle = faint;
    ctx.font = '20px sans-serif';
    ctx.fillText(String(r.tourName || '') + '　' + String(r.round || ''), COLW / 2, 70);

    ctx.fillStyle = accent;
    ctx.font = 'bold 64px sans-serif';
    ctx.fillText(win ? '勝利' : '敗戦', COLW / 2, 150);

    ctx.fillStyle = ink;
    ctx.font = 'bold 30px sans-serif';
    const myName = (state.team && state.team.name) || '';
    const opName = r.oppName || '';
    ctx.fillText(myName + '  ' + r.myRuns + ' - ' + r.opRuns + '  ' + opName, COLW / 2, 220);

    if (r.cold) { ctx.font = '18px sans-serif'; ctx.fillStyle = mute; ctx.fillText('コールドゲーム', COLW / 2, 252); }
    else if (r.walkoff) { ctx.font = '18px sans-serif'; ctx.fillStyle = mute; ctx.fillText('サヨナラ', COLW / 2, 252); }

    ctx.font = '18px sans-serif';
    ctx.fillStyle = mute;
    decisions.forEach((line, i) => ctx.fillText(line, COLW / 2, 300 + i * 28));

    /* 打撃成績・投手成績は左寄せの一覧で（名前と数字を並べるため） */
    const padX = 60;
    let y = headH;
    function section(title, rows) {
      if (!rows.length) return;
      y += sectionGap;
      ctx.textAlign = 'left';
      ctx.fillStyle = accent;
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(title, padX, y);
      y += 8;
      ctx.beginPath(); ctx.moveTo(padX, y + 6); ctx.lineTo(COLW - padX, y + 6);
      ctx.strokeStyle = '#e4e0d6'; ctx.lineWidth = 1; ctx.stroke();
      y += lineH;
      ctx.font = '17px sans-serif';
      rows.forEach((row) => {
        ctx.fillStyle = ink;
        ctx.textAlign = 'left';
        ctx.fillText(row.name, padX, y);
        ctx.fillStyle = mute;
        ctx.textAlign = 'right';
        ctx.fillText(row.line, COLW - padX, y);
        y += lineH;
      });
      y -= lineH;
    }
    section('打撃成績', bat);
    section('投手成績', pit);

    ctx.textAlign = 'center';
    ctx.font = '16px sans-serif';
    ctx.fillStyle = faint;
    ctx.fillText('強奪高校野球', COLW / 2, H - 24);

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
  function saveImage(state) {
    const canvas = draw(state);
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
  function shareResult(state) {
    const r = state.lastResult;
    const text = (state.team && state.team.name || '') + ' ' + r.myRuns + '-' + r.opRuns + ' ' +
      (r.oppName || '') + '　' + (r.win ? '勝利！' : '敗戦…') + '（強奪高校野球）';

    const canvas = draw(state);
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
