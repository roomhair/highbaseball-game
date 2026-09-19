/* ==================================================
   高校野球  offseason.js

   オフシーズン。3年生が引退し、1・2年生が1つ学年を上げ、
   空いた人数ぶんの新入生が入る。
   ・負けて選手を引き抜かれていると、その枠も空いたままなので、
     結果として新入生が1人多く入る（人数を数えるだけで自然にそうなる）。
   ================================================== */
'use strict';

const Offseason = (() => {

  /** 引退する3年生 */
  function retiring(team) {
    return Team.all(team).filter((p) => p.grade >= 3);
  }

  /** 引退者の見せ方（通算成績・能力・名場面トップ3） */
  function farewell(p) {
    return {
      player: p,
      career: p.career,
      top: (p.hl || []).slice().sort((a, b) => b.score - a.score).slice(0, 3),
    };
  }

  /** 3年生を外し、残りを1つ進級させる。戻り値は必要な新入生の人数 */
  function graduate(team) {
    team.batters = team.batters.filter((p) => p.grade < 3);
    team.pitchers = team.pitchers.filter((p) => p.grade < 3);
    Team.all(team).forEach((p) => { p.grade++; });
    Team.repair(team);
    return {
      bat: Math.max(0, 13 - team.batters.length),
      pit: Math.max(0, 7 - team.pitchers.length),
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

  return { retiring, farewell, graduate, enroll };
})();
