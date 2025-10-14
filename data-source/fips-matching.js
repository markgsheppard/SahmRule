const path = require("path");
const fs = require("fs");
const { readAndParseCsvFile } = require("./utils.js");

const apiKey = process.env.FRED_API_KEY; // Replace with your actual API key

// Validate configuration
if (!apiKey) {
  throw new Error("FRED_API_KEY environment variable is not set");
}

async function main() {
  const countiesFull = await readAndParseCsvFile(
    path.join(__dirname, "counties-full.csv")
  );

  const existingCountyStateSet = new Set(countiesFull.map((d) => d.Fips_ID));

  const fipsMapping = await readAndParseCsvFile(
    path.join(__dirname, "fips-mapping-output.csv")
  );
  const fipsList = fipsMapping.filter(
    (d) => !existingCountyStateSet.has(d.Fips_ID)
  );
  console.log(fipsList)
  console.log(
    `Starting process to find series ids for ${fipsList.length} counties.`
  );

  // If no missing counties, we can optionally exit
  if (fipsList.length === 0) {
    console.log(
      "All counties already present in counties-full.csv. Nothing to fetch."
    );
    process.exit(0);
  }

  getUnemploymentRateSeries(fipsList, apiKey)
    .then((matchedSeries) => {
      console.log("Matched Series:", matchedSeries);
      // Prepare CSV header and rows
      const csvHeader = "County,SeriesId,Fips_ID,State";
      const csvRows = matchedSeries.map((row) =>
        [row.County, row.SeriesId, row.Fips_ID, row.State].join(",")
      );
      const csvContent = [...csvRows].join("\n");

      // Write to counties-full.csv in the current directory
      const outputPath = path.join(__dirname, "counties-full.csv");

      fs.appendFileSync(outputPath, "\n" + csvContent, "utf8");
      console.log(`Saved ${matchedSeries.length} records to counties-full.csv`);
    })
    .catch((error) => {
      console.error("Error:", error);
    });
}

async function getUnemploymentRateSeries(fipsList, apiKey) {
  const matchedSeries = [];

  // Iterate over the list of counties with FIPS codes
  for (const { Fips_ID: fips_code, County: county_name, State: stateAbbr } of fipsList) {
    // Search for the unemployment rate series for the county and state
    const url = new URL(
      `https://api.stlouisfed.org/fred/series/search?search_text=Unemployment Rate in ${county_name} county, ${stateAbbr}&api_key=${apiKey}&file_type=json`
    );

    try {
      const response = await fetch(url.href);
      const data = await response.json();

      // Check if data is valid and contains series data
      if (data && data.seriess) {
        // Filter series IDs based on state abbreviation and ending with "URN"
        const serie = data.seriess.find((d) => {
          if (d.frequency !== "Monthly") {
            return false;
          }
          if (d.id.startsWith(stateAbbr) && d.id.endsWith("URN")) {
            return true;
          }
          return d.title.startsWith("Unemployment Rate in ");
        });
        if (serie) {
          const seriesId = serie.id;
          console.log(
            "Found series id",
            seriesId,
            "For",
            county_name,
            `, ${stateAbbr}`,
            "Total found",
            matchedSeries.length
          );
          matchedSeries.push({
            County: county_name,
            SeriesId: seriesId,
            Fips_ID: fips_code,
            State: stateAbbr,
          });
        } else {
          throw new Error("Not found " + url);
        }
      } else {
        throw new Error("Not found " + url);
      }
    } catch (error) {
      console.error(
        `Error fetching data for ${county_name}, ${stateAbbr} and FIPS code ${fips_code}:`,
        error
      );
    }

    // Add a delay after every 100 requests to avoid overloading the API
    if (matchedSeries.length % 100 === 0 && matchedSeries.length !== 0) {
      console.log("Pausing for 2 seconds to avoid overloading the API...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  return matchedSeries;
}


if (require.main === module) {
	main()
}