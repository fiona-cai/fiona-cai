import fetch from "node-fetch";
import fs from "node:fs";
import path from "node:path";

const USERNAME = "fiona-cai";

// Your palette (light -> dark) for "more commits = darker"
const PALETTE = [
  "#EFCAD1", // lowest activity
  "#E9B8C1",
  "#C0D9BA",
  "#ABCCA3"  // highest activity
];

// GitHub-like sizes
const CELL = 11;
const GAP = 2;
const WEEKS = 53;
const DAYS = 7;

// padding around the grid
const PAD_X = 10;
const PAD_Y = 10;

function levelFromCount(count) {
  // GitHub uses quantized levels; we'll do a simple bucket.
  // You can tweak these thresholds if you want.
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 6) return 2;
  return 3;
}

function svgEscape(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function fetchCalendar(token) {
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
                weekday
              }
            }
          }
        }
      }
    }
  `;

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query,
      variables: { login: USERNAME }
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error: ${res.status}\n${text}`);
  }

  const json = await res.json();

  if (json.errors?.length) {
    throw new Error(`GraphQL errors:\n${JSON.stringify(json.errors, null, 2)}`);
  }

  return json.data.user.contributionsCollection.contributionCalendar;
}

function renderSVG(calendar) {
  const weeks = calendar.weeks;

  // Sometimes GitHub returns 52; pad to 53 for consistent width
  const paddedWeeks = [...weeks];
  while (paddedWeeks.length < WEEKS) paddedWeeks.unshift({ contributionDays: [] });
  if (paddedWeeks.length > WEEKS) paddedWeeks.splice(0, paddedWeeks.length - WEEKS);

  const width = PAD_X * 2 + WEEKS * CELL + (WEEKS - 1) * GAP;
  const height = PAD_Y * 2 + DAYS * CELL + (DAYS - 1) * GAP;

  // Transparent background so it blends into README
  const bg = "transparent";

  let rects = "";

  for (let x = 0; x < WEEKS; x++) {
    const week = paddedWeeks[x];
    const days = week.contributionDays ?? [];

    // Create a map weekday -> day data
    const byWeekday = new Map();
    for (const d of days) byWeekday.set(d.weekday, d);

    for (let y = 0; y < DAYS; y++) {
      const day = byWeekday.get(y);

      const count = day?.contributionCount ?? 0;
      const date = day?.date ?? "";
      const level = levelFromCount(count);
      const fill = PALETTE[level];

      const rx = 2; // rounded corners like GitHub
      const px = PAD_X + x * (CELL + GAP);
      const py = PAD_Y + y * (CELL + GAP);

      const title = date
        ? `${date}: ${count} contribution${count === 1 ? "" : "s"}`
        : "";

      rects += `
  <rect x="${px}" y="${py}" width="${CELL}" height="${CELL}" rx="${rx}" ry="${rx}" fill="${fill}">
    ${title ? `<title>${svgEscape(title)}</title>` : ""}
  </rect>`;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}"
     viewBox="0 0 ${width} ${height}"
     xmlns="http://www.w3.org/2000/svg"
     role="img"
     aria-label="GitHub contributions graph for ${USERNAME}">
  <rect width="100%" height="100%" fill="${bg}" />
  <g>
    ${rects}
  </g>
</svg>
`;
}

async function main() {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("Missing GH_TOKEN env var.");

  const calendar = await fetchCalendar(token);
  const svg = renderSVG(calendar);

  const outDir = path.join(process.cwd(), "assets");
  const outFile = path.join(outDir, "contributions.svg");

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, svg, "utf8");

  console.log(`Wrote ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
