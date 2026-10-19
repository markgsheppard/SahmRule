// Builds data/intl_map.json, the map on the unlinked page "Where Recessions Reach the Labor Market" (#intl),
// from Natural Earth country outlines as packaged by world-atlas. The map changes only if this script does.
//
// Run from this folder (no keys needed):
//   npm install --no-save world-atlas@2.0.2 topojson-server@3.0.1 topojson-client@3.1.0 topojson-simplify@3.0.3 d3-geo@3.1.1
//   node build_intl_map.cjs
//
// Each country carries `c`, the page's code for a peer economy ("" for the countries drawn only as context), and `n`,
// its Natural Earth name; the small peers the page marks with dots (and Slovenia, Cyprus and Israel) also carry the
// longitude and latitude of their centroid.
const fs = require("fs"), path = require("path");
const d3 = require("d3-geo"), topojson = require("topojson-client"), server = require("topojson-server"), simp = require("topojson-simplify");
const w50 = require("world-atlas/countries-50m.json"), w110 = require("world-atlas/countries-110m.json");
const PEERS = { "United States of America": "US", "Canada": "CA", "United Kingdom": "UK", "Ireland": "IE", "France": "FR", "Belgium": "BE", "Netherlands": "NL", "Luxembourg": "LU", "Germany": "DE", "Austria": "AT", "Switzerland": "CH", "Denmark": "DK", "Sweden": "SE", "Norway": "NO", "Finland": "FI", "Åland": "FI", "Iceland": "IS", "Portugal": "PT", "Spain": "ES", "Italy": "IT", "Greece": "EL", "Malta": "MT", "Cyprus": "CY", "Poland": "PL", "Czechia": "CZ", "Slovakia": "SK", "Hungary": "HU", "Slovenia": "SI", "Croatia": "HR", "Romania": "RO", "Bulgaria": "BG", "Estonia": "EE", "Latvia": "LV", "Lithuania": "LT", "Japan": "JP", "South Korea": "KR", "Australia": "AU", "Israel": "IL" };
// detailed outlines (1:50m) for Europe's peers and their small neighbours; coarse ones (1:110m) for the large peers and for
// every other country in the world, so the page can draw the whole world (Antarctica is left out)
const FINE_CTX = ["Andorra", "Monaco", "San Marino", "Liechtenstein", "Vatican", "Jersey", "Guernsey", "Isle of Man", "Faeroe Is.", "N. Cyprus", "Kosovo", "Montenegro", "Macedonia", "Albania", "Bosnia and Herz.", "Serbia", "Moldova", "Lebanon", "Palestine"];
const COARSE_PEERS = ["United States of America", "Canada", "Australia"];
const pick = (w, keep) => topojson.feature(w, w.objects.countries).features.filter(f => keep(f.properties.name));
const fine = pick(w50, n => (PEERS[n] && !COARSE_PEERS.includes(n)) || FINE_CTX.includes(n)), fineN = new Set(fine.map(f => f.properties.name));
const feats = fine.concat(pick(w110, n => !fineN.has(n) && n !== "Antarctica"))
  .map(f => { const c = PEERS[f.properties.name] || "", pr = { c, n: f.properties.name };
    if (["MT", "LU", "CY", "IL", "SI"].includes(c)) { const ct = d3.geoCentroid(f); pr.lon = +ct[0].toFixed(3); pr.lat = +ct[1].toFixed(3); }
    return { type: "Feature", properties: pr, geometry: f.geometry }; });
const got = new Set(feats.map(f => f.properties.n));
console.log("features", feats.length, "missing", Object.keys(PEERS).filter(n => n !== "Åland").concat(FINE_CTX).filter(n => !got.has(n)));
let topo = server.topology({ countries: { type: "FeatureCollection", features: feats } }, 2e4);
topo = simp.simplify(simp.presimplify(topo), 0.02);
const out = JSON.stringify(topo), dest = path.join(__dirname, "..", "..", "data", "intl_map.json");
fs.writeFileSync(dest, out);
console.log("wrote", dest, out.length, "bytes");
