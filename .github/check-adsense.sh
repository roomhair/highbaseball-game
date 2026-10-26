#!/usr/bin/env bash
# AdSense の審査で問題になった3点が、元に戻っていないかを確かめる。
#
#   bash .github/check-adsense.sh highschool
#
# 本番（roomhair/baseball-statsquiz）の tools/check-adsense.sh の写し。
# 本番の Sync highschool も取り込み前に同じものを走らせるので、ここで赤くなったものは
# 本番に出ない。ここで先に気づけるように置いている。直すときは両方そろえること。
#
# 2026-10 に直した欠陥（README の「AdSense 審査の経緯」）：
#   1. 審査コードの抜け … js/ads.js は adsense.slots が空だと AdSense を読み込まないので、
#      各ページの <head> に直書きのタグが無いと審査コードが存在しないことになる
#   2. 住所のずれ     … 正規は https://roomhaird.com。baseball.roomhaird.com を書くと、
#      審査対象の apex が「自分は複製だ」と宣言することになる
#   3. noindex        … わざと付けているページ以外に付いていたら止める
#
# 見つけたら GitHub Actions の注釈（::error）で場所を示し、終了コード 1 で止まる。

set -uo pipefail

dir="${1:-.}"

TAG='pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1646091398696967'

# noindex をわざと付けているページ。サイトのルートからの相対パス
NOINDEX_OK=(
  'privacy.html'      # プライバシーポリシー
  'team/season.html'  # シーズン結果の共有ページ
)

fail=0

# 配信しないもの（.assetsignore と同じ）は見ない
mapfile -t pages < <(
  find "$dir" -name '*.html' \
    -not -path '*/.git/*' -not -path '*/node_modules/*' \
    -not -path './data/*' -not -path './tools/*' | sort
)

if [ "${#pages[@]}" -eq 0 ]; then
  echo "::error::HTML が1つも見つかりません（$dir）"
  exit 1
fi

for f in "${pages[@]}"; do
  rel="${f#./}"

  # 1. head の中に直書きの審査コードがあるか（body にあっても数えない）
  if ! sed -n '1,/<\/head>/p' "$f" | grep -qF "$TAG"; then
    echo "::error file=$rel::AdSense の審査コードが <head> にありません"
    fail=1
  fi

  # 3. noindex は決めたページだけ
  if grep -qiE '<meta[^>]+name="robots"[^>]+noindex' "$f"; then
    allowed=0
    for ok in "${NOINDEX_OK[@]}"; do
      [ "$rel" = "$ok" ] && allowed=1
    done
    if [ "$allowed" -eq 0 ]; then
      echo "::error file=$rel::noindex が付いています（検索結果から外れます）"
      fail=1
    fi
  fi
done

# 2. baseball.roomhaird.com を書いていないか
while IFS= read -r hit; do
  file="${hit%%:*}"
  rest="${hit#*:}"
  line="${rest%%:*}"
  echo "::error file=${file#./},line=$line::baseball.roomhaird.com と書かれています。https://roomhaird.com で書いてください"
  fail=1
done < <(
  grep -rnI 'baseball\.roomhaird\.com' "$dir" \
    --include='*.html' --include='*.xml' --include='*.txt' --include='*.js' \
    --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=data --exclude-dir=tools
)

if [ "$fail" -eq 0 ]; then
  echo "AdSense の確認: ${#pages[@]} ページとも問題なし"
fi
exit "$fail"
