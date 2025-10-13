import * as Plot from 'https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6/+esm'
import renderScrubber from './render-scrubber.js'

const timeFormat = d3.timeFormat("%b %Y")

class CountiesViz {
	constructor() {
		this.map = null
		this.metric = 'sahm_value'
		this.currentDate = null
		this.slider = null
		// this.timeSeriesData = null
		this.aggregatedData = null
		this.groupedData = null
		this.dates = null

		this.metricsConfig = {
			unemployment_rate: {
				domain: [2, 4, 6, 8, 10],
				range: d3.schemeBlues[9].slice(3, 9),
				tickFormat: d => d + '%',
				label: 'Unemployment',
				timeSeries: true
			},
			sahm_value: {
				domain: [0.25, 0.5, 0.75, 1, 1.25, 1.5],
				range: d3.schemeBlues[9].slice(2, 9),
				tickFormat: d => d,
				label: 'Outlook',
				timeSeries: true
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
		try {
			const [counties, aggregatedData, usTopo] = await Promise.all([
				d3.csv('./data-source/counties.csv', d3.autoType),
				d3.csv('./data-source/computed/map-data-aggregated.csv', d3.autoType),
				d3.json('./counties-viz/counties-albers-10m.json')
			]);

			const allCounties = await Promise.all(counties.map(d => {
				return d3.csv(`./data-source/computed/${d.SeriesId}.csv`, d3.autoType).catch(() => [])
			}))

			const timeSeriesData = allCounties.flat();

			// this.timeSeriesData = timeSeriesData
			this.aggregatedData = aggregatedData

			// Group time series data by date
			this.groupedData = d3.rollup(timeSeriesData, counties => new Map(
				counties.map(d => {
					return [this.normalizeCountyName(d.county), d]
				})
			), d => d.date);
			
			// Create dates array for slider
			this.dates = [...this.groupedData.keys()].sort();

			// Set initial date to first available date
			this.currentDate = this.dates[0];

			// Process geographic data
			this.processGeographicData(usTopo)

			this.initControls()
			this.handleMetricChange()
		} catch (error) {
			console.error('Error loading data:', error)
		}
	}

	processGeographicData(usTopo) {
		this.countiesFeatures = topojson.feature(usTopo, usTopo.objects.counties)
		this.statesFeatures = topojson.feature(usTopo, usTopo.objects.states)
		this.statemap = new Map(this.statesFeatures.features.map(d => [d.id, d]))
	}

	initControls() {
		const radioButtons = document.querySelectorAll('input[name="metric"]')
		radioButtons.forEach(radio => {
			radio.addEventListener('change', e => {
				if (e.target.checked) {
					this.metric = e.target.value
					this.handleMetricChange()
				}
			})
		})
	}

	handleMetricChange() {
		const isTimeSeries = this.metricsConfig[this.metric]?.timeSeries
		
		if (isTimeSeries) {
			this.showSlider()
			this.initializeSlider()
		} else {
			this.hideSlider()
		}
		
		this.updateVisualization()
	}

	showSlider() {
		const sliderContainer = document.querySelector('#countries-viz-slider')
		sliderContainer.style.display = 'block'
	}

	hideSlider() {
		const sliderContainer = document.querySelector('#countries-viz-slider')
		sliderContainer.style.display = 'none'
	}

	initializeSlider() {
		const sliderContainer = document.querySelector('#countries-viz-slider')
		sliderContainer.innerHTML = ''

		renderScrubber({
			el: sliderContainer,
			values: this.dates,
			format: timeFormat,
			initial: 0,
			delay: 1000,
			autoplay: false,
			onChange: (index) => {
				const date = this.dates[index];
				this.currentDate = date;
				this.updateVisualization();
			}
		});
	}

	getCurrentData() {
		const isTimeSeries = this.metricsConfig[this.metric]?.timeSeries
		
		if (isTimeSeries) {
			// Get data for current date from time series
			const dateData = this.groupedData.get(this.currentDate) || new Map()
			return Array.from(dateData.values())
		} else {
			// Use aggregated data for non-time series metrics
			return this.aggregatedData
		}
	}

	updateVisualization() {
		const currentData = this.getCurrentData()
		
		if (!currentData || currentData.length === 0) {
			console.warn('No data available for current selection')
			return
		}

		// Create counties data map
		const countiesData = new Map(
			currentData.map(d => {
				return [this.normalizeCountyName(d.county), d]
			})
		)

		this.drawMap(countiesData)
	}

	drawMap(countiesData) {
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
					this.countiesFeatures,
					Plot.centroid({
						fill: d => {
							const county = countiesData.get(d.properties.name)
							if (!county) {
								console.log('missing', d.properties.name)
							}
							return county ? county[this.metric] : null
						},
						tip: true,
						channels: {
							County: d => d.properties.name,
							State: d =>
								this.statemap.get(d.id.slice(0, 2)).properties.name
						}
					})
				),
				Plot.geo(this.statesFeatures, { stroke: 'white' })
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