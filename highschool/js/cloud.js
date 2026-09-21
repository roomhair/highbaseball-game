/* ==================================================
   高校野球  cloud.js

   消えない保存先。

   ふだん（本番サイト）は localStorage だけで足りる。
   ただし公開版は claude.ai の中の枠（iframe）で動くので、
   ブラウザによっては「よその組み込み」の保存領域として扱われ、
   しばらく放っておくと丸ごと捨てられてしまう。
   1時間ほど離席しただけで最初からになるのはこれが理由。

   そこで、枠の中で動いているときだけ、同じ中身をサーバー側にも
   置いておき、起動時にブラウザ側が空なら書き戻す。
   本番サイトには window.claude が無いので、ここは丸ごと何もしない。
   ================================================== */
'use strict';

const Cloud = (() => {

  let ready = null;      // 保存先を探す約束（一度だけ）
  let ref = null;        // 見つかった保存先
  let sending = false;   // 書き込み中か
  let pending = null;    // 書き込み中に来た、いちばん新しい中身
  let sent = '';         // 最後に送った中身（同じなら送らない）

  /** 動いている場所に保存先があるか調べる。無ければ null */
  function find() {
    if (ready) return ready;
    ready = (async () => {
      try {
        if (typeof window === 'undefined' || !window.claude ||
            typeof window.claude.use !== 'function') return null;
        const db = await window.claude.use('db');
        if (!db) return null;
        /* 人ごとに別の場所へ。同じ紹介を開いた別の人と混ざらないようにする。
           誰か分からないときは、みんなで1つの場所を使う */
        let path = 'saves/main';
        try {
          const user = await window.claude.use('user');
          const id = user && await user.id();
          if (id) path = 'data/users/' + id + '/save';
        } catch (e) { /* 分からなければ共通の場所のまま */ }
        ref = db.doc(path);
        return ref;
      } catch (e) {
        return null;
      }
    })();
    return ready;
  }

  /** 保存できる場所があるか（画面の案内に使う） */
  async function available() { return !!(await find()); }

  /** localStorage の中身をそのまま1つの文だけ送る */
  async function push(raw) {
    const r = await find();
    if (!r) return false;
    if (raw === sent) return true;
    if (sending) { pending = raw; return true; }   // 走っている書き込みの後で
    sending = true;
    try {
      await r.set({ raw: raw, at: Date.now() });
      sent = raw;
    } catch (e) {
      /* 書けなくても遊べなくはならない。次の保存でまた試す */
      console.warn('サーバー側に保存できませんでした', e);
    } finally {
      sending = false;
      const next = pending; pending = null;
      if (next && next !== sent) push(next);
    }
    return true;
  }

  /** 消す（「はじめから」を選んだとき） */
  async function wipe() {
    const r = await find();
    if (!r) return;
    sent = ''; pending = null;
    try { await r.delete(); } catch (e) { /* 消せなくても続けられる */ }
  }

  /**
   * 起動時に一度だけ。サーバー側のほうが新しければ、ブラウザ側に書き戻す。
   * 戻り値は「書き戻したか」。
   */
  async function restore() {
    const r = await find();
    if (!r) return false;
    let cloudRaw = '', cloudAt = 0;
    try {
      const snap = await r.get();
      if (!snap.exists) return false;
      const d = snap.data() || {};
      cloudRaw = typeof d.raw === 'string' ? d.raw : '';
      cloudAt = typeof d.at === 'number' ? d.at : 0;
    } catch (e) {
      return false;
    }
    if (!cloudRaw) return false;
    sent = cloudRaw;

    let hereRaw = '', hereAt = 0;
    try {
      hereRaw = localStorage.getItem(CONFIG.SAVE_KEY) || '';
      if (hereRaw) {
        const pack = JSON.parse(hereRaw);
        hereAt = (pack && typeof pack.at === 'number') ? pack.at : 0;
      }
    } catch (e) { hereRaw = ''; }

    if (hereRaw === cloudRaw) return false;
    /* ブラウザ側のほうが新しければ、そちらを正とする（別の端末で進めた場合） */
    if (hereRaw && hereAt >= cloudAt) { push(hereRaw); return false; }

    try {
      localStorage.setItem(CONFIG.SAVE_KEY, cloudRaw);
      return true;
    } catch (e) {
      return false;
    }
  }

  return { available, restore, push, wipe };
})();
