/* ==================================================
   高校野球  config.js

   ゲーム全体で使う定数。数字をいじりたくなったら、まずここを見る。
   ・能力値は 1〜100 の素の数字で持ち、表示のときだけ S〜G に直す。
     （内部で文字にしてしまうと、特訓で +3 するような計算ができない）
   ・「乙大人園」は全国大会の名前。権利のからむ実名は使わないので、
     既定の名前もユーザーが設定画面から変えられるようにしてある。
   ================================================== */
'use strict';

const CONFIG = {
  SAVE_KEY: 'hsbaseball.save',
  SAVE_VERSION: 1,
  SETTINGS_KEY: 'hsbaseball.settings',

  /* 設定の初期値。ここはユーザーが書き換えられる */
  DEFAULTS: {
    nationalName: '乙大人園',   // 全国大会の名前
    schoolName: '',             // 自校名（空なら作成時にランダムで入れる）
    poach: true,                // 負けたとき相手に引き抜かれるか
  },

  /* チーム作りで見せる組の数。新入生の選択は NEWCOMER_SETS のほう */
  PICK_SETS: 3,
  NEWCOMER_SETS: 5,

  /* 特訓 */
  TRAINING: {
    PICKS: 5,      // 「選択」できる回数（これを使い切ると終わり）
    PASSES: 3,     // 「見送る」の上限
  },

  /* 大会に出てくる相手の強さ（0〜100の目盛り）。
     ここは自軍の強さに合わせて動かさない。固定にしてあるので、
     チームが強くなればそのぶん素直に勝てるようになる。
     from が1回戦、to が決勝のめやす。全国大会は地方の決勝から始まる。 */
  FIELD: {
    local:    { from: 14, to: 70 },
    national: { to: 84 },
    /* 年ごとのゆらぎ。強い年もあれば、そうでもない年もある */
    yearJitter: 0.10,
    /* まれに顔ぶれが大きく変わる年がある。
       手薄な年に当たれば、力の足りないチームにも芽が出る */
    oddYear: 0.08,
    weakYear: [0.60, 0.82],
    strongYear: [1.16, 1.32],
  },

  /* 試合ごとの成長。
     このゲームは「大会を勝ち上がる間に選手が化ける」のが軸なので、
     1試合の伸びはかなり大きく取ってある。1回戦をF・E・Dで戦ったチームが、
     準決勝・決勝の頃にはC・B・Aを混ぜられるくらい。
     PER_STAT を上げると全体が速く伸び、HEAD_SPAN を下げると
     高いところで頭打ちになりやすくなる（Sが出にくくなる）。 */
  GROWTH: {
    PER_STAT: 5.2,     // 1つの能力に配る量の係数
    /* 頭打ち。HEAD_SPAN までは満額で伸び、そこから上で急に鈍る。
       ここを「残りに比例」にすると弱い選手ほど速く伸びてしまい、
       せっかく上げたステータスの差が大会の途中で埋まってしまう。
       途中までを平らにしてあるので、上げたぶんの差はそのまま残る。 */
    HEAD_SPAN: 35,     // 100からの残りがこれ以上あるうちは満額
    HEAD_CURVE: 1.9,   // 大きいほど、高い能力の伸びが急に鈍る
    /* 出場と活躍で決まる取り分。BASE が小さく PERF が大きいほど、
       「打った選手が伸びる」＝ステータスの高い選手ほど伸びる、が強くなる */
    BASE: 0.55,        // 出ただけでもらえるぶん
    PERF: 0.32,        // その試合の出来にかかる係数
    BENCH: 0.18,       // 出番の無かった選手の取り分
    VELO_CHANCE: 0.45, // 投げた試合で球速が上がる確率
  },

  /* 試合 */
  GAME: {
    INNINGS: 9,
    TIEBREAK_FROM: 10,   // これ以降は無死一二塁から
    MAX_INNINGS: 20,     // 念のための打ち切り（ふつうはここまで来ない）
    /* コールドゲーム。高校野球の一般的な規定に合わせてある */
    COLD: [{ inning: 5, diff: 10 }, { inning: 7, diff: 7 }],
  },
};

/* ===== 能力の評価（S〜G） =====
   S90〜100、A80〜89、B70〜79、C60〜69、D50〜59、E40〜49、F15〜39、G1〜14 */
const RANK_TABLE = [
  { min: 90, rank: 'S' },
  { min: 80, rank: 'A' },
  { min: 70, rank: 'B' },
  { min: 60, rank: 'C' },
  { min: 50, rank: 'D' },
  { min: 40, rank: 'E' },
  { min: 15, rank: 'F' },
  { min: 1,  rank: 'G' },
];

function rankOf(v) {
  const n = Math.max(1, Math.min(100, Math.round(v)));
  for (const r of RANK_TABLE) if (n >= r.min) return r.rank;
  return 'G';
}

/* ===== 守備位置 =====
   key は内部用、short はスコアブックの1文字、num は守備番号。
   DH は守る場所が無いので適性を持たない（誰でも入れる）。 */
const POSITIONS = [
  { key: 'P',  short: '投', name: '投手' },
  { key: 'C',  short: '捕', name: '捕手' },
  { key: '1B', short: '一', name: '一塁手' },
  { key: '2B', short: '二', name: '二塁手' },
  { key: '3B', short: '三', name: '三塁手' },
  { key: 'SS', short: '遊', name: '遊撃手' },
  { key: 'LF', short: '左', name: '左翼手' },
  { key: 'CF', short: '中', name: '中堅手' },
  { key: 'RF', short: '右', name: '右翼手' },
  { key: 'DH', short: '指', name: '指名打者' },
];

/* 野手データセットに一人ずつ入れる守備位置（捕一二三遊左中右DH） */
const FIELD_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
const DATASET_POSITIONS = FIELD_POSITIONS.concat(['DH']);

const POS = {};
POSITIONS.forEach((p) => { POS[p.key] = p; });

function posShort(key) { return POS[key] ? POS[key].short : '―'; }
function posName(key) { return POS[key] ? POS[key].name : '―'; }

/* 守備の近さ。主ポジションから遠いほど適性が落ちる。
   （捕手だけは特殊で、他とつながりが薄い） */
const POS_NEAR = {
  C:  { C: 0, '1B': 3, '2B': 5, '3B': 4, SS: 6, LF: 6, CF: 7, RF: 6 },
  '1B': { C: 5, '1B': 0, '2B': 3, '3B': 2, SS: 4, LF: 3, CF: 5, RF: 3 },
  '2B': { C: 5, '1B': 2, '2B': 0, '3B': 2, SS: 1, LF: 3, CF: 3, RF: 3 },
  '3B': { C: 4, '1B': 1, '2B': 2, '3B': 0, SS: 2, LF: 3, CF: 4, RF: 3 },
  SS: { C: 5, '1B': 2, '2B': 1, '3B': 1, SS: 0, LF: 3, CF: 3, RF: 3 },
  LF: { C: 6, '1B': 2, '2B': 4, '3B': 3, SS: 5, LF: 0, CF: 1, RF: 1 },
  CF: { C: 6, '1B': 3, '2B': 3, '3B': 4, SS: 4, LF: 1, CF: 0, RF: 1 },
  RF: { C: 6, '1B': 2, '2B': 4, '3B': 3, SS: 5, LF: 1, CF: 1, RF: 0 },
};

/* ===== 変化球 =====
   weight は「その球種を持っている投手がどれくらいいるか」。
   現実と同じで、スライダーやカーブはありふれていて、
   ナックルを投げる投手はまず居ない。 */
const PITCH_TYPES = [
  { name: 'スライダー',   weight: 100 },
  { name: 'カーブ',       weight: 88 },
  { name: 'チェンジアップ', weight: 62 },
  { name: 'フォーク',     weight: 52 },
  { name: 'カットボール', weight: 40 },
  { name: 'シュート',     weight: 38 },
  { name: 'ツーシーム',   weight: 26 },
  { name: 'スプリット',   weight: 16 },
  { name: 'シンカー',     weight: 14 },
  { name: 'スローカーブ', weight: 10 },
  { name: 'ナックルカーブ', weight: 5 },
  { name: 'スクリュー',   weight: 3.5 },
  { name: 'パーム',       weight: 2 },
  { name: 'ナックル',     weight: 0.25 },   // めちゃくちゃレア
];

/* ===== 大会 ===== */
const ROUND_NAMES = ['1回戦', '2回戦', '3回戦', '4回戦', '準々決勝', '準決勝', '決勝'];

/* 野手・投手それぞれの、特訓で伸ばせる能力 */
const BATTER_STATS = [
  { key: 'meet',  label: 'ミート' },
  { key: 'power', label: 'パワー' },
  { key: 'speed', label: '走力' },
  { key: 'arm',   label: '肩力' },
  { key: 'field', label: '守備' },
  { key: 'catch', label: '捕球' },
];
const PITCHER_STATS = [
  { key: 'control', label: '制球' },
  { key: 'stamina', label: 'スタミナ' },
];

/* 弾道の呼び方（1〜4。数字が大きいほど高い） */
const TRAJ_LABEL = ['', 'ライナー', 'やや低い', 'やや高い', '高い'];
