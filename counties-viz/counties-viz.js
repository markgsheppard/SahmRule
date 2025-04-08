import * as Plot from 'https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6/+esm'

class CountiesViz {
	constructor() {
		this.map = null
		this.metric = 'last_sahm_value'

		this.metricsConfig = {
			last_sahm_value: {
				domain: [0.25, 0.5, 0.75, 1, 1.25, 1.5],
				range: d3.schemeBlues[9].slice(2, 9),
				tickFormat: d => d,
				label: 'Outlook'
			},
			accuracy: {
				domain: [0, 5, 10, 15, 20],
				range: d3.schemeBlues[6],
				label: 'Accuracy',
				tickFormat: d => Math.round(d)
			},
			committee_lead_time: {
				domain: [50, 75, 100, 125],
				range: d3.schemeBlues[6].slice(1, 6),
				tickFormat: d => Math.round(d),
				label: 'Advance'
			}
		}

		this.loadData()
	}

	async loadData() {
		const [counties, usTopo] = await Promise.all([
			d3.csv('./data-source/computed/map-data.csv', d3.autoType),
			d3.json('./counties-viz/counties-albers-10m.json')
		])

		const countiesFeatures = topojson.feature(usTopo, usTopo.objects.counties)
		const statesFeatures = topojson.feature(usTopo, usTopo.objects.states)
		const statemap = new Map(statesFeatures.features.map(d => [d.id, d]))
		const countiesData = new Map(
			counties.map(d => {
				return [this.normalizeCountyName(d.county), d]
			})
		)
		const accuracyExtent = d3.extent(counties, d => d.accuracy)
		const last_sahm_value_extent = d3.extent(counties, d => d.last_sahm_value)
		const committee_lead_time_extent = d3.extent(
			counties,
			d => d.committee_lead_time
		)

		this.dataset = {
			countiesFeatures,
			statesFeatures,
			countiesData,
			statemap,
			metricDomains: {
				accuracy: accuracyExtent,
				last_sahm_value: [0, last_sahm_value_extent[1]],
				committee_lead_time: committee_lead_time_extent
			}
		}

		this.initControls()
		this.drawMap()
	}

	initControls() {
		const radioButtons = document.querySelectorAll('input[name="metric"]')
		radioButtons.forEach(radio => {
			radio.addEventListener('change', e => {
				if (e.target.checked) {
					this.metric = e.target.value
					this.drawMap()
				}
			})
		})
	}

	drawMap() {
		const map = Plot.plot({
			width: 975,
			height: 610,
			projection: 'identity',
			color: {
				type: 'threshold',
				domain: this.metricsConfig[this.metric].domain,
				range: this.metricsConfig[this.metric].range,
				label: this.metricsConfig[this.metric].label,
				legend: true,
				tickFormat: this.metricsConfig[this.metric].tickFormat
			},
			marks: [
				Plot.geo(
					this.dataset.countiesFeatures,
					Plot.centroid({
						fill: d => {
							const county = this.dataset.countiesData.get(d.properties.name)
							if (!county) {
								console.log('missing', d.properties.name)
							}
							return county ? county[this.metric] : null
						},
						tip: true,
						channels: {
							County: d => d.properties.name,
							State: d =>
								this.dataset.statemap.get(d.id.slice(0, 2)).properties.name
						}
					})
				),
				Plot.geo(this.dataset.statesFeatures, { stroke: 'white' })
			]
		})
		const div = document.querySelector('#counties-viz')
		div.innerHTML = ''
		div.append(map)
	}

	normalizeCountyName(countyName) {
		const suffixes = [
			' County',
			' city',
			' Borough',
			' Parish',
			' Municipality',
			' Town',
			' Village',
			' Census Area',
			' City and Borough'
		]

		let normalized = countyName
		for (const suffix of suffixes) {
			normalized = normalized.replace(new RegExp(`${suffix}$`), '')
		}
		return normalized.trim()
	}
}

export default CountiesViz
