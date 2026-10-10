// Builds compact county time-series files for the Inequality of Recession site map
// from the chunk-*.csv files written by fetch-and-compute.js.
// Output: data-source/map-data/sahm.json and data-source/map-data/unemployment.json
//   { ids: [county_id...], start: "YYYY-MM", n: months, scale, v: [[int|null, ...], ...] }
// Values are stored as integers (value * scale) to keep the files small.
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "map-data");
const files = fs.readdirSync(dir).filter(f => /^chunk-\d+\.csv$/.test(f));
if (!files.length) { console.error("No chunk files found in", dir); process.exit(1); }

const rows = new Map(); // id -> Map(monthIndex -> [ur, sahm])
let minM = Infinity, maxM = -Infinity;
const mi = d => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return y * 12 + (m - 1); };

for (const f of files) {
  const lines = fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/);
  const head = lines[0].split(",");
  const iId = head.indexOf("county_id"), iD = head.indexOf("date"), iU = head.indexOf("unemployment_rate"), iS = head.indexOf("sahm_value");
  for (let k = 1; k < lines.length; k++) {
    const line = lines[k]; if (!line) continue;
    const c = line.split(",");
    const id = c[iId].padStart(5, "0"), t = mi(c[iD]);
    const u = parseFloat(c[iU]), s = parseFloat(c[iS]);
    if (!rows.has(id)) rows.set(id, new Map());
    rows.get(id).set(t, [u, s]);
    if (t < minM) minM = t; if (t > maxM) maxM = t;
  }
}

const ids = [...rows.keys()].sort();
const n = maxM - minM + 1;
const start = `${Math.floor(minM / 12)}-${String((minM % 12) + 1).padStart(2, "0")}`;
const build = (idx, scale) => ({
  ids, start, n, scale,
  v: ids.map(id => { const r = rows.get(id); return Array.from({ length: n }, (_, j) => { const x = r.get(minM + j); const v = x ? x[idx] : NaN; return Number.isFinite(v) ? Math.round(v * scale) : null; }); })
});
fs.writeFileSync(path.join(dir, "sahm.json"), JSON.stringify(build(1, 100)));
fs.writeFileSync(path.join(dir, "unemployment.json"), JSON.stringify(build(0, 10)));
console.log(`Wrote sahm.json and unemployment.json: ${ids.length} counties, ${n} months from ${start}`);
