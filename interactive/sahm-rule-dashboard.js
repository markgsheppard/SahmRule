import { dateFormat } from '../js/utils.js'
import {
	compute_sahm_rule,
	getRecessionPeriods,
	computeStats
} from '../sahm/sahm_rule.js'
import vRecessionIndicatorChart from '../vis/v-recession-indicator-chart.js'

const getRandomId = () => {
	return (
		Math.random().toString(36).substring(2, 15) +
		Math.random().toString(36).substring(2, 15)
	)
}

const defaultSettings = {
	base: 'UNRATE', 			// Base series used for Sahm Rule signal (default: U3 unemployment rate)
	relative: 'UNRATE', 	// Comparison series to compute relative increase (can be same as base or broader like U6)
	recession: 'USREC', 	// Recession dataset. !!! Shared across all lines !!!
	k: 3, 								// Smoothing window (months) for the base unemployment series (e.g., U3)
	m: 3, 								// Smoothing window (months) for the relative comparison series (e.g., U6)
	time_period: 12, 			// Rolling minimum window size (months) for the relative comparison
	seasonal: false, 			// Toggle for seasonal adjustment (1 = adjust, 0 = leave raw)
	alpha_threshold: 0.5, // Threshold increase (in percentage points) that triggers a recession signal. !!! Shared across all lines !!!
	natural_rate: 0, 			// Natural rate of unemployment to enforce as lower bound
	preceding: true 			// Use lagged (preceding) window for rolling minimum calculation (1 = yes, 0 = no)
}

class SahmRuleDashboard {
	constructor(params) {
		this.params = Object.assign(
			{
				lineConfigs: [], // Pre-configured lines
				chartElementId: 'sahm_chart', // Chart element ID
				components: new Set(['legend']), // Components to display
				dataBaseUrl: '../data-source'
			},
			params || {}
		)

		// Track list of available datasets and their configurations
		this.datasetsList = []
		// Store configurations for each line series being displayed
		this.lineConfigs = this.params.lineConfigs
		// Track which line series is currently selected
		this.currentLineId = null
		// Cache fetched data to improve performance
		this.dataCache = new Map()
		// Store recession indicator data
		this.recessionData = new Map()

		this.init()
	}

	getUrl(series_id) {
		return `${this.params.dataBaseUrl}/tool-data/${series_id}.csv`
	}

	async addLine() {
		// Creates a new data series with default settings
		const config = {
			id: getRandomId(),
			...defaultSettings
		}

		// Fetch and compute new line
		await this.fetchAndCompute(config)

		// add computed line to list of lines
		this.lineConfigs.push(config)

		// draw chart
		this.drawChart()

		// Select newly added line
		this.selectLine(config.id)
	}

	async fetchAndCompute(config) {
		// Fetch all required data in parallel
		const [base_data, relative_data] = await Promise.all([
			this.fetchFile(config.base),
			this.fetchFile(config.relative),
			this.loadRecessionData(config.recession)
		])

		config.base_data = base_data
		config.relative_data = relative_data

		this.computeSahmRule(config)
	}

	computeSahmRule(config) {
		// Ensure base and relative data series align on same date range
		this.alignData(config)

		// Recompute Sahm rule with updated parameters
		const computed_data = compute_sahm_rule(
			config.base_data,
			config.relative_data,
			config.k,
			config.m,
			config.time_period,
			config.seasonal,
			config.natural_rate,
			config.preceding
		)

		config.computed_data = computed_data
		this.computeStats(config.computed_data, config)
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

		this.computeSahmRule(config)

		this.updateStats(config)
		this.drawChart()
	}

	alignData(config) {
		// Ensure base and relative data series align on same date range
		const { base_data, relative_data, start_date: config_start_date } = config

		// Find overlapping date range
		const start_date = Math.max(
			base_data[0].date,
			relative_data[0].date,
			config_start_date ? new Date(config_start_date) : base_data[0].date
		)

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
		this.updateSliderLabel('#natural-rate-slider', config.natural_rate)

		// Update slider values
		this.updateElementValue('#k-slider', config.k)
		this.updateElementValue('#m-slider', config.m)
		this.updateElementValue('#time-period-slider', config.time_period)
		this.updateElementValue('#alpha-slider', config.alpha_threshold)
		this.updateElementValue('#natural-rate-slider', config.natural_rate)

		// Update other form controls
		this.updateCheckbox('#seasonal-checkbox', config.seasonal)
		this.updateCheckbox('#preceding-checkbox', config.preceding)
		this.updateElementValue('#base-select', config.base)
		this.updateElementValue('#relative-select', config.relative)
		this.updateElementValue('#recession-select', config.recession)
	}

	async getDatasetsList() {
		try {
			const resp = await d3.csv(`${this.params.dataBaseUrl}/datasets.csv`)
			return resp
		} catch (error) {
			console.error(error)
			return []
		}
	}

	async getLastUpdatedAt() {
		try {
			const resp = await d3.csv(`${this.params.dataBaseUrl}/tool-data/info.csv`, d3.autoType)
			return resp[0]?.last_updated;
		} catch (error) {
			console.error(error)
			return null
		}
	}

	async loadRecessionData(recessionCode) {
		const resp = await this.fetchFile(recessionCode)
		this.recessionData = new Map(resp.map(d => [d.date, d.value]))
	}

	computeStats(computed_data, config) {
		const { accuracy, recession_lead_time, committee_lead_time } = computeStats(
			computed_data,
			this.recessionData,
			this.alpha_threshold
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
			const resp = await d3.csv(this.getUrl(fileId), d3.autoType)
			this.dataCache.set(fileId, resp)
			return resp
		} catch (error) {
			console.error(error)
			return []
		}
	}

	async init() {
		this.lastUpdated = await this.getLastUpdatedAt()

		if (this.lastUpdated) {
			d3.select("#last_updated").html(dateFormat(this.lastUpdated))
		}

		// Load available datasets
		this.datasetsList = await this.getDatasetsList()

		// If no lines are passed in, create one
		if (this.lineConfigs.length === 0) {
			// Create initial line with default settings
			this.addLine()
		} else {
			// Fetch and compute pre-configured lines
			for (const config of this.lineConfigs) {
				await this.fetchAndCompute(config)
			}
			this.drawChart()
		}

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
			this.alpha_threshold = parseFloat(value)

			const config = this.lineConfigs.find(l => l.id === this.currentLineId)

			if (!config) {
				return
			}

			this.computeStats(config.computed_data, config)
			this.updateStats(config)
			this.chart.updateThreshold(value)
		})

		this.listenForChanges('#natural-rate-slider', value => {
			this.updateCurrentLine('natural_rate', parseFloat(value))
		})

		this.listenForChanges('#seasonal-checkbox', (value, e) => {
			this.updateCurrentLine('seasonal', e.target.checked)
		})

		this.listenForChanges('#preceding-checkbox', (value, e) => {
			this.updateCurrentLine('preceding', e.target.checked)
		})

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

		this.listenForLiveChanges('#natural-rate-slider', value => {
			this.updateSliderLabel('#natural-rate-slider', value)
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
		let maxDateRange = 0
		let maxLengthLineIndex = -1

		this.lineConfigs.forEach((conf, index) => {
			if (conf.computed_data.length > maxDateRange) {
				maxDateRange = conf.computed_data.length
				maxLengthLineIndex = index
			}
		})

		const dates = this.lineConfigs[maxLengthLineIndex].computed_data.map(
			d => d.date
		)

		const series_data = this.lineConfigs.map(s => {
			const dataMap = new Map(
				s.computed_data.map(d => [d.date.getTime(), d.value])
			)

			return {
				key: s.id,
				label: this.datasetsList.find(d => d.Code === s.base)?.Category,
				active: s.id === this.currentLineId,
				values: dates.map(date => dataMap.get(date.getTime()) ?? null)
			}
		})

		const rec_data = []

		const start_date = dates[0]
		const end_date = dates[dates.length - 1]

		for (const [date, value] of this.recessionData.entries()) {
			if (date >= start_date && date <= end_date) {
				rec_data.push({
					date,
					value
				})
			}
		}

		const periods = getRecessionPeriods(rec_data).map(d => [d.start, d.end])

		const chartElement = document.getElementById(this.params.chartElementId)
		chartElement.innerHTML = ''

		this.chart = vRecessionIndicatorChart({
			el: chartElement,
			data: { dates, series: series_data, periods, lastUpdated: this.lastUpdated },
			hideLegend: !this.params.components.has('legend'),
			hideFooter: !this.params.components.has('footer'),
			hideHeader: !this.params.components.has('header'),
			chartTitle: this.params.chartTitle,
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

export default SahmRuleDashboard
