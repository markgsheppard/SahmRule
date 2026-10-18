# Temporary probe: find out which endpoints answer from a GitHub runner and what they return.
import gzip, json, os, re, sys, time, urllib.request, urllib.error

OUT = "data-source/intl/raw"
os.makedirs(OUT + "/_probe", exist_ok=True)
LOG = []
UA = {"User-Agent": "Mozilla/5.0 (inequalityofrecession.com data pipeline; github actions)", "Accept": "*/*"}

def get(url, tries=3, timeout=300):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                b = r.read()
                if r.headers.get("Content-Encoding") == "gzip" or b[:2] == b"\x1f\x8b":
                    try: b = gzip.decompress(b)
                    except Exception: pass
                return r.status, b
        except urllib.error.HTTPError as e:
            last = (e.code, e.read()[:2000])
            if e.code in (400, 404): break
        except Exception as e:
            last = (0, str(e).encode())
        time.sleep(5 * (i + 1))
    return last

def save(name, url, gz=True):
    st, b = get(url)
    head = b[:300].decode("utf-8", "replace").replace("\n", " | ")
    LOG.append(f"{name}\t{st}\t{len(b)}\t{url}\t{head}")
    if st == 200:
        p = f"{OUT}/{name}" + (".gz" if gz else "")
        with (gzip.open(p, "wb") if gz else open(p, "wb")) as f: f.write(b)
    else:
        with open(f"{OUT}/_probe/{name}.err.txt", "wb") as f: f.write(b)
    return st, b

ES = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
save("eurostat_une_rt_m.json", ES + "une_rt_m?format=JSON&lang=EN&s_adj=SA&age=TOTAL&unit=PC_ACT&sex=T")
save("eurostat_namq_10_gdp.json", ES + "namq_10_gdp?format=JSON&lang=EN&na_item=B1GQ&s_adj=SCA&unit=CLV20_MEUR&unit=CLV15_MEUR&unit=CLV10_MEUR")

OE = "https://sdmx.oecd.org/public/rest/"
save("oecd_une_m_guess.csv", OE + "data/OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0/.UNE_LF_M...Y._T.Y_GE15..M?startPeriod=1955-01&dimensionAtObservation=AllDimensions&format=csvfilewithlabels")
st, b = save("oecd_dataflows.xml", OE + "dataflow/all/all/latest")
flows = []
if st == 200:
    txt = b.decode("utf-8", "replace")
    for m in re.finditer(r'<structure:Dataflow[^>]*id="([^"]+)"[^>]*agencyID="([^"]+)"[^>]*version="([^"]+)"', txt):
        flows.append(m.groups())
    if not flows:
        for m in re.finditer(r'id="([^"]+)"\s+agencyID="([^"]+)"\s+version="([^"]+)"', txt):
            flows.append(m.groups())
keep = [f for f in flows if re.search(r"QNA|IALFS_UNE|EPL|NAMAIN1", f[0])]
with open(f"{OUT}/_probe/oecd_flows_selected.txt", "w") as f:
    for x in keep: f.write("\t".join(x) + "\n")
for fid, ag, ver in keep:
    if not re.search(r"DF_QNA$|DF_QNA_EXPENDITURE_NATIO_CURR|DF_IALFS_UNE_M$", fid): continue
    st, b = get(OE + f"dataflow/{ag}/{fid}/{ver}?references=all&detail=referencepartial")
    if st == 200:
        txt = b.decode("utf-8", "replace")
        dims = re.findall(r'<structure:Dimension [^>]*id="([^"]+)"[^>]*position="(\d+)"', txt) or re.findall(r'<structure:Dimension id="([^"]+)"[^>]*position="(\d+)"', txt)
        with open(f"{OUT}/_probe/structure_{fid}.txt", "w") as f:
            f.write(f"{ag},{fid},{ver}\n")
            for d, p in sorted(dims, key=lambda z: int(z[1])): f.write(f"{p}\t{d}\n")
        with gzip.open(f"{OUT}/_probe/structure_{fid}.xml.gz", "wb") as f: f.write(b)
    LOG.append(f"structure {fid}\t{st}")

save("oecd_epl.csv", OE + "data/OECD.ELS.JAI,DSD_EPL@DF_EPL,/A..EPL_R+EPL_CD+EPL_T+EPL_OV..?format=csvfilewithlabels")
save("ons_lms.csv", "https://www.ons.gov.uk/file?uri=/employmentandlabourmarket/peopleinwork/employmentandemployeetypes/datasets/labourmarketstatistics/current/lms.csv")
save("ons_abmi.csv", "https://www.ons.gov.uk/generator?format=csv&uri=/economy/grossdomesticproductgdp/timeseries/abmi/qna", gz=False)
save("ons_mgsx.csv", "https://www.ons.gov.uk/generator?format=csv&uri=/employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/mgsx/lms", gz=False)

with open(f"{OUT}/_probe/log.tsv", "w") as f: f.write("\n".join(LOG) + "\n")
print("\n".join(LOG))
