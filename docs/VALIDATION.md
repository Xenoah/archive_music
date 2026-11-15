# Validation

2026-11-15

- Node.js 24.22.1 / FFmpeg にて `npm test`: 8 tests passed.
- ブラウザ用ZIP生成関数 → ZIP検証 → inbox取り込み → 退避 → FFmpeg変換 → 解析JSON → catalog → dist の往復テスト。
- 120 BPMのPCMテスト音源を読み込み、1 BPM未満の誤差で検出。
- 40 / 80 / 96 / 128 / 160 / 210 / 240 BPM、低音量、無音、短い音源、単発過渡音、逆相ステレオを検証。
- ZIPパス遡及、CRC不一致、不正メタデータ、重複slugを拒否。
- 下書き音源が公開フォルダーに出ないことを確認。
- download=true → falseで原本の公開コピーが除去されることを確認。
- 合成MP3デモ: 96 → 96、128 → 127.8、160 → 160 BPM。

再現: `npm test && npm run build`

合成信号の精度確認であり、実在楽曲全般で同じ精度を保証するものではありません。

- CLI投稿で他のステージ済み変更がコミットされないことと、ローカルbare remoteまでpushされることを検証。
