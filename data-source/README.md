# Update Data

`datasets.csv` is the list of datasets to download from FRED.

Run `fetch_files.R` to download the data from FRED.

Then push the changes to github. 
## Michez rule inputs

- `tool-data/JTSJOL.csv`, `tool-data/UNEMPLOY.csv`, `tool-data/CLF16OV.csv`: job openings, unemployment and labor force levels from FRED (unadjusted for the site; fetched by `fetch_files.R`).
- `michez-vacancy-1951-2000.csv`: vacancy rate (job openings / labor force, %) for 1951–2000 from Barnichon (2010), "Building a Composite Help-Wanted Index", as used by Michaillat and Saez, "Has the Recession Started?" (Oxford Bulletin of Economics and Statistics, 2025). Source file: github.com/pmichaillat/michez-rule.
