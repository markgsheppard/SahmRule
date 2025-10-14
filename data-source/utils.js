const path = require("path")
const fs = require("fs")

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
			const values = row.split(',').map(v => v.trim().replaceAll("\"", ""))
			
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

module.exports = {
  readAndParseCsvFile,
  arrayToCSV
}