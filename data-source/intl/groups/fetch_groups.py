# Temporary fetch for the Journal of Economic Inequality replication package: monthly unemployment rates by age and
# by sex for the peer economies, from Eurostat and the OECD (no keys needed). Results are committed to this branch only.
import gzip, os, time, urllib.request, urllib.error

OUT = "data-source/intl/groups"
LOG = []
UA = {"User-Agent": "Mozilla/5.0 (inequalityofrecession.com data pipeline; github actions)", "Accept": "*/*"}

def get(url, tries=4, timeout=600):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                b = r.read()
                if b[:2] == b"\x1f\x8b":
                    try: b = gzip.decompress(b)
                    except Exception: pass
                return r.status, b
        except urllib.error.HTTPError as e:
            last = (e.code, e.read()[:2000])
            if e.code in (400, 404): break
        except Exception as e:
            last = (0, str(e).encode())
        time.sleep(15 * (i + 1))
    return last

def save(name, url):
    st, b = get(url)
    LOG.append(f"{name}\t{st}\t{len(b)}\t{url}\t" + b[:200].decode("utf-8", "replace").replace("\n", " | "))
    if st == 200:
        with gzip.open(f"{OUT}/{name}.gz", "wb") as f: f.write(b)

ES = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
OE = "https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0/"
save("oecd_une_m_age.csv", OE + ".UNE_LF_M...Y._T.Y15T24+Y25T74+Y_GE25..M?startPeriod=1955-01&dimensionAtObservation=AllDimensions&format=csvfilewithlabels")
time.sleep(20)
save("oecd_une_m_sex.csv", OE + ".UNE_LF_M...Y.M+F.Y_GE15..M?startPeriod=1955-01&dimensionAtObservation=AllDimensions&format=csvfilewithlabels")

with open(f"{OUT}/log2.tsv", "w") as f: f.write("\n".join(LOG) + "\n")
print("\n".join(LOG))
