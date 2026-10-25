// ATS source for this scraper. The company's careers page is client-rendered,
// so the jobs are read straight from the public job-board API behind it.
// Provider + slug live in scraper/config/scraper.json -> "ats".
//
//   workable         apply.workable.com widget API   (slug)
//   smartrecruiters  api.smartrecruiters.com         (slug, identifier)
//   teamtailor       <slug>.teamtailor.com/jobs.rss  (slug)
//
// Only Romanian postings are kept; every parse* function is pure so the unit
// tests need no network.
import fetch from "node-fetch";

const RO_COUNTRY = /^(ro|romania|rom[aâ]nia)$/i;
const NON_CITY = /remote|anywhere|hybrid|employees|work from|home/i;

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

const decode = (s) =>
  String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");

function uniq(list) {
  return [...new Set(list.filter(Boolean))];
}

/** Workable widget payload -> jobs located in Romania. */
export function parseWorkable(payload, { defaultWorkmode, source } = {}) {
  const out = [];
  const seen = new Set();
  for (const j of (payload && payload.jobs) || []) {
    const locs = Array.isArray(j.locations) ? j.locations : [];
    const roLocs = locs.filter((l) => RO_COUNTRY.test(l.countryCode || l.country || ""));
    const isRo = RO_COUNTRY.test(j.country || "") || roLocs.length > 0;
    const url = j.url || j.shortlink || (j.shortcode ? `https://apply.workable.com/j/${j.shortcode}` : null);
    if (!isRo || !j.title || !url || seen.has(url)) continue;
    seen.add(url);
    const cities = uniq((roLocs.length ? roLocs.map((l) => l.city) : [j.city]).map(clean)).filter((c) => !NON_CITY.test(c));
    out.push({
      url,
      title: clean(j.title),
      location: cities,
      workmode: j.telecommuting ? "remote" : defaultWorkmode,
      source
    });
  }
  return out;
}

/** SmartRecruiters postings page -> Romanian jobs. */
export function parseSmartRecruiters(payload, identifier, { defaultWorkmode, source } = {}) {
  const out = [];
  for (const p of (payload && payload.content) || []) {
    const loc = p.location || {};
    if (loc.country && !RO_COUNTRY.test(loc.country)) continue;
    if (!p.name || !p.id) continue;
    const city = clean(loc.city);
    out.push({
      url: `https://jobs.smartrecruiters.com/${identifier}/${p.id}`,
      title: clean(p.name),
      location: city && !NON_CITY.test(city) ? [city] : [],
      workmode: loc.remote ? "remote" : loc.hybrid ? "hybrid" : defaultWorkmode,
      source
    });
  }
  return out;
}

/** Teamtailor jobs.rss -> jobs (the feed carries only the company's own openings). */
export function parseTeamtailor(xml, { defaultWorkmode, source } = {}) {
  const out = [];
  const seen = new Set();
  for (const m of String(xml || "").matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = m[1];
    const title = clean(decode((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1]));
    const url = clean(decode((item.match(/<link>([\s\S]*?)<\/link>/) || [])[1]));
    const remote = clean((item.match(/<remoteStatus>([\s\S]*?)<\/remoteStatus>/) || [])[1]).toLowerCase();
    const city = clean(decode((item.match(/<tt:city>([\s\S]*?)<\/tt:city>/) || [])[1]));
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      title,
      location: city && !NON_CITY.test(city) ? [city] : [],
      workmode: remote === "fully" || remote === "remote" ? "remote" : remote === "hybrid" ? "hybrid" : defaultWorkmode,
      source
    });
  }
  return out;
}

async function getJson(url, { timeout, userAgent }) {
  const res = await fetch(url, { timeout, headers: { "User-Agent": userAgent, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${new URL(url).host} returned ${res.status}`);
  return res.json();
}

/**
 * Fetch every Romanian job from the configured ATS.
 * @param {{provider:string, slug:string, identifier?:string}} ats
 * @param {{defaultWorkmode?:string, source?:string, timeout?:number, userAgent?:string}} opts
 */
export async function fetchAtsJobs(ats, opts = {}) {
  const o = { timeout: 15000, userAgent: "job_seeker_ro_spider", ...opts };
  if (!ats || !ats.provider || !ats.slug) throw new Error("scraper.json is missing the ats {provider, slug} block");

  if (ats.provider === "workable") {
    const payload = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${ats.slug}?details=true`, o);
    return parseWorkable(payload, o);
  }

  if (ats.provider === "smartrecruiters") {
    const jobs = [];
    const identifier = ats.identifier || ats.slug;
    for (let offset = 0; offset < 1000; offset += 100) {
      const page = await getJson(
        `https://api.smartrecruiters.com/v1/companies/${ats.slug}/postings?country=ro&limit=100&offset=${offset}`,
        o
      );
      jobs.push(...parseSmartRecruiters(page, identifier, o));
      if (!page.content || page.content.length < 100) break;
    }
    return jobs;
  }

  if (ats.provider === "teamtailor") {
    const res = await fetch(`https://${ats.slug}.teamtailor.com/jobs.rss`, {
      timeout: o.timeout,
      headers: { "User-Agent": o.userAgent }
    });
    if (!res.ok) throw new Error(`teamtailor returned ${res.status}`);
    return parseTeamtailor(await res.text(), o);
  }

  throw new Error(`unknown ats provider: ${ats.provider}`);
}
