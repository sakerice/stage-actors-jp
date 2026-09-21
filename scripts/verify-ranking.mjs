#!/usr/bin/env node
/**
 * 収集結果の健全性チェック。スクレイプ先の HTML 構造が変わって
 * 「全員データなし」のまま公開されるのを防ぐための番人。
 * 問題があれば非ゼロで終了する（= CI がコミットしない）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roster = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'roster.json'), 'utf8'));
const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ranking.json'), 'utf8'));

const errors = [];
const warns = [];
const a = d.actors || [];

const pct = (n) => (a.length ? (n / a.length) * 100 : 0);
const count = (fn) => a.filter(fn).length;

if (a.length !== roster.actors.length) {
  errors.push(`人数が名簿と一致しない: ranking=${a.length} roster=${roster.actors.length}`);
}
if (a.length === 0) errors.push('俳優が 1 人も入っていない');

const withNews = count((r) => r.news12m != null);
if (pct(withNews) < 80) errors.push(`ステージナタリーの記事数が ${withNews}/${a.length} 人ぶんしかない（80% 未満）`);

// 取得に失敗したソースは前回値を引き継ぐので「値がある」だけでは健全と言えない。
// いつ取れた値なのかで鮮度を見る。
const STALE_WARN_DAYS = 10;
const STALE_FAIL_DAYS = 21;
const ageDays = (iso) => (iso ? (Date.now() - new Date(iso + 'T00:00:00+09:00').getTime()) / 86400000 : Infinity);

for (const [label, field] of [['ステージナタリー', 'natalieAsOf'], ['あちこちデータ', 'achikochiAsOf']]) {
  const ages = a.map((r) => ageDays(r[field])).sort((x, y) => x - y);
  const median = ages[Math.floor(ages.length / 2)];
  const stale = ages.filter((v) => v > STALE_FAIL_DAYS).length;
  if (!Number.isFinite(median)) {
    errors.push(`${label}から一度も取得できていない（${field} が全員空）`);
  } else if (stale > a.length / 2) {
    errors.push(
      `${label}のデータが古すぎる: ${stale}/${a.length} 人が ${STALE_FAIL_DAYS} 日超（中央値 ${Math.floor(median)} 日前）。` +
        `取得元に弾かれていないか確認すること`
    );
  } else if (median > STALE_WARN_DAYS) {
    warns.push(`${label}のデータが中央値 ${Math.floor(median)} 日前。今回は前回値を引き継いでいる可能性が高い`);
  }
}

const carried = a.filter((r) => r.carriedForward && r.carriedForward.length);
if (carried.length) {
  const bySource = {};
  carried.forEach((r) => r.carriedForward.forEach((s) => (bySource[s] = (bySource[s] || 0) + 1)));
  warns.push(
    '前回値を引き継いだ人: ' +
      Object.entries(bySource)
        .map(([k, v]) => `${k} ${v}人`)
        .join(' / ')
  );
}

const withX = count((r) => r.xFollowers != null);
if (withX < 25) errors.push(`X フォロワー数を取れたのが ${withX} 人しかない（25 人未満）`);

const withBirth = count((r) => r.birth);
if (pct(withBirth) < 60) warns.push(`生年月日を取れたのが ${withBirth}/${a.length} 人（60% 未満）`);

const badScore = count((r) => !Number.isFinite(r.score));
if (badScore) errors.push(`スコアが数値でない行が ${badScore} 件`);

const noAxis = a.filter((r) => !r.measuredAxes || r.measuredAxes.length === 0);
if (noAxis.length) errors.push(`計測できた軸が 1 つも無い: ${noAxis.map((r) => r.name).join(', ')}`);

const noSource = a.filter((r) => !r.natalieAsOf && !r.achikochiAsOf);
if (noSource.length) {
  errors.push(`どのソースからも一度もデータを取れていない: ${noSource.map((r) => r.name).join(', ')}`);
}

const ranks = a.map((r) => r.rank).sort((x, y) => x - y);
if (ranks.some((v, i) => v !== i + 1)) errors.push('順位が 1..N の連番になっていない');

const errored = a.filter((r) => r.sourceErrors && r.sourceErrors.length);
if (errored.length) warns.push(`取得エラーのあった人: ${errored.map((r) => r.name + '(' + r.sourceErrors.join(';') + ')').join(' / ')}`);

const dup = a.map((r) => r.name).filter((n, i, arr) => arr.indexOf(n) !== i);
if (dup.length) errors.push(`名前が重複: ${[...new Set(dup)].join(', ')}`);

const freshness = (field) => {
  const ages = a.map((r) => ageDays(r[field])).filter(Number.isFinite).sort((x, y) => x - y);
  return ages.length ? `${Math.floor(ages[Math.floor(ages.length / 2)])}日前` : '未取得';
};
console.log(
  `検証: ${a.length} 人 / 記事数 ${withNews} / X ${withX} / IG ${count((r) => r.igFollowers != null)} / 生年月日 ${withBirth}\n` +
    `      鮮度(中央値): ステージナタリー ${freshness('natalieAsOf')} / あちこちデータ ${freshness('achikochiAsOf')}`
);
warns.forEach((w) => console.log('  警告: ' + w));

if (errors.length) {
  console.error('\n検証に失敗しました:');
  errors.forEach((e) => console.error('  - ' + e));
  process.exit(1);
}
console.log('検証 OK');
