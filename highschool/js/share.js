/* ==================================================
   高校野球  share.js

   試合結果をSNSに共有するための画像づくり。
   外部ライブラリは使わず、<canvas> に直接描く。
   ・「画像を保存」は、まず端末の共有シート（Web Share API）を試す。
     iOS/Androidとも、画像だけを渡すと共有シートに「画像を保存」
     （写真・カメラロールへ直接保存）が出るので、それを選んでもらう。
     ファイルダウンロード（ダウンロードフォルダへ落ちる形）にはしない。
     共有シートが使えない環境（claude.aiのArtifact埋め込みなど）だけ、
     window.claude の downloads 機能にフォールバックする
     （それも無理ならPCのように新しいタブに開くだけにする）。
   ・「SNSに共有」も同じ共有シートを使うが、文章（スコアなど）も添える。
   ================================================== */
'use strict';

const Share = (() => {

  const W = 900, H = 500;

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** state.lastResult から共有カードを1枚の canvas に描く */
  function draw(state) {
    const r = state.lastResult;
    const win = r.win;
    const isNational = state.tour && state.tour.kind === 'national';
    const accent = isNational ? '#8f2233' : '#1d5c3a';

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');

    /* 背景 */
    ctx.fillStyle = '#faf9f5';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, W - 10, H - 10);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#979ba1';
    ctx.font = '20px sans-serif';
    ctx.fillText(String(r.tourName || '') + '　' + String(r.round || ''), W / 2, 70);

    ctx.fillStyle = accent;
    ctx.font = 'bold 64px sans-serif';
    ctx.fillText(win ? '勝利' : '敗戦', W / 2, 150);

    ctx.fillStyle = '#16181a';
    ctx.font = 'bold 30px sans-serif';
    const myName = (state.team && state.team.name) || '';
    const opName = r.oppName || '';
    ctx.fillText(myName + '  ' + r.myRuns + ' - ' + r.opRuns + '  ' + opName, W / 2, 220);

    if (r.cold) { ctx.font = '18px sans-serif'; ctx.fillStyle = '#6b7076'; ctx.fillText('コールドゲーム', W / 2, 252); }
    else if (r.walkoff) { ctx.font = '18px sans-serif'; ctx.fillStyle = '#6b7076'; ctx.fillText('サヨナラ', W / 2, 252); }

    /* 勝敗投手・セーブ・本塁打 */
    const who = (d) => d ? d.name + (d.mine ? '' : '（相手）') : null;
    const lines = [];
    if (r.winPitcher) lines.push('勝投手　' + who(r.winPitcher));
    if (r.losePitcher) lines.push('敗投手　' + who(r.losePitcher));
    if (r.savePitcher) lines.push('セーブ　' + who(r.savePitcher));
    if (r.homers && r.homers.length) {
      lines.push('本塁打　' + r.homers.map((h) => who(h) + (h.hr > 1 ? '×' + h.hr : '')).join('　'));
    }
    ctx.font = '18px sans-serif';
    ctx.fillStyle = '#6b7076';
    lines.forEach((line, i) => ctx.fillText(line, W / 2, 300 + i * 28));

    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#979ba1';
    ctx.fillText('強奪高校野球', W / 2, H - 34);

    return cv;
  }

  function toBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  /** 画像として保存する。
      共有シート（Web Share API）を最優先で試す。iOS/Androidとも、
      画像だけを渡すと共有シートに「画像を保存」＝カメラロールへの
      直接保存が出てくるので、ファイルダウンロードよりもこちらが素直。
      共有シートが使えない環境（Artifact埋め込みなど）だけ、
      window.claude の downloads 機能、それも無理ならPCのように
      新しいタブに開くだけ、の順にフォールバックする。 */
  async function saveImage(state) {
    const canvas = draw(state);
    const blob = await toBlob(canvas);
    if (!blob) return;
    const filename = '強奪高校野球.png';

    if (navigator.canShare && navigator.share) {
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); return; } catch (e) { /* キャンセルはそのまま */ return; }
      }
    }

    if (window.claude && window.claude.use) {
      try {
        const downloads = await window.claude.use('downloads');
        if (downloads) { await downloads.save({ filename, data: blob }); return; }
      } catch (e) { /* 断られた・使えない環境では下のフォールバックへ */ }
    }

    /* 共有シートも downloads も無い環境（主にPC）は、画像を新しいタブに
       開くだけにする。ここで <a download> は使わない
       （それがまさに「ファイルダウンロード」なので） */
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  /** SNSに共有する。画像ごと渡せる環境ではそれを、無理なら文章だけ */
  async function shareResult(state) {
    const r = state.lastResult;
    const text = (state.team && state.team.name || '') + ' ' + r.myRuns + '-' + r.opRuns + ' ' +
      (r.oppName || '') + '　' + (r.win ? '勝利！' : '敗戦…') + '（強奪高校野球）';

    const canvas = draw(state);
    const blob = await toBlob(canvas);
    if (blob && navigator.canShare && navigator.share) {
      const file = new File([blob], '強奪高校野球.png', { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], text }); return; } catch (e) { /* キャンセルなどは無視 */ return; }
      }
    }
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch (e) { return; }
    }
    /* Web Share が無い環境（主にPC）は、Xの投稿画面を新しいタブで開く。
       サンドボックスされた埋め込み先などでは window.open 自体が失敗することもある */
    const url = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text);
    try { window.open(url, '_blank', 'noopener'); } catch (e) { /* 開けない環境では諦める */ }
  }

  return { saveImage, shareResult };
})();
