const fs = require('fs')
const path = require('path')
const { compute_sahm_rule, computeStats } = require('../sahm/sahm_rule')
const {
  readAndParseCsvFile,
  arrayToCSV
} = require('./utils');

// Configuration management
const config = {
	k: 3, // Base (Minuend)
	m: 3, // Relative (Subtrahend)
	time_period: 13, // Time period
	seasonal: false, // Seasonal adjustment
	alpha_threshold: 0.5, // Alpha threshold. Shared across all lines
	fred: {
		apiKey: process.env.FRED_API_KEY,
		baseUrl: 'https://api.stlouisfed.org/fred/series/observations',
		rateLimitDelay: 1000, // 1 second delay between requests
		maxRequestsPerMinute: 120
	},
	data: {
		startDate: '1990-01-01',
		chunkRowSize: 150000,
		maxCounties: process.env.MAX_COUNTIES_TO_FETCH || null // Set to number to limit processing, null for all
	}
}

const outputDir = path.resolve('./data-source/map-data')

// Validate configuration
if (!config.fred.apiKey) {
	throw new Error('FRED_API_KEY environment variable is not set')
}

/**
 * Fetches unemployment data from FRED API and computes Sahm rule values
 * @param {string} seriesId - The FRED series ID for the unemployment data
 * @returns {Promise<Object>} Object containing baseData and computedData
 */
async function fetchAndComputeSahm(seriesId) {
	try {
		console.log(`Fetching data for series: ${seriesId}`)
		
		// Fetch unemployment data from FRED
		const response = await fetchFromFRED(seriesId, config.data.startDate)
		
		if (!response.observations || response.observations.length === 0) {
			throw new Error(`No observations found for series ${seriesId}`)
		}

		// Parse and validate the data
		const baseData = response.observations
			.filter(d => d.value !== '.' && d.value !== null) // Filter out missing values
			.map(d => {
				const value = parseFloat(d.value)
				if (isNaN(value)) {
					throw new Error(`Invalid value for date ${d.date}: ${d.value}`)
				}
				return {
					date: new Date(d.date),
					value: value
				}
			})

		if (baseData.length === 0) {
			throw new Error(`No valid observations found for series ${seriesId}`)
		}

		// Compute Sahm rule using the same data for both base and relative
		const computedData = compute_sahm_rule(
			baseData,
			baseData,
			config.k,
			config.m,
			config.time_period,
			config.seasonal
		)

		console.log(`Successfully computed Sahm rule for ${seriesId} (${baseData.length} observations)`)

		return {
			baseData,
			computedData,
		}
	} catch (error) {
		console.error(`Error processing ${seriesId}:`, error.message)
		return {
			baseData: null,
			computedData: null,
			error: error.message
		}
	}
}

/**
 * Fetches data from FRED API
 * @param {string} seriesId - The FRED series ID
 * @param {string} observationStart - Start date for observations
 * @returns {Promise<Object>} FRED API response data
 */
async function fetchFromFRED(seriesId, observationStart) {
	try {
		const url = new URL(config.fred.baseUrl)
		url.searchParams.set('series_id', seriesId)
		url.searchParams.set('api_key', config.fred.apiKey)
		url.searchParams.set('file_type', 'json')
		url.searchParams.set('frequency', 'm') // Monthly frequency
		
		if (observationStart) {
			url.searchParams.set('observation_start', observationStart)
		}

		const response = await fetch(url.toString())
		
		if (!response.ok) {
			throw new Error(`FRED API error: ${response.status} ${response.statusText}`)
		}
		
		const data = await response.json()
		
		if (data.error_code) {
			throw new Error(`FRED API error: ${data.error_message}`)
		}
		
		return data
	} catch (error) {
		console.error(`Error fetching from FRED for series ${seriesId}:`, error.message)
		throw error
	}
}

/**
 * Main function to process county unemployment data and compute Sahm rule statistics
 */
async function main() {
	try {
		console.log('Starting Sahm Rule computation...')
		
		// Read county data and fetch recession data
		const [counties, recessions] = await Promise.all([
			readAndParseCsvFile('./data-source/counties-full.csv'),
			fetchFromFRED('USREC', config.data.startDate)
		])

		console.log(`Processing ${counties.length} counties`)

		// Process recession data
		const recessionData = new Map(
			recessions.observations
				.filter(d => d.value !== '.' && d.value !== null)
				.map(d => [new Date(d.date), parseInt(d.value)])
		)


		const aggregatedData = []

		let chunkCounter = 0;
		let timeSeriesData = []

		// Filter counties with valid SeriesId and apply limit if configured
		const validCounties = counties.filter(county => county.SeriesId && county.SeriesId.trim())
		const countiesToProcess = config.data.maxCounties 
			? validCounties.slice(0, config.data.maxCounties)
			: validCounties

		console.log(`Processing ${countiesToProcess.length} counties with valid SeriesId`)

		// Process counties sequentially to respect rate limits
		for (let i = 0; i < countiesToProcess.length; i++) {
			const county = countiesToProcess[i]
			console.log(`Processing county ${i + 1}/${countiesToProcess.length}: ${county.County || county.SeriesId}`)
			
			const result = await fetchAndComputeSahm(county.SeriesId)

			if (result.computedData && result.baseData) {
				// Process time series data
				for (let j = 0; j < result.computedData.length; j++) {
					const sahmValue = result.computedData[j].value
					const unemploymentRate = result.baseData[j].value
					const date = result.computedData[j].date.toISOString().split("T")[0];

					timeSeriesData.push({
						// county: county.County,
						county_id: county.Fips_ID,
						date,
						unemployment_rate: unemploymentRate,
						sahm_value: isNaN(sahmValue) ? NaN : sahmValue.toFixed(2),
					})
				}

				if (timeSeriesData.length >= config.data.chunkRowSize) {
					chunkCounter++;
					await writeTimeSeriesFile(timeSeriesData, chunkCounter);
					timeSeriesData = [];
				}


				// Compute statistics
				const stats = computeStats(
					result.computedData,
					recessionData,
					config.alpha_threshold
				)

				aggregatedData.push({
					county_id: county.Fips_ID,
					...stats,
				})
				
				console.log(`✓ Successfully processed ${county.SeriesId}`)
			} else {
				console.log(`✗ Failed to process ${county.SeriesId}: ${result.error || 'Unknown error'}`)
			}

			// Rate limiting delay
			if (i < countiesToProcess.length - 1) {
				await new Promise(resolve => setTimeout(resolve, config.fred.rateLimitDelay))
			}
		}

		// Write output files
		await writeAggregatedDataFile(aggregatedData)

		if (timeSeriesData.length) {
			chunkCounter++;
			await writeTimeSeriesFile(timeSeriesData, chunkCounter);
			timeSeriesData = [];
		}

		await writeInfoFile(chunkCounter);
		
		console.log('\n✓ Sahm Rule computation completed successfully!')
		// console.log(`- Processed ${timeSeriesData.length} time series records`)
		// console.log(`- Generated statistics for ${aggregatedData.length} counties`)
		
	} catch (error) {
		console.error('Fatal error in main function:', error.message)
		process.exit(1)
	}
}

async function writeTimeSeriesFile(timeSeriesData, chunkCounter) {
	try {
		const timeSeriesHeader = 'county_id,date,unemployment_rate,sahm_value'
		const timeSeriesBody = getTimeSeriesCSV(timeSeriesData)
		const timeSeriesFile = path.join(outputDir, `chunk-${chunkCounter}.csv`)
		await fs.promises.writeFile(timeSeriesFile, `${timeSeriesHeader}\n${timeSeriesBody}`)
		console.log(`[writeTimeSeriesFile] ✓ Written time series data to ${timeSeriesFile}`)
	} catch (error) {
		console.error('[writeTimeSeriesFile] Error writing output files:', error.message)
		throw error
	}
}

async function writeInfoFile(totalChunks) {
	try {
		const infoFile = path.join(outputDir, `info.csv`)
		const header = `total_chunks,last_updated`
		const dataRow = `${totalChunks},${new Date().toISOString()}`;
		await fs.promises.writeFile(infoFile, `${header}\n${dataRow}`)
		console.log(`[writeInfoFile] ✓ Written info to ${infoFile}`)
	} catch (error) {
		console.error('[writeInfoFile] Error writing output files:', error.message)
		throw error
	}
}

/**
 * Writes the computed data to CSV files
 * @param {Array} aggregatedData - Aggregated statistics data array
 */
async function writeAggregatedDataFile(aggregatedData) {
	try {
		// Write aggregated data
		const aggregatedHeader = 'county_id,accuracy,recession_lead_time,committee_lead_time'
		const aggregatedBody = getAggregatedCSV(aggregatedData)
		const aggregatedFile = path.join(outputDir, 'map-data-aggregated.csv')
		await fs.promises.writeFile(aggregatedFile, `${aggregatedHeader}\n${aggregatedBody}`)
		console.log(`[writeAggregatedDataFile] ✓ Written aggregated data to ${aggregatedFile}`)
	} catch (error) {
		console.error('[writeAggregatedDataFile] Error writing output files:', error.message)
		throw error
	}
}

/**
 * Converts time series data array to CSV format
 * @param {Array} data - Array of time series data objects
 * @returns {string} CSV formatted string
 */
function getTimeSeriesCSV(data) {
	const fields = ['county_id', 'date', 'unemployment_rate', 'sahm_value']
	return arrayToCSV(data, fields)
}

/**
 * Converts aggregated data array to CSV format
 * @param {Array} data - Array of aggregated data objects
 * @returns {string} CSV formatted string
 */
function getAggregatedCSV(data) {
	const fields = ['county_id', 'accuracy', 'recession_lead_time', 'committee_lead_time']
	return arrayToCSV(data, fields)
}
// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
	console.error('Unhandled Rejection at:', promise, 'reason:', reason)
	process.exit(1)
})

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
	console.error('Uncaught Exception:', error)
	process.exit(1)
})

// Run the main function if this file is executed directly
if (require.main === module) {
	main()
}