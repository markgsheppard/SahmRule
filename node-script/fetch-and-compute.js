const fs = require('fs')
const { compute_sahm_rule, computeStats } = require('../sahm/sahm_rule')

const fred_api_key = '6352ad3b393d3ab83709630e61d2b14e'

const config = {
	k: 3, // Base (Minued)
	m: 3, // Relative (Subtrahend)
	time_period: 13, // Time period
	seasonal: false, // Seasonal adjustment
	alpha_threshold: 0.5 // Alpha threshold. Shared across all lines
}

const data_base_url = './data-source'

async function fetchAndComputeSahm(seriesId) {
	try {
		// Fetch only base data
		const response = await fetchFromFRED(seriesId, '1990-01-01')

		const baseData = response.observations.map(d => {
			return {
				date: new Date(d.date),
				value: +d.value
			}
		})

		// Compute Sahm rule using the same data for both base and relative
		const computedData = compute_sahm_rule(
			baseData,
			baseData,
			config.k,
			config.m,
			config.time_period,
			config.seasonal
		)

		return computedData
	} catch (error) {
		console.error(`Error processing ${seriesId}:`, error)
	}

	return null
}

async function readAndParseCsvFile(path) {
	const text = await fs.promises.readFile(path, 'utf8')
	return parseSimpleCSV(text)
}

async function fetchFromFRED(seriesId, observationStart) {
	let url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${fred_api_key}&file_type=json`

	if (observationStart) {
		url += `&observation_start=${observationStart}`
	}

	const resp = await fetch(url)
	const data = await resp.json()
	return data
}

async function main() {
	const counties = await readAndParseCsvFile(`${data_base_url}/counties.csv`)
	const recessions = await fetchFromFRED('USREC', '1990-01-01')
  console.log(counties)
	const recessionData = new Map(
		recessions.observations.map(d => [new Date(d.date), +d.value])
	)

	const dataToSave = []

	const filteredCounties = counties.filter(x => x.SeriesId).slice(0, 1)

	for (const county of filteredCounties) {
		const result = await fetchAndComputeSahm(county.SeriesId)

		if (result) {
			const status = await computeStats(
				result,
				recessionData,
				config.alpha_threshold
			)
			dataToSave.push({
				...county,
				...status
			})
			console.log(`Succesfully computed ${county.SeriesId}`)
		} else {
			console.log(`Failed to compute ${county.SeriesId}`)
		}

		// Sleep for 5 seconds
		await new Promise(resolve => setTimeout(resolve, 5000))
	}

	const fileName = `${data_base_url}/computed/map-data.json`
	await fs.promises.writeFile(fileName, JSON.stringify(dataToSave, null, 2))
}

function parseSimpleCSV(csvString) {
  const rows = csvString.trim().split(/\r?\n/); // handles both \n and \r\n
  const headers = rows[0].split(',').map(h => h.trim()); // trim headers

  return rows.slice(1).map(row => {
    const values = row.split(',').map(v => v.trim()); // trim values
    return headers.reduce((obj, header, index) => {
      obj[header] = values[index];
      return obj;
    }, {});
  });
}

main()
