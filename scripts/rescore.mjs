#!/usr/bin/env node
/**
 * 収集済みの data/ranking.json を読み直し、スコアだけ計算し直す。
 * 重みや欠測の扱いを調整するたびに 25 分かけて再収集しなくて済むようにするためのもの。
 *
 *   node scripts/rescore.mjs            # data/ranking.json を上書き
 *   node scripts/rescore.mjs --dry      # 書き換えず、順位の変化だけ表示
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { score, WEIGHTS } from './score.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'data', 'ranking.json');
const dry = process.argv.includes('--dry');

const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const before = new Map(d.actors.map((a) => [a.name, { rank: a.rank, score: a.score }]));

score(d.actors, new Date(d.generatedAt));
d.weights = WEIGHTS;

const moved = d.actors
  .map((a) => ({ name: a.name, rank: a.rank, score: a.score, was: before.get(a.name) }))
  .filter((x) => x.was && x.was.rank !== x.rank)
  .sort((x, y) => Math.abs(y.was.rank - y.rank) - Math.abs(x.was.rank - x.rank));

console.log(`順位が動いたのは ${moved.length} / ${d.actors.length} 人`);
moved.slice(0, 20).forEach((x) => {
  const diff = x.was.rank - x.rank;
  console.log(
    `  ${x.name.padEnd(7, '　')} ${String(x.was.rank).padStart(2)}位 → ${String(x.rank).padStart(2)}位 ` +
      `(${diff > 0 ? '+' : ''}${diff})  ${x.was.score} → ${x.score}`
  );
});

if (dry) {
  console.log('\n--dry のため書き換えていない');
} else {
  fs.writeFileSync(FILE, JSON.stringify(d, null, 1) + '\n');
  console.log(`\n${FILE} を更新した`);
}
