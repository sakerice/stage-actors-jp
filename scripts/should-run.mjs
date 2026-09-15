#!/usr/bin/env node
/**
 * 土曜のバックアップ実行用の見張り。
 * data/ranking.json の生成時刻が maxAgeHours より新しければ「実行不要」を返す。
 *
 *   node scripts/should-run.mjs --max-age-hours 30
 *
 * 終了コードではなく GITHUB_OUTPUT / 標準出力の run=true|false で伝える。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--max-age-hours');
const maxAgeHours = i >= 0 ? Number(process.argv[i + 1]) : 30;

let run = true;
let reason = 'ranking.json が無いので実行する';

try {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ranking.json'), 'utf8'));
  const ageH = (Date.now() - new Date(d.generatedAt).getTime()) / 3600000;
  if (Number.isFinite(ageH) && ageH < maxAgeHours) {
    run = false;
    reason = `${ageH.toFixed(1)} 時間前に更新済み（しきい値 ${maxAgeHours} 時間）なのでスキップ`;
  } else {
    reason = `前回の更新から ${ageH.toFixed(1)} 時間経過しているので実行する`;
  }
} catch (e) {
  reason = `ranking.json を読めなかった（${e.message}）ので実行する`;
}

console.log(reason);
const line = `run=${run}\n`;
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, line);
else process.stdout.write(line);
