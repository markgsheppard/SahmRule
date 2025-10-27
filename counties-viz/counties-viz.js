import * as Plot from 'https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6/+esm'
import renderScrubber from './render-scrubber.js'
import { getFooterHtml } from '../vis/v-recession-indicator-chart.js';
import { fullTimeFormat, monthFormat } from '../js/utils.js';

const customAutoType = (d) => {
	const county_id = d.county_id;
	const autoTyped = d3.autoType(d)
	return {
		...autoTyped,
		county_id
	}
}

async function loadFilesInBatches(totalChunks, batchSize = 10) {
  const results = [];

	const chunks = Array.from({ length: totalChunks }).map((_, i) => i + 1);
	
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(d => 
      d3.csv(`./data-source/map-data/chunk-${d}.csv`, customAutoType).catch(() => [])
    ));
    results.push(...batchResults);
  }
  return results;
}

class CountiesViz {
	constructor() {
		this.map = null
		this.metric = 'sahm_value'
		this.currentDate = null
		this.slider = null
		this.aggregatedData = null
		this.groupedData = null
		this.dates = null

		this.metricsConfig = {
			unemployment_rate: {
				domain: [2, 4, 6, 8, 10],
				range: d3.schemeBlues[9].slice(3, 9),
				tickFormat: d => d + '%',
				label: 'Unemployment',
				timeSeries: true,
				startDateIndex: 0
			},
			sahm_value: {
				domain: [0.25, 0.5, 1, 2, 4],
				range: d3.schemeBlues[9].slice(3, 9),
				tickFormat: d => d,
				label: 'Outlook',
				timeSeries: true,
				startDateIndex: 13
			},
			accuracy: {
				domain: [1, 5, 10, 15, 20],
				range: d3.schemeBlues[6],
				label: 'Accuracy',
				tickFormat: d => Math.round(d) + '%'
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

			const [info, aggregatedData, usTopo] = await Promise.all([
				d3.csv('./data-source/map-data/info.csv',  d3.autoType),
				d3.csv('./data-source/map-data/map-data-aggregated.csv', customAutoType),
				d3.json('./counties-viz/counties-albers-10m.json')
			]);

			this.aggregatedData = aggregatedData
			this.info = info[0];
			
			d3.select("#counties-viz-footer").html(getFooterHtml(this.info.last_updated))
			d3.select("#data_last_fetched_header").html(fullTimeFormat(this.info.last_updated))

			const timeSeriesData = await loadFilesInBatches(this.info.total_chunks)

			// Group time series data by date
			this.groupedData = d3.group(timeSeriesData.flat(), d => d.date);

			// Create dates array for slider
			this.dates = [...this.groupedData.keys()].sort((a, b) => a - b).slice(1)
			
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
		sliderContainer.style.display = 'flex'
	}

	hideSlider() {
		const sliderContainer = document.querySelector('#countries-viz-slider')
		sliderContainer.style.display = 'none'
	}

	initializeSlider() {
		const sliderContainer = document.querySelector('#countries-viz-slider .slider-content')
		sliderContainer.innerHTML = ''

		const config = this.metricsConfig[this.metric]
		const adjustedDates = this.dates.slice(config.startDateIndex ?? 0);

		this.currentDate = adjustedDates[adjustedDates.length - 1];

		renderScrubber({
			el: sliderContainer,
			values: adjustedDates,
			format: d => monthFormat(d).split(" ").join("<br/>"),
			initial: adjustedDates.length - 1,
			delay: 1000,
			autoplay: false,
			onChange: (index) => {
				const date = adjustedDates[index];
				this.currentDate = date;
				this.updateVisualization();
			}
		});
	}

	getCurrentData() {
		const isTimeSeries = this.metricsConfig[this.metric]?.timeSeries
		
		if (isTimeSeries) {
			// Get data for current date from time series
			const dateData = this.groupedData.get(this.currentDate);
			return dateData
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
				return [d.county_id, d]
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
							const county = countiesData.get(d.id)
							if (!county) {
								console.log('missing', d.properties.name, "Id", d.id);
							}
							return county ? county[this.metric] : 0 // Lower value
						},
						stroke: d => {
							return '#fff'
						},
						strokeWidth: 0.35,
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
}

export default CountiesViz