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
	base: 'UNRATE',
	relative: 'UNRATE',
	recession: 'USREC',
	k: 3,
	m: 3,
	time_period: 13,
	seasonal: false,
	alpha_threshold: 0.5
}

const data_base_url = '../data-source'

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
		this.datasetsList = []
		this.lineConfigs = []
		this.currentLineId = null
		this.dataCache = new Map()
		this.recessionData = new Map()

		this.init()
	}

	async addLine() {
		const config = {
			id: getRandomId(),
			...defaultSettings
		}

		const [base_data, relative_data] = await Promise.all([
			this.fetchFile(config.base),
			this.fetchFile(config.relative),
			this.loadRecessionData(config.recession)
		])

		config.base_data = base_data
		config.relative_data = relative_data

		this.lineConfigs.push(config)
		this.selectLine(config.id)

		this.updateCurrentLine('base', config.base)
		this.updateCurrentLine('relative', config.relative)
	}

	selectLine(id) {
		this.currentLineId = id
		this.updateFormElements()

		const config = this.lineConfigs.find(l => l.id === this.currentLineId)

		if (!config) {
			return
		}

		this.updateStats(config)
	}

	async updateCurrentLine(key, value) {
		const config = this.lineConfigs.find(l => l.id === this.currentLineId)

		if (!config) {
			return
		}

		config[key] = value

		if (key === 'base') {
			config.base_data = await this.fetchFile(value)
		} else if (key === 'relative') {
			config.relative_data = await this.fetchFile(value)
		} else if (key === 'recession') {
			await this.loadRecessionData(value)
		}

		let { base_data, relative_data } = config

		if (key === 'base' || key === 'relative') {
			const aligned = this.alignData(config)
			base_data = aligned.base_data
			relative_data = aligned.relative_data
		}

		const computed_data = compute_sahm_rule(
			base_data,
			relative_data,
			config.k,
			config.m,
			config.time_period,
			config.seasonal
		)

		config.computed_data = computed_data

		this.computeStats(computed_data, config)
		this.updateStats(config)
		this.drawChart()
	}

	alignData(config) {
		const { base_data, relative_data } = config

		const dateStart = Math.max(base_data[0].date, relative_data[0].date)

		const dateEnd = Math.min(
			base_data[base_data.length - 1].date,
			relative_data[relative_data.length - 1].date
		)

		config.start_date = dateStart
		config.end_date = dateEnd

		return {
			base_data: base_data.filter(
				d => d.date >= dateStart && d.date <= dateEnd
			),
			relative_data: relative_data.filter(
				d => d.date >= dateStart && d.date <= dateEnd
			)
		}
	}

	updateFormElements() {
		const config = this.lineConfigs.find(l => l.id === this.currentLineId)

		if (!config) {
			return
		}

		this.updateSliderValue('#k-slider', config.k)
		this.updateSliderValue('#m-slider', config.m)
		this.updateSliderValue('#time-period-slider', config.time_period)
		this.updateCheckbox('#seasonal-checkbox', config.seasonal)
		this.updateDropdownValue('#base-select', config.base)
		this.updateDropdownValue('#relative-select', config.relative)
		this.updateDropdownValue('#recession-select', config.recession)
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
		this.datasetsList = await this.getDatasetsList()

		const nonRecessionList = this.datasetsList.filter(
			d => d.Header !== 'Recessions'
		)

		const recessionList = this.datasetsList.filter(
			d => d.Header === 'Recessions'
		)

		this.fillSelectDropdown('#base-select', nonRecessionList, datum => {
			this.updateCurrentLine('base', datum.Code)
		})

		this.fillSelectDropdown('#relative-select', nonRecessionList, datum => {
			this.updateCurrentLine('relative', datum.Code)
		})

		this.fillSelectDropdown('#recession-select', recessionList, async datum => {
			this.updateCurrentLine('recession', datum.Code)
		})

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

		// Add first line
		this.addLine()

		d3.select('#remove-line-button').on('click', () => {
			this.removeCurrentLine()
		})

		d3.select('#add-line-button').on('click', () => {
			this.addLine()
		})

		// this.listenForLiveChanges('time-period-slider', value => {
		// 	// this.updateSlidervalue(
		// 	// 	document.getElementById('time-period-slider'),
		// 	// 	value
		// 	// )
		// })

		// // Just to update slider label
		// this.listenForLiveChanges('k-slider', value => {
		// 	// this.updateCurrentLine('k', value)
		// 	// this.updateSlidervalue(document.getElementById('k-slider'), value)
		// })

		// this.listenForLiveChanges('m-slider', value => {
		// 	// this.updateSlidervalue(document.getElementById('m-slider'), value)
		// })

		// this.listenForLiveChanges('alpha-slider', value => {
		// 	this.updateCurrentLine('alpha_threshold', value)
		// 	// this.updateSlidervalue(document.getElementById('alpha-slider'), value)
		// })
	}

	removeCurrentLine() {
		if (this.lineConfigs.length === 1) {
			return
		}

		this.lineConfigs = this.lineConfigs.filter(l => l.id !== this.currentLineId)
		this.currentLineId = this.lineConfigs[0].id
		this.updateFormElements()
		this.updateCurrentLine('base', this.lineConfigs[0].base)
		this.updateCurrentLine('relative', this.lineConfigs[0].relative)
	}

	updateSliderValue(selector, value) {
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

	updateDropdownValue(selector, value) {
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
		const start_date = Math.max(...this.lineConfigs.map(s => s.start_date))
		const end_date = Math.min(...this.lineConfigs.map(s => s.end_date))
		
		let dates = []

		const series_data = this.lineConfigs.map(s => {
			const filtered_data = s.computed_data
				.filter(
					d => !isNaN(+d.value) && d.date >= start_date && d.date <= end_date
				)
				.sort((a, b) => d3.ascending(a.date, b.date))

			if (dates.length === 0) {
				dates = filtered_data.map(d => d.date)
			}

			return {
				key: s.id,
				label: s.base,
				// active: s.id === this.currentLineId,
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
			threshold: this.alpha_threshold
		})
	}
}

window.app = new SahmRuleDashboard()
