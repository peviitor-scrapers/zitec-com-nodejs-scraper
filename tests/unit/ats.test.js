import { parseWorkable, parseSmartRecruiters, parseTeamtailor } from "../../scraper/ats.js";

const opts = { defaultWorkmode: "on-site", source: "test" };

describe("parseWorkable", () => {
  const payload = {
    jobs: [
      { title: "Dev ", shortcode: "A1", url: "https://apply.workable.com/j/A1", country: "Romania", city: "Cluj-Napoca",
        locations: [{ countryCode: "RO", city: "Cluj-Napoca" }] },
      { title: "Remote Dev", shortcode: "A2", url: "https://apply.workable.com/j/A2", country: "Romania", city: "Remote", telecommuting: true,
        locations: [{ countryCode: "RO", city: "Remote" }] },
      { title: "Berlin Dev", shortcode: "A3", url: "https://apply.workable.com/j/A3", country: "Germany", city: "Berlin",
        locations: [{ countryCode: "DE", city: "Berlin" }] },
      { title: "Dup", shortcode: "A1", url: "https://apply.workable.com/j/A1", country: "Romania", city: "Cluj-Napoca" }
    ]
  };

  it("keeps only Romanian jobs, once each", () => {
    const jobs = parseWorkable(payload, opts);
    expect(jobs.map((j) => j.url)).toEqual(["https://apply.workable.com/j/A1", "https://apply.workable.com/j/A2"]);
  });

  it("maps city, remote workmode and trims the title", () => {
    const [a, b] = parseWorkable(payload, opts);
    expect(a.title).toBe("Dev");
    expect(a.location).toEqual(["Cluj-Napoca"]);
    expect(a.workmode).toBe("on-site");
    expect(b.workmode).toBe("remote");
    expect(b.location).toEqual([]);
  });

  it("survives an empty or malformed payload", () => {
    expect(parseWorkable({}, opts)).toEqual([]);
    expect(parseWorkable(null, opts)).toEqual([]);
  });
});

describe("parseSmartRecruiters", () => {
  const payload = {
    content: [
      { id: "1", name: "QA Engineer", location: { city: "Cluj-Napoca", country: "ro", remote: false } },
      { id: "2", name: "Remote Dev", location: { city: "Employees can work remotely", country: "ro", remote: true } },
      { id: "3", name: "Abroad", location: { city: "Paris", country: "fr" } },
      { name: "No id", location: { country: "ro" } }
    ]
  };

  it("builds permalinks and filters by country", () => {
    const jobs = parseSmartRecruiters(payload, "Acme", opts);
    expect(jobs.map((j) => j.url)).toEqual([
      "https://jobs.smartrecruiters.com/Acme/1",
      "https://jobs.smartrecruiters.com/Acme/2"
    ]);
  });

  it("drops non-city locations and marks remote", () => {
    const [a, b] = parseSmartRecruiters(payload, "Acme", opts);
    expect(a.location).toEqual(["Cluj-Napoca"]);
    expect(b.location).toEqual([]);
    expect(b.workmode).toBe("remote");
  });
});

describe("parseTeamtailor", () => {
  const xml = `<rss><channel>
    <item><title>Dev &amp; Ops</title><link>https://careers.example.com/jobs/1-dev</link><remoteStatus>hybrid</remoteStatus></item>
    <item><title><![CDATA[Designer]]></title><link>https://careers.example.com/jobs/2-designer</link><remoteStatus>none</remoteStatus></item>
    <item><title>Dev &amp; Ops</title><link>https://careers.example.com/jobs/1-dev</link></item>
  </channel></rss>`;

  it("parses items, decodes entities and dedupes by link", () => {
    const jobs = parseTeamtailor(xml, opts);
    expect(jobs).toHaveLength(2);
    expect(jobs[0].title).toBe("Dev & Ops");
    expect(jobs[0].workmode).toBe("hybrid");
    expect(jobs[1].title).toBe("Designer");
    expect(jobs[1].workmode).toBe("on-site");
  });

  it("returns [] for an empty feed", () => {
    expect(parseTeamtailor("", opts)).toEqual([]);
  });
});
