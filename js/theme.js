'use strict';

/* 配色（ライト／ダーク）の切り替え。クイズ本体（js/app.js）と同じ鍵を使うので、
   ページをまたいでも設定が引き継がれる。
   ページが描かれる前に一度当てておきたいので、読み込みは末尾でも
   dataset.theme の設定だけは即座に行う。 */
(function () {
  const KEY = 'npbquiz.theme';

  const saved = (() => {
    try { return localStorage.getItem(KEY); } catch (_) { return null; }
  })();
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = saved || (dark ? 'dark' : 'light');

  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem(KEY, next); } catch (_) {}
    });
  }

  if (typeof ADS !== 'undefined') ADS.init();
})();
