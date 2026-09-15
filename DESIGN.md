# DESIGN.md — 日本の商業舞台俳優ランキング

AI エージェントがこのサイトの UI を触るときに従う仕様。UI を実装するときは必ずこのファイルを参照すること。

## Visual Theme

夜の劇場の客席から舞台を見ている状態。深い紺〜黒の地に、スポットライトのような淡い水色のアクセントを一点だけ置く。
データを読むためのページなので、装飾より「走査しやすさ」を優先する。アニメーション・グラデーション多用・カード乱立はしない。

jp-ui-contracts プロファイル: **dashboard**（本文 14px / line-height 1.5 / letter-spacing 0）。
表のセルは走査性を優先し、本文用の行間ルールをそのまま継承しない。

## Color Palette

| トークン | 値 | 用途 |
|---|---|---|
| `--bg` | `#0f1115` | ページ地 |
| `--bg-grad` | `radial-gradient(1200px 600px at 20% -10%, #1a2740 0%, var(--bg) 55%)` | body 背景 |
| `--panel` | `#181c24` | パネル・表の地 |
| `--panel-2` | `#1e2430` | 表ヘッダー・入れ子パネル |
| `--field` | `#121722` | 入力欄 |
| `--text` | `#e8eaef` | 本文 |
| `--muted` | `#9aa3b2` | 補助情報・単位・注記 |
| `--border` | `#2a3140` | 罫・区切り |
| `--accent` | `#7dd3fc` | 順位・リンク・スコアバー |
| `--active` | `#8b5cf6` | 選択中のチップ |
| `--warn` | `#fbbf24` | 手動入力値・未計測などの注意ラベル |

- 状態を色だけで伝えない。必ず文字（「手動」「未計測」）を併記する。
- 本文 `--text` と `--muted` 以外の文字色を新設しない。

## Typography

```css
font-family: "Hiragino Sans", "Noto Sans JP", "Yu Gothic", system-ui, sans-serif;
```

| 用途 | size | weight | line-height |
|---|---|---|---|
| h1 | clamp(1.2rem, 3.5vw, 1.65rem) | 600 | 1.35 |
| リード文 | .9rem | 400 | 1.7 |
| 表セル | .82rem | 400 | 1.5 |
| 表ヘッダー | .82rem | 600 | 1.5 |
| タグ・バッジ | .68rem | 400 | 1.4 |

- 数値セルは `font-variant-numeric: tabular-nums` を必ず付ける（桁が揃わないと比較できない）。
- 本文に `font-weight: 700` を使わない（最大 600）。
- 本文へ `letter-spacing` を足さない。詰まって見えるときは行間で解く。

## Spacing

4px 基数。`.25rem / .5rem / .75rem / 1rem / 1.5rem` のみ使う。中間値を増やさない。
表セルは `padding: .5rem .55rem`。ヘッダーとの上下差を付けない。

## Elevation

影は使わない。面の区別は `--panel` / `--panel-2` の地色差と 1px の `--border` で付ける。
（このプロジェクトは情報密度優先のため、shadow-border ではなく実線 border を採用する。）

## Component Styling

- **テーブル**: `border-collapse: collapse`、行区切りは `border-bottom: 1px solid var(--border)`。
  ヘッダーは `position: sticky; top: 0` で固定。横溢れは外側の `overflow-x: auto` で受ける（body を横スクロールさせない）。
- **チップ（ジャンル）**: `border-radius: 999px`、選択中は `--active` 縁 + `#2d2450` 地。pill はタグ・バッジ専用で、ボタンには使わない。
- **スコアバー**: 高さ 4px の帯 + 右に数値。バーだけで値を伝えない。
- **バッジ**: `手動` `未計測` などは `--warn` の枠線 + 同色文字、地は透明。
- **入力欄**: `--field` 地、`--border` 枠、`border-radius: 8px`、`line-height: 1.5`。

## Do's & Don'ts

### Do
- 出典と取得日をページ内に明示する。数値がどこから来たか辿れる状態を保つ。
- 自動取得できなかった値は「—」で終わらせず、`未計測` / `アカウントなし` など理由が分かる語を出す。
- 列が増えるときは横スクロール領域の中で増やす。ページ全体を横に伸ばさない。

### Don't
- 全体に `word-break: break-all` を適用しない。日本語は `line-break: strict; overflow-wrap: anywhere`。
- 本文に `letter-spacing` を過剰適用しない。
- 表・フォームに本文の行間ルールをそのまま継承させない。
- 紫グラデーション背景 + 半透明カードグリッドの組み合わせを使わない。
- 外部 CDN のフォント・スクリプトを読み込まない（`_headers` の CSP で `self` に閉じている）。

## Responsive Behavior

- ブレークポイントは 720px の 1 点のみ。
- 720px 未満: ヘッダー・フィルタは 1 カラムに落とす。表は `overflow-x: auto` のまま横スクロールで読ませる（列を隠さない）。
- 左右の余白は最低 16px を常に確保する。

## Agent Prompt Guide

- 数値は `data/ranking.json` が唯一の出典。HTML に数値を直書きしない。
- 表示ロジックを足すときは `innerHTML` を使わず `textContent` / `createElement` で組む（CSP と混入対策）。
- 列を追加するときは `<thead>` の並びと描画関数の並びを必ず一致させる。
- 「芸歴」「年齢」はスコアに入らない参考値。見出しに（参考）を残すこと。
