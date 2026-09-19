'use strict';

/* =========================================================
   広告・アフィリエイト枠

   独自ドメインが無くても出せるのは、Amazon アソシエイトや楽天アフィリエイトの
   ように「自分で受け取ったタグを貼る」形式の広告。ここはその前提で作ってある。
   AdSense は独自ドメインを取ってからでないと審査に出せないので、
   取れたときに AD_CONFIG.adsense.enabled を true にすれば同じ枠がそのまま使える。

   既定では enabled: false で枠ごと非表示。レイアウトにも表示にも影響しない。
   URL に ?adtest=1 を付けると、枠の位置だけ点線で確認できる。

   貼り方は README.md の「広告を出す」を参照。
   ========================================================= */

const AD_CONFIG = {
  enabled: true,                  // タグを入れ終えたら true

  /* 受け取った広告をここに並べる。キーの名前は自由。type は3種類。

     banner … 画像リンク（Amazon の「テキストと画像」「画像のみ」、楽天のバナー）
       { type: 'banner', href: 'リンク先', img: '画像URL',
         width: 300, height: 250, alt: '説明' }

     html … もらったタグをそのままページに置く（script を含まないもの向け）
       { type: 'html', html: '<table>…</table>', height: 280 }

     frame … もらったタグを iframe の中で動かす（script形式・document.write 対応）
       { type: 'frame', html: '<script>…</script>', width: 468, height: 60 }
       Cookie や localStorage を使うタグ（楽天モーションウィジェット等）は
       sameOrigin: true を付ける。付けないと読み込みに失敗することがある

     text … 文字リンク
       { type: 'text', href: 'リンク先', text: '表示する文字' }
  */
  /* AdSenseの審査が終わるまでのあいだ、楽天アフィリエイトを再開した。
     審査に通って広告ユニットを作ったら、下の adsense.slots にそのIDを
     入れる。そちらが埋まれば mount() は自動でAdSense優先に切り替わる
     （楽天とAdSenseの同時掲載自体はAdSenseの規約違反ではない）。 */
  creatives: {
    // 楽天モーションウィジェット（ページマッチ・468x160）
    // 見に来た人に合わせて商品が変わる。Cookie を使うので sameOrigin: true
    rakuten_motion: {
      type: 'frame',
      width: 468, height: 160,
      sameOrigin: true,
      html: `<script type="text/javascript">rakuten_design="slide";rakuten_affiliateId="5714127c.adfab8ed.5714127d.a8b025af";rakuten_items="ctsmatch";rakuten_genreId="0";rakuten_size="468x160";rakuten_target="_blank";rakuten_theme="gray";rakuten_border="off";rakuten_auto_mode="on";rakuten_genre_title="off";rakuten_recommend="on";rakuten_ts="1788388603440";</script><script type="text/javascript" src="https://xml.affiliate.rakuten.co.jp/widget/js/rakuten_widget.js?20230106"></script>`,
    },

    // 楽天アフィリエイト（商品リンク・画像とテキスト）
    rakuten_tomica: {
      type: 'html',
      height: 280,
      html: `<table border="0" cellpadding="0" cellspacing="0"><tr><td><div style="border:1px solid #95a5a6;border-radius:.75rem;background-color:#FFFFFF;width:504px;margin:0px;padding:5px;text-align:center;overflow:hidden;"><table><tr><td style="width:240px"><a href="https://hb.afl.rakuten.co.jp/ichiba/57117d99.52871760.57117d9a.44a9de93/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fbook%2F18291515%2F&link_type=picttext&ut=eyJwYWdlIjoiaXRlbSIsInR5cGUiOiJwaWN0dGV4dCIsInNpemUiOiIyNDB4MjQwIiwibmFtIjoxLCJuYW1wIjoicmlnaHQiLCJjb20iOjEsImNvbXAiOiJkb3duIiwicHJpY2UiOjEsImJvciI6MSwiY29sIjoxLCJiYnRuIjoxLCJwcm9kIjowLCJhbXAiOmZhbHNlfQ%3D%3D" target="_blank" rel="nofollow sponsored noopener" style="word-wrap:break-word;"><img src="https://hbb.afl.rakuten.co.jp/hgb/57117d99.52871760.57117d9a.44a9de93/?me_id=1213310&item_id=21661663&pc=https%3A%2F%2Fthumbnail.image.rakuten.co.jp%2F%400_mall%2Fbook%2Fcabinet%2F8902%2F4907953758902_1_2.jpg%3F_ex%3D240x240&s=240x240&t=picttext" border="0" style="margin:2px" alt="[商品価格に関しましては、リンクが作成された時点と現時点で情報が変更されている場合がございます。]" title="[商品価格に関しましては、リンクが作成された時点と現時点で情報が変更されている場合がございます。]"></a></td><td style="vertical-align:top;width:248px;display: block;"><p style="font-size:12px;line-height:1.4em;text-align:left;margin:0px;padding:2px 6px;word-wrap:break-word"><a href="https://hb.afl.rakuten.co.jp/ichiba/57117d99.52871760.57117d9a.44a9de93/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fbook%2F18291515%2F&link_type=picttext&ut=eyJwYWdlIjoiaXRlbSIsInR5cGUiOiJwaWN0dGV4dCIsInNpemUiOiIyNDB4MjQwIiwibmFtIjoxLCJuYW1wIjoicmlnaHQiLCJjb20iOjEsImNvbXAiOiJkb3duIiwicHJpY2UiOjEsImJvciI6MSwiY29sIjoxLCJiYnRuIjoxLCJwcm9kIjowLCJhbXAiOmZhbHNlfQ%3D%3D" target="_blank" rel="nofollow sponsored noopener" style="word-wrap:break-word;">【セット】プロ野球トミカ2025 パ・リーグアソート2</a><br><span >価格：4,356円（税込、送料無料)</span> <span style="color:#BBB">(2026/9/2時点)</span></p><div style="margin:10px;"><a href="https://hb.afl.rakuten.co.jp/ichiba/57117d99.52871760.57117d9a.44a9de93/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fbook%2F18291515%2F&link_type=picttext&ut=eyJwYWdlIjoiaXRlbSIsInR5cGUiOiJwaWN0dGV4dCIsInNpemUiOiIyNDB4MjQwIiwibmFtIjoxLCJuYW1wIjoicmlnaHQiLCJjb20iOjEsImNvbXAiOiJkb3duIiwicHJpY2UiOjEsImJvciI6MSwiY29sIjoxLCJiYnRuIjoxLCJwcm9kIjowLCJhbXAiOmZhbHNlfQ%3D%3D" target="_blank" rel="nofollow sponsored noopener" style="word-wrap:break-word;"><img src="https://static.affiliate.rakuten.co.jp/makelink/rl.svg" style="float:left;max-height:27px;width:auto;margin-top:0" ></a><a href="https://hb.afl.rakuten.co.jp/ichiba/57117d99.52871760.57117d9a.44a9de93/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fbook%2F18291515%2F%3Fscid%3Daf_pc_bbtn&link_type=picttext&ut=eyJwYWdlIjoiaXRlbSIsInR5cGUiOiJwaWN0dGV4dCIsInNpemUiOiIyNDB4MjQwIiwibmFtIjoxLCJuYW1wIjoicmlnaHQiLCJjb20iOjEsImNvbXAiOiJkb3duIiwicHJpY2UiOjEsImJvciI6MSwiY29sIjoxLCJiYnRuIjoxLCJwcm9kIjowLCJhbXAiOmZhbHNlfQ==" target="_blank" rel="nofollow sponsored noopener" style="word-wrap:break-word;"><div style="float:right;width:41%;height:27px;background-color:#bf0000;color:#fff!important;font-size:12px;font-weight:500;line-height:27px;margin-left:1px;padding: 0 12px;border-radius:16px;cursor:pointer;text-align:center;"> 楽天で購入 </div></a></div></td></tr></table></div><br><p style="color:#000000;font-size:12px;line-height:1.4em;margin:5px;word-wrap:break-word"></p></td></tr></table>`,
    },
  },

  slots: {
    top:    ['rakuten_motion'],                      // ヘッダー下（全画面）
    result: ['rakuten_motion', 'rakuten_tomica'],    // 結果画面のスコア下
    footer: ['rakuten_motion'],                      // フッター上（全画面）
  },

  /* enabled を true にすると、creatives より AdSense が優先される。
     いまは adsense.slots が空なので、上の creatives（楽天）が使われる。 */
  adsense: {
    enabled: true,
    client: 'ca-pub-1646091398696967',
    // 広告ユニットを作ったら、ここにそれぞれのスロットIDを入れる。
    slots: { top: '', result: '', footer: '' },
  },
};

/* 解答ボタンのすぐ隣には枠を置かない。
   誤タップは無効なクリックとして扱われ、アフィリエイトでも AdSense でも
   規約違反になるため、枠は #app の外側（ヘッダー下・フッター上）と
   結果画面のスコア下だけに限る。 */
const AD_PLACEMENTS = [
  { id: 'ad-top',    slotKey: 'top' },
  { id: 'ad-result', slotKey: 'result' },
  { id: 'ad-footer', slotKey: 'footer' },
];

const ADS = (() => {
  const isTest = new URLSearchParams(location.search).get('adtest') === '1';
  let scriptLoaded = false;
  let shown = 0;

  /* ---------- 共通 ---------- */

  function bodyOf(el) {
    const body = el.querySelector('.ad-body');
    body.textContent = '';
    return body;
  }

  // 配信が始まっても本文がずれないよう、先に高さを取っておく
  function reserve(body, height) {
    if (height > 0) body.style.minHeight = height + 'px';
  }

  function show(el) {
    el.hidden = false;
    shown += 1;
  }

  function fillPlaceholder(el, text) {
    el.classList.add('is-placeholder');
    bodyOf(el).textContent = text;
    el.hidden = false;
  }

  function pick(list) {
    if (!Array.isArray(list) || list.length === 0) return null;
    const keys = list.filter((k) => AD_CONFIG.creatives[k]);
    if (keys.length === 0) return null;
    return AD_CONFIG.creatives[keys[Math.floor(Math.random() * keys.length)]];
  }

  /* ---------- 自分で貼るタグ（Amazon / 楽天 など） ---------- */

  function renderBanner(body, c) {
    const a = document.createElement('a');
    a.href = c.href;
    a.target = '_blank';
    a.rel = 'nofollow sponsored noopener';

    const img = document.createElement('img');
    img.src = c.img;
    img.alt = c.alt || '広告';
    img.loading = 'lazy';
    if (c.width) img.width = c.width;
    if (c.height) img.height = c.height;
    img.style.maxWidth = '100%';
    img.style.height = 'auto';

    a.appendChild(img);
    body.appendChild(a);
  }

  function renderText(body, c) {
    const a = document.createElement('a');
    a.href = c.href;
    a.target = '_blank';
    a.rel = 'nofollow sponsored noopener';
    a.textContent = c.text;
    body.appendChild(a);
  }

  /* もらったタグは幅が固定（504px や 468px）で作られていることが多い。
     枠に収まらないときは全体を縮小して、スマホでも切れないようにする。
     タグ自体は書き換えない。 */
  function fitBox(body, box, height) {
    let lastHeight = -1;
    const fit = () => {
      const avail = body.clientWidth;
      if (!avail) return;                          // 非表示のあいだは測れない
      box.style.transform = 'none';
      const natural = box.offsetWidth;
      if (!natural) return;
      const scale = Math.min(1, avail / natural);
      box.style.transform = scale < 1 ? `scale(${scale})` : 'none';
      box.style.margin = scale < 1 ? '0' : '0 auto';   // 収まるときは中央に置く
      // 設定した高さと実際の高さの大きいほうを採る（画像が入っても切れない）
      const h = Math.round(Math.max(height || 0, box.offsetHeight) * scale);
      if (h === lastHeight) return;
      lastHeight = h;
      body.style.height = h + 'px';
      body.style.minHeight = h + 'px';
    };

    fit();
    // 結果画面の枠は最初は非表示なので、表示されたときに測り直す
    if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(body);
    window.addEventListener('resize', fit);
    // 広告画像が遅れて届いたときも測り直す
    box.querySelectorAll('img').forEach((img) => {
      img.addEventListener('load', fit);
      img.addEventListener('error', fit);
    });
  }

  /* script を含まないタグは、そのままページに置く */
  function renderHtml(body, c) {
    const box = document.createElement('div');
    box.className = 'ad-scale';
    box.innerHTML = c.html;
    body.appendChild(box);
    fitBox(body, box, c.height);
  }

  /* script を含むタグは iframe の中で動かす。
     document.write を使うタグ（配信系のウィジェット）はページ読み込み後に
     そのまま実行できないので、iframe の中でだけ動かす。
     既定では隔離してあり、ページ本体の DOM や localStorage には触れられない。
     Cookie を必要とするタグは sameOrigin: true を付けて隔離を外す。 */
  function renderFrame(body, c) {
    const frame = document.createElement('iframe');
    frame.title = '広告';
    frame.scrolling = 'no';
    frame.setAttribute('frameborder', '0');
    frame.setAttribute(
      'sandbox',
      'allow-scripts allow-popups allow-popups-to-escape-sandbox' +
        (c.sameOrigin ? ' allow-same-origin' : '')
    );
    frame.style.border = '0';
    frame.style.display = 'block';
    frame.width = c.width || 300;
    frame.height = c.height || 250;
    frame.srcdoc =
      '<!doctype html><html lang="ja"><head><meta charset="utf-8">' +
      '<base target="_blank">' +
      '<style>html,body{margin:0;padding:0;overflow:hidden;' +
      'font-family:system-ui,sans-serif}</style></head><body>' +
      c.html + '</body></html>';

    // iframe は中身が固定幅なので、枠に入らないときは箱ごと縮める
    const box = document.createElement('div');
    box.className = 'ad-scale';
    box.appendChild(frame);
    body.appendChild(box);
    fitBox(body, box, c.height);
  }

  function renderCreative(el, c) {
    const body = bodyOf(el);
    if (c.type !== 'html' && c.type !== 'frame') reserve(body, c.height);
    if (c.type === 'banner') renderBanner(body, c);
    else if (c.type === 'text') renderText(body, c);
    else if (c.type === 'html') renderHtml(body, c);
    else if (c.type === 'frame') renderFrame(body, c);
    else return;
    show(el);
  }

  /* ---------- AdSense（独自ドメインを取ってから） ---------- */

  function loadAdSense() {
    if (scriptLoaded) return;
    scriptLoaded = true;
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' +
            encodeURIComponent(AD_CONFIG.adsense.client);
    document.head.appendChild(s);
  }

  function renderAdSense(el, slotId) {
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.dataset.adClient = AD_CONFIG.adsense.client;
    ins.dataset.adSlot = slotId;
    ins.dataset.adFormat = 'auto';
    ins.dataset.fullWidthResponsive = 'true';

    bodyOf(el).appendChild(ins);
    show(el);

    loadAdSense();
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (_) { /* ブロッカー等で失敗しても本体の動作は続ける */ }
  }

  /* ---------- 組み立て ---------- */

  function mount(place) {
    const el = document.getElementById(place.id);
    if (!el) return;

    if (!AD_CONFIG.enabled) {
      if (isTest) fillPlaceholder(el, `広告枠: ${place.id}`);
      return;
    }

    const ad = AD_CONFIG.adsense;
    if (ad.enabled && ad.slots[place.slotKey]) {
      renderAdSense(el, ad.slots[place.slotKey]);
      return;
    }

    const creative = pick(AD_CONFIG.slots[place.slotKey]);
    if (creative) renderCreative(el, creative);
    else if (isTest) fillPlaceholder(el, `広告枠: ${place.id}（未設定）`);
  }

  function init() {
    AD_PLACEMENTS.forEach(mount);
    // ステマ規制（景品表示法）対策。広告が1つでも出ているときだけ表示する
    const note = document.getElementById('ad-disclosure');
    if (note && shown > 0) note.hidden = false;
  }

  return { init };
})();
