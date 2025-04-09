const fs = require('fs')
const { compute_sahm_rule, computeStats } = require('../sahm/sahm_rule')

const fred_api_key = process.env.FRED_API_KEY
if (!fred_api_key) {
	throw new Error('FRED_API_KEY environment variable is not set')
}

const config = {
	k: 3, // Base (Minued)
	m: 3, // Relative (Subtrahend)
	time_period: 13, // Time period
	seasonal: false, // Seasonal adjustment
	alpha_threshold: 0.5 // Alpha threshold. Shared across all lines
}

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

		const currentUnemploymentRate = baseData[baseData.length - 1].value

		// Compute Sahm rule using the same data for both base and relative
		const computedData = compute_sahm_rule(
			baseData,
			baseData,
			config.k,
			config.m,
			config.time_period,
			config.seasonal
		)

		return {
			computedData,
			currentUnemploymentRate
		}
	} catch (error) {
		console.error(`Error processing ${seriesId}:`, error)
	}

	return {
		computedData: null,
		currentUnemploymentRate: null
	}
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
	const counties = await readAndParseCsvFile(`./data-source/counties.csv`)
	const recessions = await fetchFromFRED('USREC', '1990-01-01')

	console.log('Going to fetch data for', counties.length, 'counties')

	const recessionData = new Map(
		recessions.observations.map(d => [new Date(d.date), +d.value])
	)

	const dataToSave = []

	const filteredCounties = counties.filter(x => x.SeriesId)

	for (const county of filteredCounties) {
		const { computedData, currentUnemploymentRate } = await fetchAndComputeSahm(
			county.SeriesId
		)

		if (computedData) {
			const status = await computeStats(
				computedData,
				recessionData,
				config.alpha_threshold
			)
			dataToSave.push({
				...county,
				...status,
				last_sahm_value: computedData[computedData.length - 1].value,
				current_unemployment_rate: currentUnemploymentRate
			})
			console.log(`Succesfully computed ${county.SeriesId}`)
		} else {
			console.log(`Failed to compute ${county.SeriesId}`)
		}

		// Sleep for 1 second (1000ms) to stay under FRED's rate limit of 120 requests/minute
		await new Promise(resolve => setTimeout(resolve, 1000))
	}

	const header =
		'county,series_id,accuracy,recession_lead_time,committee_lead_time,last_sahm_value,current_unemployment_rate'
	const body = convertToSimpleCSV(dataToSave)

	const fileName = `./data-source/computed/map-data.csv`
	await fs.promises.writeFile(fileName, `${header}\n${body}`)
}

function parseSimpleCSV(csvString) {
	const rows = csvString.trim().split(/\r?\n/) // handles both \n and \r\n
	const headers = rows[0].split(',').map(h => h.trim()) // trim headers

	return rows.slice(1).map(row => {
		const values = row.split(',').map(v => v.trim()) // trim values
		return headers.reduce((obj, header, index) => {
			obj[header] = values[index]
			return obj
		}, {})
	})
}

function convertToSimpleCSV(data) {
	return data
		.map(
			d =>
				`${d.County},${d.SeriesId},${d.accuracy},${d.recession_lead_time},${d.committee_lead_time},${d.last_sahm_value},${d.current_unemployment_rate}`
		)
		.join('\n')
}

main()
