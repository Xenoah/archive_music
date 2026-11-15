> 受領した `otodana.zip` のREADME原文です。統合版の投稿方法・下書きの扱い・ビルド手順は、リポジトリ直下の [README](../README.md) を参照してください。

# OTODANA（音棚）

音声ファイルを `_inbox/` に push するだけで、GitHub Actions が取り込み・解析・サイト構築・公開まで行う、静的な音楽投稿プラットフォームです。サーバーもデータベースも npm 依存もありません。

- 仕組みは [archive-3dmodels](https://github.com/Xenoah/archive-3dmodels) と同じ「`_inbox` → Actions が最終フォルダを構築 → GitHub Pages」
- 波形（LOW / MID / HIGH の3バンド）、オシロスコープ、FFT、BPM 推定は [dt-cue](https://github.com/Xenoah/dt-cue_precision-media-player) の実装を使用

![曲ページ](docs/preview-track.png)

![一覧](docs/preview-list.png)

## 流れ

```text
_inbox/My Song.mp3 を push
        │
        ▼  Import Inbox（.github/workflows/import-inbox.yml）
content/tracks/My-Song/
  My-Song.md        … タイトルなど（タグから自動記入）
  My-Song.mp3
  cover.jpg         … 同梱画像 or 埋め込みアート。無ければ auto-cover.png を波形から生成
  analysis.json     … dt-cue の解析コアで作った3バンド波形と BPM
_uploaded/My-Song/  … 元ファイルの保管
        │  （bot がコミット）
        ▼  Deploy GitHub Pages（.github/workflows/deploy.yml）
dist/               … 公開される最終フォルダ
  index.html, t/My-Song/index.html, media/My-Song/…, data/tracks.json, rss.xml, sitemap.xml
```

## 最初の設定

1. このフォルダの中身を新しいリポジトリの `main` に push する。
2. **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする。
3. `site.config.json` のタイトル・作者名などを書き換える。

サイトのURL（`/リポジトリ名/`）は Actions が自動で判定するので、リポジトリ名は自由です。
Import Inbox のコミットが権限エラーになる場合は、Settings → Actions → General → Workflow permissions を「Read and write」にしてください。

## 曲を投稿する

`_inbox/` に置いて push します（GitHub の Web 画面の「Add file → Upload files」でも可）。

```text
# 単体ファイル。同じ名前の画像・説明があれば一緒に取り込む
_inbox/My Song.mp3
_inbox/My Song.jpg        （任意）カバー
_inbox/My Song.md         （任意）Front Matter + 説明文

# フォルダ。フォルダ名が slug（URL）になる
_inbox/my-song/
  song.wav                音声は1フォルダ1つ
  cover.png               （任意）
  info.md                 （任意）info.json でも可
```

- 対応形式: mp3 / wav / flac / ogg / opus / m4a / aac / aiff / webm
- 情報の優先順位は「info.md / info.json」→「音声ファイルのタグ（title, artist, album, genre, date, BPM）」→ 既定値
- 既にある曲を差し替えるときは、Actions の **Import Inbox → Run workflow** で `merge` にチェック

### Front Matter（`content/tracks/{slug}/{slug}.md`）

```yaml
---
title: "My Song"            # 必須
artist: "Xenoah"
album: ""
genre: "House"
tags: ["demo", "4つ打ち"]
bpm: 128                    # 書くと手動指定。省略すると自動解析値を使う
key: "Am"
license: "All rights reserved"
status: "public"            # public / draft / hidden
download: false             # true で原本のダウンロードボタンを出す
createdAt: "2026-11-01"
uploadedAt: "2026-11-15"
---

ここから説明文。段落、`- ` の箇条書き、**太字**、[リンク](https://example.com) が使えます。
```

取り込み後は、この Markdown を直接編集して push すれば反映されます（`_inbox` を通す必要はありません）。

| status | 一覧 | 曲ページ | sitemap / RSS | robots |
| --- | --- | --- | --- | --- |
| public | 表示 | 生成 | 含める | index |
| draft | 表示（DRAFT バッジ） | 生成 | 含めない | noindex |
| hidden | 非表示 | 生成（URL を知っていれば開ける） | 含めない | noindex |

## 解析について

- `site/src/analysis-core.js` と `site/src/tempo.js` は dt-cue からそのまま持ってきたもので、ビルド時（Node）とブラウザの両方で同じコードが動きます。
- Actions では ffmpeg でデコード → 3バンド波形（250Hz / 4kHz クロスオーバー）と BPM（発音間隔 / 自己相関 / 周期グリッドの3方式を統合）を計算し、`analysis.json`（十数KB）に保存します。音声の中身が変わらない限り再解析しません。
- `analysis.json` が無い曲は、曲ページを開いたときにブラウザ内で同じ解析を行います（80MB まで）。
- オシロスコープと FFT は再生中の音を Web Audio の AnalyserNode から取って描きます。音量スライダーの手前で取っているので、音量を下げても表示は変わりません。
- BPM は推定値です。ハーフテンポ寄りのビートなどは倍 / 半分の候補が第一候補になることがあります。曲ページの「テンポ」で各方式の候補をビート線に当てて確認し、違っていたら Front Matter に `bpm:` を書いてください。

## 音声の配信

- wav / flac / aiff は、ビルド時に配信用 mp3（既定 256kbps）を作って再生に使います。原本は `download: true` の曲だけ公開されます。
- mp3 / ogg / m4a などはそのまま配信します。
- 変換をやめる場合は `site.config.json` の `stream.transcodeLossless` を `false` に。

## ローカルで動かす

Node.js 20 以上。`npm install` は不要です。ffmpeg が無い場合は WAV だけ事前解析され、他はブラウザ内解析になります。

```sh
npm run demo                       # デモ音源3曲を _inbox に合成
npm run import:inbox               # dry-run（計画の表示）
npm run import:inbox -- --apply    # 取り込み
npm run dev                        # 解析 → ビルド → http://127.0.0.1:4173/
npm test
```

| コマンド | 内容 |
| --- | --- |
| `npm run import:inbox [-- --apply] [-- --merge]` | `_inbox` の取り込み |
| `npm run analyze [-- --force] [slug…]` | 波形・BPM の解析、自動カバー生成 |
| `npm run validate` | Front Matter とファイル構成の検証 |
| `npm run build` | `dist/` の生成（`PUBLIC_BASE_PATH`, `PUBLIC_SITE` を参照） |
| `npm run serve [-- --base /repo]` | `dist/` の確認用サーバー（Range 対応） |

## 設定（`site.config.json`）

| キー | 内容 |
| --- | --- |
| `title`, `tagline.ja/en` | サイト名とキャッチコピー |
| `author` | artist 未指定時の既定値 |
| `defaultLicense`, `defaultDownload` | 新規取り込み時の既定値 |
| `siteUrl` | ローカルビルドで canonical / OGP に使う origin（Actions では自動） |
| `stream.transcodeLossless`, `stream.bitrate` | ロスレス音源の配信用 mp3 |
| `links` | About ページのリンク |

About ページの本文は `content/about.md` です。

## サイトの機能

- 一覧: 検索、ジャンル / タグ / BPM 範囲での絞り込み、並び替え、お気に入り（ブラウザに保存）
- 曲ページ: 3バンド波形（クリック / ドラッグでシーク、Ctrl+ホイールで拡大、ビート線）、オシロスコープ、FFT、BPM と3方式の候補、ピーク / RMS、共有、ダウンロード
- 常駐プレイヤー: ページを移動しても再生が途切れない。前 / 次、シャッフル、リピート、音量、ミニ波形シーク、ミニ FFT / オシロ（クリックで切替）、メディアキー対応
- キー: Space 再生 / 停止、← → 5秒シーク、M ミュート
- 日本語 / 英語の切り替え、OGP、JSON-LD、sitemap.xml、RSS（enclosure 付き）

## 制限

- GitHub の制限で、1ファイル 100MB を超える音源は push できません。Pages のサイト全体は 1GB が目安です。
- コメント・再生数・ログインなど、サーバーが必要な機能はありません。投稿できるのはリポジトリに push できる人だけです。
- 実機のスマートフォン（特に iOS Safari）での再生と表示は未確認です。確認したのは PC の Chrome です。

## 構成

```text
_inbox/  _uploaded/  content/tracks/  content/about.md
scripts/
  import-inbox.mjs   取り込み
  analyze.mjs        事前解析
  build.mjs          dist/ の構築
  validate.mjs  make-demo.mjs
  lib/               front matter / 音声デコード / 解析の詰め替え / PNG 書き出し
site/
  template.html  style.css
  src/app.js             画面とルーティング
  src/player.js          再生と Web Audio グラフ
  src/views.js           波形・オシロ・FFT の描画（dt-cue の views.js を改変）
  src/analysis-core.js   dt-cue そのまま
  src/tempo.js           dt-cue そのまま
  src/analysis-worker.js dt-cue そのまま
  src/analysis-client.js analysis.json の読み込みとブラウザ内解析
tools/serve.mjs  tests/
```

## クレジット

- 解析と描画: dt-cue（MIT License、`site/src/LICENSE.dt-cue.txt`）
- アイコン: Material Icons（Apache License 2.0）
