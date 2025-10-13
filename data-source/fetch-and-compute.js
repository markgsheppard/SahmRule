const fs = require('fs')
const path = require('path')
const { compute_sahm_rule, computeStats } = require('../sahm/sahm_rule')

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
		maxCounties: 10 // Set to number to limit processing, null for all
	}
}

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
 * Reads and parses a CSV file
 * @param {string} filePath - Path to the CSV file
 * @returns {Promise<Array>} Array of parsed CSV objects
 */
async function readAndParseCsvFile(filePath) {
	try {
		const fullPath = path.resolve(filePath)
		const text = await fs.promises.readFile(fullPath, 'utf8')
		return parseSimpleCSV(text)
	} catch (error) {
		console.error(`Error reading CSV file ${filePath}:`, error.message)
		throw error
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
			readAndParseCsvFile('./data-source/counties.csv'),
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
				// 1. Store county,date,unemployment_rate,sahm_value into a separate file with [county.SeriesId].csv file name

				const timeSeriesData = []

				// Process time series data
				for (let j = 0; j < result.computedData.length; j++) {
					const sahmValue = result.computedData[j].value
					const unemploymentRate = result.baseData[j].value
					const date = result.computedData[j].date.toISOString()

					timeSeriesData.push({
						county: county.County,
						date,
						unemployment_rate: unemploymentRate,
						sahm_value: sahmValue,
					})
				}

				await writeTimeSeriesFile(timeSeriesData, county.SeriesId);

				// Compute statistics
				const stats = computeStats(
					result.computedData,
					recessionData,
					config.alpha_threshold
				)

				aggregatedData.push({
					...county,
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
		
		console.log('\n✓ Sahm Rule computation completed successfully!')
		// console.log(`- Processed ${timeSeriesData.length} time series records`)
		// console.log(`- Generated statistics for ${aggregatedData.length} counties`)
		
	} catch (error) {
		console.error('Fatal error in main function:', error.message)
		process.exit(1)
	}
}

async function writeTimeSeriesFile(timeSeriesData, seriesId) {
	// Ensure output directory exists
	const outputDir = path.resolve('./data-source/computed')
	await fs.promises.mkdir(outputDir, { recursive: true })

	// Write time series data
	const timeSeriesHeader = 'county,date,unemployment_rate,sahm_value'
	const timeSeriesBody = getTimeSeriesCSV(timeSeriesData)
	const timeSeriesFile = path.join(outputDir, `${seriesId}.csv`)
	await fs.promises.writeFile(timeSeriesFile, `${timeSeriesHeader}\n${timeSeriesBody}`)
	console.log(`✓ Written time series data to ${timeSeriesFile}`)
}

/**
 * Writes the computed data to CSV files
 * @param {Array} timeSeriesData - Time series data array
 * @param {Array} aggregatedData - Aggregated statistics data array
 */
async function writeAggregatedDataFile(aggregatedData) {
	try {
		// Ensure output directory exists
		const outputDir = path.resolve('./data-source/computed')
		await fs.promises.mkdir(outputDir, { recursive: true })

		// if (timeSeriesData) {
		// 	// Write time series data
		// 	const timeSeriesHeader = 'county,date,unemployment_rate,sahm_value'
		// 	const timeSeriesBody = getTimeSeriesCSV(timeSeriesData)
		// 	const timeSeriesFile = path.join(outputDir, 'map-data-time-series.csv')
		// 	await fs.promises.writeFile(timeSeriesFile, `${timeSeriesHeader}\n${timeSeriesBody}`)
		// 	console.log(`✓ Written time series data to ${timeSeriesFile}`)
		// }

		// Write aggregated data
		const aggregatedHeader = 'county,series_id,accuracy,recession_lead_time,committee_lead_time'
		const aggregatedBody = getAggregatedCSV(aggregatedData)
		const aggregatedFile = path.join(outputDir, 'map-data-aggregated.csv')
		await fs.promises.writeFile(aggregatedFile, `${aggregatedHeader}\n${aggregatedBody}`)
		console.log(`✓ Written aggregated data to ${aggregatedFile}`)

		
	} catch (error) {
		console.error('Error writing output files:', error.message)
		throw error
	}
}

/**
 * Parses a simple CSV string into an array of objects
 * @param {string} csvString - The CSV string to parse
 * @returns {Array} Array of objects with CSV data
 */
function parseSimpleCSV(csvString) {
	if (!csvString || typeof csvString !== 'string') {
		throw new Error('Invalid CSV string provided')
	}
	
	const rows = csvString.trim().split(/\r?\n/)
	
	if (rows.length < 2) {
		throw new Error('CSV must have at least a header row and one data row')
	}
	
	const headers = rows[0].split(',').map(h => h.trim())
	
	return rows.slice(1)
		.filter(row => row.trim()) // Remove empty rows
		.map((row, index) => {
			const values = row.split(',').map(v => v.trim())
			
			if (values.length !== headers.length) {
				console.warn(`Row ${index + 2} has ${values.length} columns, expected ${headers.length}`)
			}
			
			return headers.reduce((obj, header, colIndex) => {
				obj[header] = values[colIndex] || ''
				return obj
			}, {})
		})
}

/**
 * Converts an array of objects to CSV format
 * @param {Array} data - Array of data objects
 * @param {Array} fields - Array of field names to include in CSV (in order)
 * @returns {string} CSV formatted string
 */
function arrayToCSV(data, fields) {
	if (!Array.isArray(data) || data.length === 0) {
		return ''
	}
	
	// Escape commas and quotes in CSV values
	const escapeCSV = (value) => {
		if (value === null || value === undefined) return ''
		const str = String(value)
		return str.includes(',') || str.includes('"') || str.includes('\n') 
			? `"${str.replace(/"/g, '""')}"` 
			: str
	}
	
	return data
		.map(d => fields.map(field => escapeCSV(d[field])).join(','))
		.join('\n')
}

/**
 * Converts time series data array to CSV format
 * @param {Array} data - Array of time series data objects
 * @returns {string} CSV formatted string
 */
function getTimeSeriesCSV(data) {
	const fields = ['county', 'date', 'unemployment_rate', 'sahm_value']
	return arrayToCSV(data, fields)
}

/**
 * Converts aggregated data array to CSV format
 * @param {Array} data - Array of aggregated data objects
 * @returns {string} CSV formatted string
 */
function getAggregatedCSV(data) {
	const fields = ['County', 'SeriesId', 'accuracy', 'recession_lead_time', 'committee_lead_time']
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
