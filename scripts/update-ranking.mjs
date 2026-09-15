#!/usr/bin/env node
/**
 * data/roster.json の名簿をもとに、外部の公開データを集めて data/ranking.json を作り直す。
 *
 * 評価軸（ユーザー指定）
 *   1. X フォロワー数
 *   2. Instagram フォロワー数
 *   3. X 投稿頻度（X API が有料化され自動取得できないため roster.json の手入力欄）
 *   4. ニュースに取り上げられた度合い（ステージナタリー 直近12ヶ月の記事数と注目度）
 *   5. 直近の活動量（直近90日の記事数・最新記事の鮮度・掲載中の出演公演数）
 *   芸歴・年齢はスコアに入れず参考値として表示するだけ。
 *
 * 使い方:  node scripts/update-ranking.mjs [--limit N] [--out path]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sleep,
  natalieProfileId,
  natalieArtist,
  natalieNews,
  achikochiSlug,
  achikochiPerson,
  eigaPersonId,
  eigaPerson,
  snsHandlesFromSite,
  natalieStages
} from './sources.mjs';
import { score, WEIGHTS } from './score.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argVal = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : null;
};
const LIMIT = Number(argVal('--limit')) || Infinity;
const OUT = argVal('--out') || path.join(ROOT, 'data', 'ranking.json');

const NOW = new Date();
const DAY = 86400000;
const days = (d) => (NOW - new Date(d)) / DAY;

/* ------------------------------------------------------------------ */

/** 所属事務所のポータルサイト。ここに載っている SNS は本人のものとは限らない。 */
const AGENCY_HOSTS = [
  'topcoat.co.jp', 'siscompany.com', 'oscarpro.co.jp', 'ken-on.co.jp', 'horipro.co.jp',
  'blooming-net.com', 'amuse.co.jp', 'toho-ent.co.jp', 'watanabepro.co.jp', 'k-factory.net',
  'my-pro.co.jp', 'grand-arts.com', 'avanceinc.jp', 'liverpool-ltd.com', 'a-light.jp',
  'bam-boo.biz', 'pasture.co.jp', 'e-nakamuraya.jp', 'castcorporation.jp', 'trustar.co.jp'
];

/** 事務所・番組の共用アカウントを本人のものとして拾わないための除外。 */
const HANDLE_DENY = /^(topcoat_staff|sis_management|siscompany\w*|oscarpro\w*|BLOOMINGAGENCY|kenon_info|horipro\w*|amuse\w*|wasekon_\w+|\w+_tbs|\w+_ntv|\w+_tvasahi|\w+_fujitv)$/i;

function isAgencyPortal(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return AGENCY_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  } catch {
    return false;
  }
}

function cleanHandle(h) {
  return h && !HANDLE_DENY.test(h) ? h : null;
}

function debutYearFromProfile(text) {
  if (!text) return null;
  const m = text.match(/(\d{4})年[^。]{0,40}?(デビュー|初舞台|初お目見え|初舞台を踏|旗揚げ|入団)/);
  return m ? Number(m[1]) : null;
}

function ageFrom(birth) {
  if (!birth) return null;
  const b = new Date(birth + 'T00:00:00+09:00');
  if (Number.isNaN(b.getTime())) return null;
  let a = NOW.getFullYear() - b.getFullYear();
  const m = NOW.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && NOW.getDate() < b.getDate())) a -= 1;
  return a;
}

async function collect(actor) {
  const row = { ...actor, fetchedAt: NOW.toISOString(), sourceErrors: [] };

  // --- ステージナタリー -------------------------------------------------
  let natalieId = actor.natalieId;
  try {
    if (!natalieId) natalieId = await natalieProfileId(actor.name);
    row.natalieId = natalieId;
    if (natalieId) {
      const a = await natalieArtist(natalieId);
      await sleep(350);
      row.profile = a.profile;
      row.officialSite = a.officialSite;
      row.xHandle = a.xHandle;
      row.igHandle = a.igHandle;
      row.stages = a.stages;
      row.natalieUrl = `https://natalie.mu/stage/artist/${natalieId}`;

      // 人物ページの公演欄は 8 件で頭打ちなので、一覧ページから日程つきで取り直す
      const plays = await natalieStages(natalieId);
      await sleep(350);
      if (plays.length) {
        row.stages = plays.slice(0, 10).map((p) => p.title);
        row.stagesTotal = plays.length;
        const overlaps = (p, fromDays) => {
          if (!p.end) return false;
          return days(p.end) <= fromDays && days(p.start || p.end) >= -370;
        };
        row.stages12m = plays.filter((p) => overlaps(p, 365)).length;
        row.stagesUpcoming = plays.filter((p) => p.end && days(p.end) <= 0).length;
        row.stageList = plays.slice(0, 10);
      }

      const news = await natalieNews(natalieId, NOW);
      const in12m = news.filter((n) => n.date && days(n.date) <= 365);
      const in90d = news.filter((n) => n.date && days(n.date) <= 90);
      row.news12m = in12m.length;
      row.news90d = in90d.length;
      row.newsAttention12m = in12m.reduce((s, n) => s + n.score, 0);
      const latest = news.find((n) => n.date);
      row.latestNews = latest ? { title: latest.title, date: latest.date, url: latest.url || null } : null;
      row.daysSinceNews = latest ? Math.round(days(latest.date)) : null;
      row.topNews = in12m
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((n) => ({ title: n.title, date: n.date, score: n.score, url: n.url || null }));
    }
  } catch (e) {
    row.sourceErrors.push('natalie: ' + e.message);
  }

  // --- あちこちデータ（フォロワー数）------------------------------------
  try {
    let slug = actor.achikochiSlug;
    if (slug === undefined) slug = await achikochiSlug(actor.name);
    row.achikochiSlug = slug;
    if (slug) {
      const p = await achikochiPerson(slug);
      if (p) {
        row.xFollowers = p.xFollowers;
        row.igFollowers = p.igFollowers;
        row.snsAccounts = p.accounts;
        row.followerSourceDate = p.sourceUpdated;
      }
    }
  } catch (e) {
    row.sourceErrors.push('achikochi: ' + e.message);
  }
  row.xFollowersSource = row.xFollowers != null ? 'achikochi' : null;
  row.igFollowersSource = row.igFollowers != null ? 'achikochi' : null;

  // ステージナタリーにリンクが無い場合、フォロワー集計側のアカウント名で補う
  if (!row.xHandle && row.snsAccounts?.length) row.xHandle = row.snsAccounts[0].handle;

  // それでも見つからなければ、本人の公式サイトのリンクから拾う。
  // 事務所ポータルは所属タレント共通のアカウントを載せているので使わない。
  if ((!row.xHandle || !row.igHandle) && row.officialSite && !isAgencyPortal(row.officialSite)) {
    try {
      const s = await snsHandlesFromSite(row.officialSite);
      row.xHandle = row.xHandle || cleanHandle(s.xHandle);
      row.igHandle = row.igHandle || cleanHandle(s.igHandle);
    } catch {
      /* 公式サイトは落ちていることもあるので握りつぶす */
    }
  }

  // 自動取得できなかった分は、名簿の手入力スナップショットで補う
  const ms = actor.manualSocial;
  if (ms) {
    row.xHandle = row.xHandle || ms.xHandle || null;
    row.igHandle = row.igHandle || ms.igHandle || null;
    if (row.xFollowers == null && ms.xFollowers != null) {
      row.xFollowers = ms.xFollowers;
      row.xFollowersSource = 'manual';
    }
    if (row.igFollowers == null && ms.igFollowers != null) {
      row.igFollowers = ms.igFollowers;
      row.igFollowersSource = 'manual';
    }
    row.socialCheckedAt = ms.checkedAt || null;
    row.socialNote = ms.xNote || null;
  }

  // --- 映画.com（よみ・生年月日）----------------------------------------
  try {
    let eid = actor.eigaId;
    if (!eid) eid = await eigaPersonId(actor.name);
    row.eigaId = eid;
    if (eid) {
      const p = await eigaPerson(eid);
      if (p) {
        row.yomi = actor.yomi || p.yomi;
        row.birth = actor.birth || p.birth;
        row.origin = p.origin;
      }
    }
  } catch (e) {
    row.sourceErrors.push('eiga: ' + e.message);
  }

  // アカウントの状態: 数値あり=have / 名簿で「無し」と確認済み=none / それ以外=unknown（未計測）
  const none = actor.noAccount || {};
  row.xAccountState = row.xFollowers != null ? 'have' : none.x ? 'none' : row.xHandle ? 'unmeasured' : 'unknown';
  row.igAccountState = row.igFollowers != null ? 'have' : none.ig ? 'none' : row.igHandle ? 'unmeasured' : 'unknown';

  row.age = ageFrom(row.birth);
  row.debutYear = actor.debutYear ?? debutYearFromProfile(row.profile);
  row.careerYears = row.debutYear ? NOW.getFullYear() - row.debutYear : null;
  row.xPostFrequency = actor.xPostFrequency ?? null;

  return row;
}

/* ------------------------------------------------------------------ */

const roster = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'roster.json'), 'utf8'));
const targets = roster.actors.slice(0, LIMIT);
const rows = [];
for (const a of targets) {
  const r = await collect(a);
  rows.push(r);
  process.stderr.write(
    `${String(rows.length).padStart(2)}/${targets.length} ${r.name}  X=${r.xFollowers ?? '-'} IG=${r.igFollowers ?? '-'} ` +
      `news12m=${r.news12m ?? '-'} 90d=${r.news90d ?? '-'} birth=${r.birth ?? '-'}` +
      (r.sourceErrors.length ? `  !${r.sourceErrors.join(';')}` : '') +
      '\n'
  );
  await sleep(600);
}

score(rows);

const followerDates = [...new Set(rows.map((r) => r.followerSourceDate).filter(Boolean))].sort();
const out = {
  generatedAt: NOW.toISOString(),
  generatedAtJst: new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(NOW),
  weights: WEIGHTS,
  genres: roster.genres,
  sources: [
    { name: 'ステージナタリー', url: 'https://natalie.mu/stage', use: '報道量（直近12ヶ月の記事数・注目度）、直近の活動量、出演公演、公式SNSリンク' },
      {
      name: 'あちこちデータ',
      url: 'https://achikochi-data.com/',
      use: 'X / Instagram のフォロワー数',
      asOf: followerDates.length
        ? followerDates[0] === followerDates[followerDates.length - 1]
          ? followerDates[0]
          : `${followerDates[0]} 〜 ${followerDates[followerDates.length - 1]}`
        : null
    },
    { name: '映画.com', url: 'https://eiga.com/', use: 'よみ・生年月日（年齢の参考値）' }
  ],
  counts: {
    actors: rows.length,
    withX: rows.filter((r) => r.xFollowers != null).length,
    withIg: rows.filter((r) => r.igFollowers != null).length,
    withBirth: rows.filter((r) => r.birth).length,
    withErrors: rows.filter((r) => r.sourceErrors.length).length
  },
  actors: rows
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
process.stderr.write(`\nwrote ${OUT}  (${rows.length} actors, ${out.counts.withErrors} with source errors)\n`);
