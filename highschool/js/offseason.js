/* ==================================================
   高校野球  offseason.js

   オフシーズン。3年生は夏が終わった時点で引退するが、学年はまだ
   上げない（秋の大会・センバツ相当は、3年生が抜けた今の学年の
   ままで戦う）。センバツ相当まで終わってから、残った部員の学年を
   1つ上げ、空いた人数ぶんの新入生を迎える。
   ・負けて選手を引き抜かれていると、その枠も空いたままなので、
     結果として新入生が1人多く入る（人数を数えるだけで自然にそうなる）。
   ================================================== */
'use strict';

const Offseason = (() => {

  /* 引退のあとに最低限そろえておく人数 */
  const MIN_BATTERS = 10, MIN_PITCHERS = 3;

  /** 引退する3年生 */
  function retiring(team) {
    return Team.all(team).filter((p) => p.grade >= 3);
  }

  /**
   * 飛び抜けた選手はプロへ行く。指名の順位は能力で決まるが、
   * 大会での活躍（名場面の点）も少しだけ効く。
   */
  function draftPick(p) {
    const score = Player.rating(p) + (p.hl || []).slice(0, 3)
      .reduce((s, h) => s + h.score, 0) * 0.35;
    if (score < 62) return null;
    if (score >= 86) return { round: 1, text: 'ドラフト1位' };
    if (score >= 79) return { round: 2, text: 'ドラフト2位' };
    if (score >= 73) return { round: 3, text: 'ドラフト3位' };
    if (score >= 68) return { round: 4, text: 'ドラフト4位' };
    if (score >= 65) return { round: 5, text: 'ドラフト5位' };
    return { round: 6, text: '育成ドラフト' };
  }

  /** 引退者の見せ方（通算成績・能力・名場面トップ3・プロ入り） */
  function farewell(p) {
    return {
      player: p,
      career: p.career,
      top: (p.hl || []).slice().sort((a, b) => b.score - a.score).slice(0, 3),
      draft: draftPick(p),
    };
  }

  /** 引き抜きで3年生ばかりを迎えていると、引退で人数が足りなくなる
      （野手9人に満たないと、スタメンが組めない）。足りない分だけ
      1年生が急きょ入部する。あとで新入生を迎えるときは、その人数を
      差し引くので、全体の人数は変わらない */
  function fillShort(team) {
    const lack = { bat: Math.max(0, MIN_BATTERS - team.batters.length),
                   pit: Math.max(0, MIN_PITCHERS - team.pitchers.length) };
    const pool = RNG.shuffle(FIELD_POSITIONS.slice());
    for (let i = 0; i < lack.bat; i++) {
      team.batters.push(Player.newBatter({ grade: 1, pos: pool[i % pool.length] }));
    }
    for (let i = 0; i < lack.pit; i++) team.pitchers.push(Player.newPitcher({ grade: 1 }));
    return lack;
  }

  /** 古い保存データの救済。野手が9人に満たないまま進んでいたら補う */
  function rescue(team) {
    if (team && team.batters.length > 0 && team.batters.length < 9) {
      const lack = fillShort({ batters: team.batters, pitchers: [{}, {}, {}] });
      Team.repair(team);
      return lack.bat;
    }
    return 0;
  }

  /** 3年生を外す。学年はまだ上げない（秋の大会・センバツ相当は、
      3年生が抜けた今の学年のままで戦うため） */
  function retire(team) {
    team.batters = team.batters.filter((p) => p.grade < 3);
    team.pitchers = team.pitchers.filter((p) => p.grade < 3);
    /* キャプテンが引退したら印を外す。次の特訓の前に選び直してもらう */
    Team.checkCaptain(team);
    const lack = fillShort(team);
    Team.repair(team);
    return lack;
  }

  /** 残った部員の学年を1つ上げる。戻り値は必要な新入生の人数。
      秋の大会・センバツ相当がすべて終わってから呼ぶ */
  function promote(team) {
    Team.all(team).forEach((p) => { p.grade++; });
    return {
      bat: Math.max(0, 16 - team.batters.length),
      pit: Math.max(0, 8 - team.pitchers.length),
    };
  }

  /** 新入生を入部させる */
  function enroll(team, players) {
    players.forEach((p) => {
      if (p.kind === 'pitcher') team.pitchers.push(p);
      else team.batters.push(p);
    });
    Team.autoLineup(team);
    return team;
  }

  return { retiring, farewell, retire, promote, enroll, draftPick, rescue };
})();
