import {
	calculateAccuracyPercent,
	calculateDaysToNearestDateWithSummary,
	compute_sahm_rule,
	getRecessionPeriods,
	getSahmStarts
} from './sahm_rule.js'
import vRecessionIndicatorChart from '../vis/v-recession-indicator-chart.js'

const getRandomId = () => {
	return (
		Math.random().toString(36).substring(2, 15) +
		Math.random().toString(36).substring(2, 15)
	)
}

const defaultSettings = {
	base: 'UNRATE', // Base dataset
	relative: 'UNRATE', // Relative dataset
	recession: 'USREC', // Recession dataset. Shared across all lines
	k: 3, // Base (Minued)
	m: 3, // Relative (Subtrahend)
	time_period: 13, // Time period
	seasonal: false, // Seasonal adjustment
	alpha_threshold: 0.5 // Alpha threshold. Shared across all lines
}

const data_base_url = '../data-source'

// Statistics constants
const accuracy_time_range = 200
const committee_time_range = 250
const committee_starts = [
	new Date('2020-06-08'),
	new Date('2008-12-01'),
	new Date('2001-11-26'),
	new Date('1991-04-25'),
	new Date('1982-01-06'),
	new Date('1980-06-03')
]

const getUrl = series_id => {
	return `${data_base_url}/data/${series_id}.csv`
}

class SahmRuleDashboard {
	constructor() {
		// Track list of available datasets and their configurations
		this.datasetsList = []
		// Store configurations for each line series being displayed
		this.lineConfigs = []
		// Track which line series is currently selected
		this.currentLineId = null
		// Cache fetched data to improve performance
		this.dataCache = new Map()
		// Store recession indicator data
		this.recessionData = new Map()

		this.init()
	}

	async addLine() {
		// Creates a new data series with default settings
		const config = {
			id: getRandomId(),
			...defaultSettings
		}

		// Fetch all required data in parallel
		const [base_data, relative_data] = await Promise.all([
			this.fetchFile(config.base),
			this.fetchFile(config.relative),
			this.loadRecessionData(config.recession)
		])

		config.base_data = base_data
		config.relative_data = relative_data

		this.lineConfigs.push(config)
		this.selectLine(config.id)

		// Triggers initial render with base data
		this.updateCurrentLine('base', config.base)
	}

	selectLine(id) {
		// Update currently selected line and refresh UI
		this.currentLineId = id
		this.updateFormElements()

		const config = this.lineConfigs.find(l => l.id === this.currentLineId)

		if (!config) {
			return
		}

		this.updateStats(config)
	}

	async updateCurrentLine(key, value) {
		// Handle updates to any configuration parameter for the current line
		const config = this.lineConfigs.find(l => l.id === this.currentLineId)

		if (!config) {
			return
		}

		config[key] = value

		// Fetch new data if base or relative series changed
		if (key === 'base') {
			config.base_data = await this.fetchFile(value)
		} else if (key === 'relative') {
			config.relative_data = await this.fetchFile(value)
		} else if (key === 'recession') {
			await this.loadRecessionData(value)
		}

		// Realign data if either series changed
		if (key === 'base' || key === 'relative') {
			this.alignData(config)
		}

		// Recompute Sahm rule with updated parameters
		const computed_data = compute_sahm_rule(
			config.base_data,
			config.relative_data,
			config.k,
			config.m,
			config.time_period,
			config.seasonal
		)

		config.computed_data = computed_data

		// Update statistics and visualization
		this.computeStats(computed_data, config)
		this.updateStats(config)
		this.drawChart()
	}

	alignData(config) {
		// Ensure base and relative data series align on same date range
		const { base_data, relative_data } = config

		// Find overlapping date range
		const start_date = Math.max(base_data[0].date, relative_data[0].date)
		const end_date = Math.min(
			base_data[base_data.length - 1].date,
			relative_data[relative_data.length - 1].date
		)

		// Filter both series to matching range
		config.base_data = base_data.filter(
			d => d.date >= start_date && d.date <= end_date
		)
		config.relative_data = relative_data.filter(
			d => d.date >= start_date && d.date <= end_date
		)
	}

	updateFormElements() {
		// Update all UI controls to reflect current line's settings
		const config = this.lineConfigs.find(l => l.id === this.currentLineId)

		if (!config) {
			return
		}

		// Update slider labels
		this.updateSliderLabel('#k-slider', config.k)
		this.updateSliderLabel('#m-slider', config.m)
		this.updateSliderLabel('#time-period-slider', config.time_period)
		this.updateSliderLabel('#alpha-slider', config.alpha_threshold)

		// Update slider values
		this.updateElementValue('#k-slider', config.k)
		this.updateElementValue('#m-slider', config.m)
		this.updateElementValue('#time-period-slider', config.time_period)
		this.updateElementValue('#alpha-slider', config.alpha_threshold)

		// Update other form controls
		this.updateCheckbox('#seasonal-checkbox', config.seasonal)
		this.updateElementValue('#base-select', config.base)
		this.updateElementValue('#relative-select', config.relative)
		this.updateElementValue('#recession-select', config.recession)
	}

	async getDatasetsList() {
		try {
			const resp = await d3.csv(`${data_base_url}/datasets.csv`)
			return resp
		} catch (error) {
			console.error(error)
			return []
		}
	}

	async loadRecessionData(recessionCode) {
		const resp = await this.fetchFile(recessionCode)
		this.recessionData = new Map(resp.map(d => [d.date, d.value]))
	}

	computeStats(computed_data, config) {
		const sahm_starts = getSahmStarts(computed_data, this.alpha_threshold)

		const threeMonths = new Date(sahm_starts[0])
		threeMonths.setMonth(threeMonths.getMonth() - 3)

		const rec_data = []

		for (const [date, value] of this.recessionData.entries()) {
			if (date >= threeMonths) {
				rec_data.push({
					date,
					value
				})
			}
		}

		const recession_starts = getRecessionPeriods(rec_data).map(d => d.start)

		const accuracy = Math.round(
			calculateAccuracyPercent(
				sahm_starts,
				recession_starts,
				accuracy_time_range
			)
		)

		const recession_lead_time = Math.round(
			calculateDaysToNearestDateWithSummary(
				sahm_starts,
				recession_starts,
				accuracy_time_range
			).overall_average_days
		)

		const committee_lead_time = Math.round(
			calculateDaysToNearestDateWithSummary(
				sahm_starts,
				committee_starts,
				committee_time_range
			).average_days_leading
		)

		config.accuracy = accuracy
		config.recession_lead_time = recession_lead_time
		config.committee_lead_time = committee_lead_time
	}

	updateStats(config) {
		d3.select('#accuracy').html(config.accuracy + '%')
		d3.select('#recession_lead_time').html(config.recession_lead_time)
		d3.select('#committee_lead_time').html(config.committee_lead_time)
	}

	async fetchFile(fileId) {
		if (this.dataCache.has(fileId)) {
			return this.dataCache.get(fileId)
		}

		try {
			const resp = await d3.csv(getUrl(fileId), d3.autoType)
			this.dataCache.set(fileId, resp)
			return resp
		} catch (error) {
			console.error(error)
			return []
		}
	}

	async init() {
		// Load available datasets
		this.datasetsList = await this.getDatasetsList()

		// Separate recession indicators from other datasets
		const nonRecessionList = this.datasetsList.filter(
			d => d.Header !== 'Recessions'
		)
		const recessionList = this.datasetsList.filter(
			d => d.Header === 'Recessions'
		)

		// Initialize dropdown menus
		this.fillSelectDropdown('#base-select', nonRecessionList, datum => {
			this.updateCurrentLine('base', datum.Code)
		})

		this.fillSelectDropdown('#relative-select', nonRecessionList, datum => {
			this.updateCurrentLine('relative', datum.Code)
		})

		this.fillSelectDropdown('#recession-select', recessionList, async datum => {
			this.updateCurrentLine('recession', datum.Code)
		})

		// Set up event listeners for all controls
		this.listenForChanges('#k-slider', value => {
			this.updateCurrentLine('k', value)
		})

		this.listenForChanges('#m-slider', value => {
			this.updateCurrentLine('m', value)
		})

		this.listenForChanges('#time-period-slider', value => {
			this.updateCurrentLine('time_period', value)
		})

		this.listenForChanges('#alpha-slider', value => {
			this.alpha_threshold = value

			const config = this.lineConfigs.find(l => l.id === this.currentLineId)

			if (!config) {
				return
			}

			this.computeStats(config.computed_data, config)
			this.updateStats(config)
			this.chart.updateThreshold(value)
		})

		this.listenForChanges('#seasonal-checkbox', (value, e) => {
			this.updateCurrentLine('seasonal', e.target.checked)
		})

		// Create initial line
		this.addLine()

		// Set up button handlers
		d3.select('#remove-line-button').on('click', () => {
			this.removeCurrentLine()
		})

		d3.select('#add-line-button').on('click', () => {
			this.addLine()
		})

		d3.select('#download-data-button').on('click', () => {
			this.downloadData()
		})

		// Set up live update listeners for slider labels
		this.listenForLiveChanges('#time-period-slider', value => {
			this.updateSliderLabel('#time-period-slider', value)
		})

		this.listenForLiveChanges('#k-slider', value => {
			this.updateSliderLabel('#k-slider', value)
		})

		this.listenForLiveChanges('#m-slider', value => {
			this.updateSliderLabel('#m-slider', value)
		})

		this.listenForLiveChanges('#alpha-slider', value => {
			this.updateSliderLabel('#alpha-slider', value)
		})
	}

	removeCurrentLine() {
		// Prevent removing last remaining line
		if (this.lineConfigs.length === 1) {
			return
		}

		// Remove current line and switch to first remaining line
		this.lineConfigs = this.lineConfigs.filter(l => l.id !== this.currentLineId)
		this.currentLineId = this.lineConfigs[0].id
		this.updateFormElements()
		this.updateCurrentLine('base', this.lineConfigs[0].base)
		this.updateCurrentLine('relative', this.lineConfigs[0].relative)
	}

	updateSliderLabel(selector, value) {
		const el = document.querySelector(selector)
		const thumbPosition = ((value - el.min) / (el.max - el.min)) * 100
		d3.select(el.parentElement)
			.select('.slider-value')
			.html(value)
			.style(
				'left',
				`calc(${thumbPosition}% + (${8 - thumbPosition * 0.15}px))`
			)
			.style('transform', 'translateX(-50%)')
	}

	updateCheckbox(selector, value) {
		document.querySelector(selector).checked = value
	}

	updateElementValue(selector, value) {
		document.querySelector(selector).value = value
	}

	fillSelectDropdown(id, list, cb) {
		const selectDropdown = d3.select(id)

		const grouped = d3.group(list, d => d.Header)

		const optgroups = selectDropdown
			.selectAll('optgroup')
			.data(grouped)
			.enter()
			.append('optgroup')
			.attr('label', d => d[0])

		optgroups
			.selectAll('option')
			.data(d => d[1])
			.enter()
			.append('option')
			.text(d => d.Category)
			.attr('value', d => d.Code)

		selectDropdown.on('change', e => {
			const datum = list.find(d => d.Code === e.target.value)
			cb && cb(datum)
		})
	}

	listenForChanges(id, cb) {
		d3.select(id).on('change', e => {
			cb && cb(e.target.value, e)
		})
	}

	listenForLiveChanges(id, cb) {
		d3.select(id).on('input', e => {
			cb && cb(e.target.value, e)
		})
	}

	async drawChart() {
		const start_date = d3.max(this.lineConfigs, conf => {
			return conf.computed_data.find(d => !isNaN(d.value))?.date
		})

		const end_date = d3.min(this.lineConfigs, conf => {
			return conf.computed_data
				.slice()
				.reverse()
				.find(d => !isNaN(d.value))?.date
		})

		let dates = []

		const series_data = this.lineConfigs.map(s => {
			const filtered_data = s.computed_data
				.filter(d => d.date >= start_date && d.date <= end_date)
				.sort((a, b) => d3.ascending(a.date, b.date))

			if (dates.length === 0) {
				dates = filtered_data.map(d => d.date)
			}

			return {
				key: s.id,
				label: this.datasetsList.find(d => d.Code === s.base)?.Category,
				active: s.id === this.currentLineId,
				values: filtered_data.map(d => d.value)
			}
		})

		const rec_data = []

		for (const [date, value] of this.recessionData.entries()) {
			if (date >= start_date && date <= end_date) {
				rec_data.push({
					date,
					value
				})
			}
		}

		const periods = getRecessionPeriods(rec_data).map(d => [d.start, d.end])

		const chartElement = document.getElementById('sahm_chart')
		chartElement.innerHTML = ''

		this.chart = vRecessionIndicatorChart({
			el: chartElement,
			data: { dates, series: series_data, periods },
			hideLegend: false,
			hideFooter: true,
			hideHeader: true,
			threshold: this.alpha_threshold,
			onLegendClick: key => {
				this.selectLine(key)
			}
		})
	}
	
	downloadData() {
		// Get current chart data
		const { dates, series } = this.chart.getData()

		// Create CSV header with date and series labels
		const headers = ['Date', ...series.map(s => s.label)]
		
		// Convert data to CSV rows
		const rows = dates.map((date, i) => {
			const values = [date.toISOString().split('T')[0]]
			series.forEach(s => {
				values.push(s.values[i])
			})
			return values.join(',')
		})

		// Combine into final CSV
		const csv = [headers.join(','), ...rows].join('\n')

		// Trigger file download
		const blob = new Blob([csv], { type: 'text/csv' })
		const url = window.URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.setAttribute('href', url)
		a.setAttribute('download', 'sahm_rule_data.csv')
		a.click()
		window.URL.revokeObjectURL(url)
	}
}

window.app = new SahmRuleDashboard()
