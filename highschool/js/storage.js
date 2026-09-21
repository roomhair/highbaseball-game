/* ==================================================
   高校野球  storage.js

   途中経過をブラウザに保存する。閉じても続きから遊べるように。
   ・保存できない設定（プライベートモード等）でも、遊べなくはならない。
   ・設定（乙大人園の名前など）は、ゲームを最初からやり直しても
     残しておきたいので別の鍵に分けてある。
   ================================================== */
'use strict';

const Storage = {

  save(state) {
    try {
      const raw = JSON.stringify({
        v: CONFIG.SAVE_VERSION,
        seq: Player.currentSeq(),
        at: Date.now(),          // どちらが新しいかを見分けるため
        d: state,
      });
      localStorage.setItem(CONFIG.SAVE_KEY, raw);
      /* 公開版では、消えない場所にも同じ中身を置いておく。
         本番サイトでは Cloud が何もしないので、ここは素通りする */
      if (typeof Cloud !== 'undefined') Cloud.push(raw);
      return true;
    } catch (e) {
      console.warn('保存できませんでした', e);
      return false;
    }
  },

  load() {
    try {
      const raw = localStorage.getItem(CONFIG.SAVE_KEY);
      if (!raw) return null;
      const pack = JSON.parse(raw);
      if (!pack || pack.v !== CONFIG.SAVE_VERSION || !pack.d) return null;
      if (pack.seq) Player.setSeq(pack.seq);
      return pack.d;
    } catch (e) {
      this.clear();
      return null;
    }
  },

  clear() {
    try { localStorage.removeItem(CONFIG.SAVE_KEY); } catch (e) { /* 何もしない */ }
    if (typeof Cloud !== 'undefined') Cloud.wipe();
  },

  loadSettings() {
    const base = Object.assign({}, CONFIG.DEFAULTS);
    try {
      const raw = localStorage.getItem(CONFIG.SETTINGS_KEY);
      if (raw) Object.assign(base, JSON.parse(raw) || {});
    } catch (e) { /* 既定のまま */ }
    return base;
  },

  saveSettings(settings) {
    try {
      localStorage.setItem(CONFIG.SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) { /* 保存できなくても続けられる */ }
  },
};
