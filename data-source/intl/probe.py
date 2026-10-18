# Temporary probe, round 2: OECD quarterly real GDP (chain-linked volumes, SA) for the non-European peers.
import gzip, os, time, urllib.request, urllib.error
OUT = "data-source/intl/raw"; os.makedirs(OUT + "/_probe", exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (inequalityofrecession.com data pipeline; github actions)", "Accept": "*/*"}
def get(url):
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r: return r.status, r.read()
        except urllib.error.HTTPError as e:
            last = (e.code, e.read()[:3000])
            if e.code in (400, 404): return last
        except Exception as e: last = (0, str(e).encode())
        time.sleep(5)
    return last
log = []
OE = "https://sdmx.oecd.org/public/rest/data/OECD.SDD.NAD,DSD_NAMAIN1@DF_QNA,1.1/"
for name, key in [("oecd_qna_gdp_a.csv", "Q.Y..S1.S1.B1GQ._Z._Z._Z.XDC.LR.N.T0102"), ("oecd_qna_gdp_b.csv", "Q.Y..S1.S1.B1GQ....XDC.LR..")]:
    st, b = get(OE + key + "?startPeriod=1947-Q1&dimensionAtObservation=AllDimensions&format=csvfilewithlabels")
    log.append(f"{name}\t{st}\t{len(b)}\t{b[:200]!r}")
    if st == 200:
        with gzip.open(f"{OUT}/{name}.gz", "wb") as f: f.write(b)
        break
st, b = get("https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0/NZL+CHE.UNE_LF...Y._T.Y_GE15..Q?startPeriod=1980-Q1&dimensionAtObservation=AllDimensions&format=csvfilewithlabels")
log.append(f"oecd_une_q_nzl_che\t{st}\t{len(b)}\t{b[:200]!r}")
if st == 200:
    with gzip.open(f"{OUT}/oecd_une_q.csv.gz", "wb") as f: f.write(b)
with open(f"{OUT}/_probe/log2.tsv", "w") as f: f.write("\n".join(log) + "\n")
print("\n".join(log))
