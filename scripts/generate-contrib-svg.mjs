import fetch from "node-fetch";
import fs from "node:fs";
import path from "node:path";

const USERNAME = "fiona-cai";

// Your palette: no activity, then lowest -> highest
const PALETTE = [
  "#97BAA9", // no activity
  "#ABCCA3", // lowest
  "#C8D9AA",
  "#F3DEB4",
  "#FBD2C6"  // highest
];

// GitHub-like sizes
const CELL = 11;
const GAP = 2;
const WEEKS = 53;
const DAYS = 7;

// padding around the grid
const PAD_X = 10;
const PAD_Y = 10;
const HEADER_HEIGHT = 24;
const LEGEND_HEIGHT = 28;

function levelFromCount(count) {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
}

function svgEscape(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function ordinal(n) {
  const s = String(n);
  if (s.endsWith("11") || s.endsWith("12") || s.endsWith("13")) return s + "th";
  if (s.endsWith("1")) return s + "st";
  if (s.endsWith("2")) return s + "nd";
  if (s.endsWith("3")) return s + "rd";
  return s + "th";
}

function formatTooltipDate(dateStr, count) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const month = MONTHS[m - 1];
  const day = ordinal(d);
  return `${count} contribution${count === 1 ? "" : "s"} on ${month} ${day}`;
}

async function fetchCalendar(token) {
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
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
  const totalContributions = calendar.totalContributions ?? 0;

  // Sometimes GitHub returns 52; pad to 53 for consistent width
  const paddedWeeks = [...weeks];
  while (paddedWeeks.length < WEEKS) paddedWeeks.unshift({ contributionDays: [] });
  if (paddedWeeks.length > WEEKS) paddedWeeks.splice(0, paddedWeeks.length - WEEKS);

  const gridWidth = PAD_X * 2 + WEEKS * CELL + (WEEKS - 1) * GAP;
  const gridHeight = PAD_Y * 2 + DAYS * CELL + (DAYS - 1) * GAP;
  const width = gridWidth;
  const height = HEADER_HEIGHT + gridHeight + LEGEND_HEIGHT;

  // Transparent background so it blends into README
  const bg = "transparent";
  const textColor = "#8b949e"; // GitHub-style muted gray, readable on light/dark

  let rects = "";
  const gridOffsetY = HEADER_HEIGHT + PAD_Y;

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
      const py = gridOffsetY + y * (CELL + GAP);

      const title = date ? formatTooltipDate(date, count) : "";

      rects += `
  <rect x="${px}" y="${py}" width="${CELL}" height="${CELL}" rx="${rx}" ry="${rx}" fill="${fill}">
    ${title ? `<title>${svgEscape(title)}</title>` : ""}
  </rect>`;
    }
  }

  // Summary text: "X contributions in the last year"
  const summaryText = `${totalContributions} contribution${totalContributions === 1 ? "" : "s"} in the last year`;

  // Legend: Less [swatches] More
  const legendY = height - 14;
  const legendSwatchSize = 10;
  const legendGap = 2;
  const legendStartX = width - 120;

  let legendSwatches = "";
  for (let i = 0; i < PALETTE.length; i++) {
    const lx = legendStartX + i * (legendSwatchSize + legendGap);
    legendSwatches += `\n  <rect x="${lx}" y="${legendY - legendSwatchSize + 2}" width="${legendSwatchSize}" height="${legendSwatchSize}" rx="2" ry="2" fill="${PALETTE[i]}"/>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}"
     viewBox="0 0 ${width} ${height}"
     xmlns="http://www.w3.org/2000/svg"
     role="img"
     aria-label="GitHub contributions graph for ${USERNAME}">
  <rect width="100%" height="100%" fill="${bg}" />
  <text x="0" y="16" font-family="system-ui, -apple-system, sans-serif" font-size="12" fill="${textColor}">${svgEscape(summaryText)}</text>
  <g>
    ${rects}
  </g>
  <text x="${legendStartX - 32}" y="${legendY}" font-family="system-ui, -apple-system, sans-serif" font-size="9" fill="${textColor}">Less</text>
  ${legendSwatches}
  <text x="${legendStartX + PALETTE.length * (legendSwatchSize + legendGap) + 6}" y="${legendY}" font-family="system-ui, -apple-system, sans-serif" font-size="9" fill="${textColor}">More</text>
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
