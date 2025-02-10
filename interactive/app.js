import { calculateAccuracyPercent, calculateDaysToNearestDateWithSummary, compute_sahm_rule, getRecessionPeriods, getSahmStarts } from './sahm_rule.js'
import vRecessionIndicatorChart from '../vis/v-recession-indicator-chart.js'

const data_base_url =
	'https://raw.githubusercontent.com/giorgi-ghviniashvili/sahm_rule/refs/heads/main'

class SahmRuleChart {
	constructor(formData) {
		this.formData = formData
		this.accuracy_time_range = 200
		this.committee_time_range = 250
		this.committee_starts = [
			new Date("2020-06-08"),
			new Date("2008-12-01"),
			new Date("2001-11-26"),
			new Date("1991-04-25"),
			new Date("1982-01-06"),
			new Date("1980-06-03")
		]
	}

	async loadDataAndDrawChart(formData) {
		this.formData = formData
		this.data = await this.getData()
		this.computeAndDrawChart()
	}

	getUrl(series_id) {
		return `${data_base_url}/data/${series_id}.csv`
	}

	async getData() {
		try {
			const resp = await Promise.all([
				d3.csv(this.getUrl(this.formData.base.Code), d3.autoType),
				d3.csv(this.getUrl(this.formData.relative.Code), d3.autoType),
				d3.csv(this.getUrl(this.formData.recession.Code), d3.autoType)
			])

			const [base_data, relative_data, rec_data] = resp

			const dateStart = Math.max(
				base_data[0].date,
				relative_data[0].date,
				rec_data[0].date
			)

			const dateEnd = Math.min(
				base_data[base_data.length - 1].date,
				relative_data[relative_data.length - 1].date,
				rec_data[rec_data.length - 1].date
			)

			return {
				base_data: base_data.filter(
					d => d.date >= dateStart && d.date <= dateEnd
				),
				relative_data: relative_data.filter(
					d => d.date >= dateStart && d.date <= dateEnd
				),
				rec_data: rec_data.filter(d => d.date >= dateStart && d.date <= dateEnd)
			}
		} catch (error) {
			console.error(error)
		}
	}

	computeAndDrawChart() {
		const computed_data = compute_sahm_rule(
			this.data.base_data,
			this.data.relative_data,
			this.data.rec_data,
			this.formData.k,
			this.formData.m,
			this.formData.width,
			this.formData.seasonal,
			this.formData.alpha
		)

		this.updateStats(computed_data)

		const chartElement = document.getElementById('sahm_chart')
		chartElement.innerHTML = ''
		vRecessionIndicatorChart({
			el: chartElement,
			data: computed_data,
			factor: 'U-Measures'
		})
	}

	updateStats(computed_data) {
		const sahm_starts = getSahmStarts(computed_data)
		const recession_starts = getRecessionPeriods(
			this.data.rec_data.filter(d => {
				const threeMonths = new Date(sahm_starts[0])
				threeMonths.setMonth(threeMonths.getMonth() - 3)
				return d.date >= threeMonths
			})
		).map(d => d.start)

		const accuracy =
			Math.round(
				calculateAccuracyPercent(
					sahm_starts,
					recession_starts,
					this.accuracy_time_range
				)
			) + '%'

		const recession_lead_time = Math.round(
			calculateDaysToNearestDateWithSummary(
				sahm_starts,
				recession_starts,
				this.accuracy_time_range
			).overall_average_days
		)

		const committee_lead_time = Math.round(
			calculateDaysToNearestDateWithSummary(
				sahm_starts,
				this.committee_starts,
				this.committee_time_range
			).average_days_leading
		)

		d3.select("#committee_lead_time").html(committee_lead_time)
		d3.select("#recession_lead_time").html(recession_lead_time)
		d3.select('#accuracy').html(accuracy)
	}
}

const defaultSettings = {
	base: 'U6RATE',
	relative: 'U6RATE',
	recession: 'USREC'
}

class SahmRuleDashboard {
	constructor() {
		this.datasetsList = []
		this.formData = {}
		this.chart = new SahmRuleChart(this.formData)
		this.init()
	}

	async getDatasetsList() {
		try {
			const resp = await fetch(`${data_base_url}/datasets.csv`)
			const csvText = await resp.text()
			return d3.csvParse(csvText)
		} catch (error) {
			console.error(error)
		}
	}

	async init() {
		this.datasetsList = await this.getDatasetsList()

		this.formData = {
			base: this.datasetsList.find(t => t.Code === defaultSettings.base),
			relative: this.datasetsList.find(
				t => t.Code === defaultSettings.relative
			),
			recession: this.datasetsList.find(
				t => t.Code === defaultSettings.recession
			),
			k: 3,
			m: 3,
			width: 13,
			seasonal: false,
			alpha: 0.5
		}

		this.loadDataAndDrawChart()

		const nonRecessionList = this.datasetsList.filter(
			d => d.Header !== 'Recessions'
		)

		const recessionList = this.datasetsList.filter(
			d => d.Header === 'Recessions'
		)

		this.fillSelectDropdown('base-select', nonRecessionList, datum => {
			this.formData.base = datum
			this.loadDataAndDrawChart()
		})

		this.fillSelectDropdown('relative-select', nonRecessionList, datum => {
			this.formData.relative = datum
			this.loadDataAndDrawChart()
		})

		this.fillSelectDropdown('recession-select', recessionList, datum => {
			this.formData.recession = datum
			this.loadDataAndDrawChart()
		})

		this.listenForChanges('k-slider', value => {
			this.formData.k = value
			this.updateChart()
		})

		this.listenForChanges('m-slider', value => {
			this.formData.m = value
			this.updateChart()
		})

		this.listenForChanges('time-period-slider', value => {
			this.formData.timePeriod = value
			this.updateChart()
		})

		this.listenForChanges('alpha-slider', value => {
			this.formData.alpha = value
			this.updateChart()
		})

		this.listenForChanges('seasonal-checkbox', value => {
			this.formData.seasonal = value
			this.updateChart()
		})
	}

	fillSelectDropdown(id, list, cb) {
		const selectDropdown = d3.select(`#${id}`)
		const field = id.split('-')[0]

		const grouped = d3.group(list, d => d.Header);

		const optgroups = selectDropdown
			.selectAll('optgroup')
			.data(grouped)
			.enter()
			.append('optgroup')
			.attr('label', d => d[0])

		optgroups.selectAll('option')
			.data(d => d[1])
			.enter()
			.append('option')
			.text(d => d.Category)
			.attr('selected', d => {
				if (d.Code === this.formData[field].Code) {
					return true
				}
				return null
			})
			.attr('value', d => d.Code)

		selectDropdown.on('change', e => {
			const datum = list.find(d => d.Code === e.target.value)
			cb && cb(datum)
		})
	}

	listenForChanges(id, cb) {
		d3.select(`#${id}`).on('change', e => {
			cb && cb(e.target.value)
		})
	}

	loadDataAndDrawChart() {
		this.chart.loadDataAndDrawChart(this.formData)
	}

	updateChart() {
		this.chart.formData = this.formData
		this.chart.computeAndDrawChart()
	}
}

const app = new SahmRuleDashboard()
