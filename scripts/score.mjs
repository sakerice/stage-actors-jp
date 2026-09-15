/**
 * ランキングのスコア計算。update-ranking.mjs（収集つき）と rescore.mjs（再計算のみ）で共用する。
 * 重みや欠測の扱いを変えたいときは、このファイルだけを直せばよい。
 */

const NOW_DEFAULT = new Date();

export const WEIGHTS = {
  xFollowers: 0.22,
  igFollowers: 0.18,
  xPostFrequency: 0.1,
  newsCoverage: 0.28,
  recentActivity: 0.22
};

/** 欠測軸に当てる代替値の位置。実測できた人を並べたときの下位 25%。 */
const UNMEASURED_PERCENTILE = 0.25;

export const FREQ_SCORE = {
  'ほぼ毎日': 1,
  '週3〜5回': 0.8,
  '週1〜2回': 0.55,
  '月数回': 0.3,
  'ほぼ更新なし': 0.05
};


/** 観測値の最小〜最大で 0..1 に伸ばす。全部同値なら 0.5。 */
function normalizer(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return (v) => {
    if (!Number.isFinite(v)) return null;
    if (max === min) return 0.5;
    return (v - min) / (max - min);
  };
}

/**
 * フォロワー数用。下限を固定（1000 人 = 0 点）にして、0 人と最下位を地続きにする。
 * こうしないと「アカウントを持っていない人」を 0 点として他と並べられない。
 */
const FOLLOWER_FLOOR_LOG = 3; // log10(1000)
function followerNormalizer(values) {
  const max = Math.max(...values.filter((v) => Number.isFinite(v)), FOLLOWER_FLOOR_LOG + 0.1);
  const span = max - FOLLOWER_FLOOR_LOG;
  return (v) => {
    if (!Number.isFinite(v)) return null;
    return Math.min(1, Math.max(0, (v - FOLLOWER_FLOOR_LOG) / span));
  };
}


export function score(rows, now = NOW_DEFAULT) {
  const days = (d) => (now - new Date(d)) / 86400000;
  const log = (v) => (v == null ? null : Math.log10(v + 1));

  // ニュース取り上げられ度: 記事数と注目度（閲覧スコア）の合成
  const newsRaw = rows.map((r) =>
    r.news12m == null ? null : Math.log10((r.news12m || 0) + 1) * 0.6 + Math.log10((r.newsAttention12m || 0) + 1) * 0.4
  );
  // 直近の活動量: 90日の記事数・最新記事の鮮度・掲載中の出演公演数
  const actRaw = rows.map((r) => {
    if (r.news90d == null) return null;
    const freshness = r.daysSinceNews == null ? 0 : Math.max(0, 1 - r.daysSinceNews / 180);
    // 公演は「直近12ヶ月に上演があったもの」を数える。人物ページの表示上限(8件)は使わない。
    const recentPlays = r.stages12m != null ? r.stages12m : (r.stages?.length || 0);
    return Math.log10((r.news90d || 0) + 1) * 0.55 + freshness * 0.3 + Math.log10(recentPlays + 1) * 0.15;
  });

  const nx = followerNormalizer(rows.map((r) => log(r.xFollowers)));
  const nig = followerNormalizer(rows.map((r) => log(r.igFollowers)));
  const nnews = normalizer(newsRaw);
  const nact = normalizer(actRaw);

  // フォロワー数が無いときの扱いは 3 通り。断定できないものを 0 点にはしない。
  //   数値あり           … そのまま正規化
  //   アカウント無しと確認 … 発信力ゼロという実測値なので 0 点（roster.json の noAccount で明示）
  //   それ以外（未確認）   … 欠測。あとで控えめな代替値を当てる
  const axis = (followers, confirmedNone, norm) => {
    if (followers != null) return norm(Math.log10(followers + 1));
    return confirmedNone ? 0 : null;
  };

  const raw = rows.map((r, i) => ({
    xFollowers: axis(r.xFollowers, r.xAccountState === 'none', nx),
    igFollowers: axis(r.igFollowers, r.igAccountState === 'none', nig),
    xPostFrequency: r.xPostFrequency ? (FREQ_SCORE[r.xPostFrequency] ?? null) : null,
    newsCoverage: nnews(newsRaw[i]),
    recentActivity: nact(actRaw[i])
  }));

  // 欠測軸の埋め方
  //   ・誰一人として値が無い軸（現状の X 投稿頻度）は、全員同条件なので軸ごと落として重みを按分する。
  //   ・一部の人だけ欠測している軸は、落とすと「測れない人ほど得をする」逆転が起きる。
  //     4 つのソースを当たって数値が出てこなかった以上、大きなアカウントを持つ可能性は低いとみて、
  //     実測できた人の下位 25 パーセンタイル相当を代替値として当てる（低めの見積もり）。
  const fallback = {};
  const droppedAxes = [];
  for (const k of Object.keys(WEIGHTS)) {
    const measured = raw.map((m) => m[k]).filter((v) => v != null).sort((a, b) => a - b);
    if (!measured.length) {
      droppedAxes.push(k);
      continue;
    }
    fallback[k] = measured[Math.floor((measured.length - 1) * UNMEASURED_PERCENTILE)];
  }

  const activeWeightSum = Object.keys(WEIGHTS)
    .filter((k) => !droppedAxes.includes(k))
    .reduce((s, k) => s + WEIGHTS[k], 0);

  rows.forEach((r, i) => {
    const m = raw[i];
    const measured = [];
    const imputed = [];
    let total = 0;
    for (const k of Object.keys(WEIGHTS)) {
      if (droppedAxes.includes(k)) continue;
      const w = WEIGHTS[k] / activeWeightSum;
      if (m[k] != null) {
        measured.push(k);
        total += w * m[k];
      } else {
        imputed.push(k);
        total += w * fallback[k];
        m[k] = fallback[k];
      }
    }
    r.metrics = m;
    r.measuredAxes = measured;
    r.imputedAxes = imputed;
    r.droppedAxes = droppedAxes;
    r.coverage = measured.length;
    r.coverageOf = Object.keys(WEIGHTS).length - droppedAxes.length;
    r.score = Math.round(total * 1000) / 10;
  });

  rows.sort((a, b) => b.score - a.score || (b.xFollowers || 0) - (a.xFollowers || 0));
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

