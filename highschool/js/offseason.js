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

  /** 3年生を外し、残りを1つ進級させる。戻り値は必要な新入生の人数 */
  function graduate(team) {
    team.batters = team.batters.filter((p) => p.grade < 3);
    team.pitchers = team.pitchers.filter((p) => p.grade < 3);
    Team.all(team).forEach((p) => { p.grade++; });
    /* キャプテンが引退したら印を外す。次の特訓の前に選び直してもらう */
    Team.checkCaptain(team);
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

  return { retiring, farewell, graduate, enroll, draftPick };
})();
