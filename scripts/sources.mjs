// 外部データソースの取得ロジック。Wikipedia / Wikidata は使わない。
//   - ステージナタリー (natalie.mu) : 報道量・直近の活動量・SNSリンク・出演公演
//   - あちこちデータ (achikochi-data.com) : X / Instagram フォロワー数（数日〜2週間ごとに更新）
//   - 映画.com (eiga.com) : よみ・生年月日

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function get(url, { retries = 2 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en;q=0.8' },
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(1200 * (i + 1));
    }
  }
  throw new Error(`${url} -> ${lastErr.message}`);
}

const stripTags = (s) =>
  s
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const toNum = (s) => (s ? Number(String(s).replace(/,/g, '')) : null);

/* ------------------------------------------------------------------ *
 * ステージナタリー
 * ------------------------------------------------------------------ */

export async function natalieProfileId(name) {
  const h = await get('https://natalie.mu/search?query=' + encodeURIComponent(name));
  const i = h.indexOf('を含む人物');
  if (i < 0) return null;
  const chunk = h.slice(i, i + 20000);
  const re = /<a href="https:\/\/natalie\.mu\/profile\/(\d+)">[\s\S]{0,900}?NA_card_title[^>]*>([^<]+)</g;
  const cands = [];
  let m;
  while ((m = re.exec(chunk))) cands.push({ id: m[1], name: m[2].trim() });
  const exact = cands.find((c) => c.name === name);
  return exact ? exact.id : null;
}

export async function natalieArtist(id) {
  const h = await get(`https://natalie.mu/stage/artist/${id}`);
  const name = (h.match(/<title>([^<]*?)のプロフィール/) || [])[1] || null;
  const profile = (() => {
    const m = h.match(/<p id="profile">([\s\S]*?)<\/p>/);
    return m ? stripTags(m[1]) : null;
  })();

  // リンク欄（本人の公式 / X / Instagram）のみを見る。フッタの natalie 自社 SNS を拾わないため。
  const linkBlock = (h.match(/<ul class="NA_links">([\s\S]*?)<\/ul>/) || [])[1] || '';
  const hrefs = [...linkBlock.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const xUrl = hrefs.find((u) => /(^|\/\/)(www\.)?(x|twitter)\.com\//.test(u)) || null;
  const igUrl = hrefs.find((u) => /instagram\.com\//.test(u)) || null;
  const site = hrefs.find((u) => !/x\.com|twitter\.com|instagram\.com|natalie\.mu/.test(u)) || null;

  const handle = (u, host) => {
    if (!u) return null;
    const m = u.match(new RegExp(host + '\\/([A-Za-z0-9_.]+)'));
    return m ? m[1] : null;
  };

  // 出演公演（ステージナタリーが作品ページを持つもの）
  const a = h.indexOf('の公演・舞台');
  const b = h.indexOf('の映画作品');
  const seg = a >= 0 ? h.slice(a, b > a ? b : a + 30000) : '';
  const stages = [...new Set([...seg.matchAll(/NA_card_title[^>]*>([^<]+)</g)].map((m) => stripTags(m[1])))];

  return {
    natalieName: name,
    profile,
    officialSite: site,
    xHandle: handle(xUrl, '(?:x|twitter)\\.com'),
    igHandle: handle(igUrl, 'instagram\\.com'),
    stages: stages.slice(0, 10)
  };
}

function parseNatalieDate(s, today) {
  let m = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})月(\d{1,2})日$/);
  if (m) {
    const y = today.getUTCFullYear();
    let d = new Date(Date.UTC(y, +m[1] - 1, +m[2]));
    if (d.getTime() > today.getTime() + 86400000) d = new Date(Date.UTC(y - 1, +m[1] - 1, +m[2]));
    return d;
  }
  return null;
}

/** 人物ニュース一覧を、直近13ヶ月ぶんに届くまで（最大 maxPages）辿る。 */
export async function natalieNews(id, today, { maxPages = 4 } = {}) {
  const items = [];
  for (let p = 1; p <= maxPages; p++) {
    const url = p === 1 ? `https://natalie.mu/profile/${id}/news` : `https://natalie.mu/profile/${id}/news/page/${p}`;
    let h;
    try {
      h = await get(url, { retries: 1 });
    } catch {
      break;
    }
    const cards = [
      ...h.matchAll(/NA_card_title[^>]*>([^<]+)<[\s\S]{0,500}?NA_card_score">([\d,]*)<\/div>[\s\S]{0,300}?NA_card_date">([^<]+)</g)
    ];
    if (!cards.length) break;
    let oldest = null;
    for (const c of cards) {
      const d = parseNatalieDate(c[3].trim(), today);
      items.push({
        title: stripTags(c[1]),
        score: toNum(c[2]) || 0,
        date: d ? d.toISOString().slice(0, 10) : null
      });
      if (d) oldest = d;
    }
    await sleep(400);
    if (cards.length < 30) break;
    if (oldest && (today - oldest) / 86400000 > 400) break;
  }
  // 同一記事が複数ページにまたがることがあるので重複を落とす
  const seen = new Set();
  return items.filter((i) => {
    const k = i.title + '|' + i.date;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * あちこちデータ（フォロワー数）
 * ------------------------------------------------------------------ */

export async function achikochiSlug(name) {
  // まず素直な URL を試し、駄目ならサイト内検索で同名区別つきスラッグを探す
  try {
    await get('https://achikochi-data.com/content/person/' + encodeURIComponent(name) + '/', { retries: 0 });
    return name;
  } catch {
    /* fallthrough */
  }
  try {
    const h = await get('https://achikochi-data.com/?s=' + encodeURIComponent(name), { retries: 1 });
    const slugs = [...new Set([...h.matchAll(/\/content\/person\/([^"\/]+)\//g)].map((m) => decodeURIComponent(m[1])))];
    return slugs.find((s) => s.startsWith(name)) || null;
  } catch {
    return null;
  }
}

export async function achikochiPerson(slug) {
  let h;
  try {
    h = await get('https://achikochi-data.com/content/person/' + encodeURIComponent(slug) + '/', { retries: 1 });
  } catch {
    return null;
  }
  const t = stripTags(h);
  const xm = t.match(/X\(Twitter\)フォロワー数\s+([\d,]+)/);
  const igm = t.match(/Instagram\(インスタグラム\)フォロワー数\s+([\d,]+)/);
  const accounts = [];
  const ai = t.indexOf('アカウント名 フォロワー数');
  if (ai >= 0) {
    const seg = t.slice(ai + 12, ai + 400);
    const re = /([A-Za-z0-9_.]{2,20})\s+([\d,]{3,})/g;
    let m;
    while ((m = re.exec(seg))) accounts.push({ handle: m[1], followers: toNum(m[2]) });
  }
  const updated = (t.match(/(\d{4}\.\d{2}\.\d{2})/) || [])[1] || null;
  return {
    xFollowers: toNum(xm && xm[1]),
    igFollowers: toNum(igm && igm[1]),
    accounts,
    sourceUpdated: updated ? updated.replace(/\./g, '-') : null
  };
}

/* ------------------------------------------------------------------ *
 * 映画.com（よみ・生年月日）
 * ------------------------------------------------------------------ */

export async function eigaPersonId(name) {
  try {
    const h = await get('https://eiga.com/search/' + encodeURIComponent(name) + '/', { retries: 1 });
    const sec = h.slice(h.indexOf('人物'), h.indexOf('人物') + 8000);
    const m = (sec || h).match(/\/person\/(\d+)\//);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export async function eigaPerson(id) {
  let h;
  try {
    h = await get('https://eiga.com/person/' + id + '/', { retries: 1 });
  } catch {
    return null;
  }
  const t = stripTags(h);
  const yomi = (t.match(/ふりがな\s+([ぁ-んー\s]+?)\s+誕生日/) || [])[1] || null;
  const bm = t.match(/誕生日\s+(\d{4})年(\d{1,2})月(\d{1,2})日/);
  const birth = bm ? `${bm[1]}-${String(bm[2]).padStart(2, '0')}-${String(bm[3]).padStart(2, '0')}` : null;
  const origin = (t.match(/出身\s+([^\s]+)/) || [])[1] || null;
  return { yomi: yomi ? yomi.trim() : null, birth, origin };
}

/* ------------------------------------------------------------------ *
 * 本人・事務所の公式サイトから SNS アカウント名を拾う（リンク補完用）
 * ------------------------------------------------------------------ */

export async function snsHandlesFromSite(url) {
  if (!url) return {};
  let h;
  try {
    h = await get(url, { retries: 0 });
  } catch {
    return {};
  }
  const bad = /^(share|intent|home|i|hashtag|search|p|explore|accounts|reel|tv)$/i;
  const x = [...new Set([...h.matchAll(/https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{2,15})/g)].map((m) => m[1]))].filter(
    (s) => !bad.test(s)
  );
  const ig = [
    ...new Set([...h.matchAll(/https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]{2,30})/g)].map((m) => m[1]))
  ].filter((s) => !bad.test(s));
  return { xHandle: x[0] || null, igHandle: ig[0] || null };
}
