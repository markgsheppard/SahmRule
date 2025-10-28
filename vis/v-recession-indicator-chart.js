import vSwatches from './v-swatches.js'
import vTooltip from './v-tooltip.js'
import { dateFormat, findDateRangeIndices } from '../js/utils.js'

export default function vRecessionIndicatorChart({
	el,
	data,
	factor,
	threshold = 0.5,
	hideHeader,
	hideFooter,
	hideLegend,
	onLegendClick,
	chartTitle
}) {
	const defined = d => d !== null && d !== undefined && !isNaN(d)
	/**
	 * Constants
	 */
	const startColor = '--color-primary-300'
	const endColor = '--color-primary-900'

	const focusCircleRadius = 4
	const marginTop = 36
	const marginRight = focusCircleRadius
	const marginBottom = 20
	const marginLeft = 24
	const height = 400

	/**
	 * Setup
	 */
	// Globals
	let width, iFocus, dates, series, periods

	let dateRange = null

	/**
	 * @typedef {Object} ProcessedData
	 * @property {Date[]} dates - Array of dates
	 * @property {Object[]} series - Array of series data
	 * @property {Object[]} periods - Array of period ranges
	 */

	// Check if data needs processing or is pre-processed
	const transformData = Array.isArray(data)

	if (transformData) {
		// Process raw array data into required format
		const processedData = processData(data, factor)
		dates = processedData.dates
		series = processedData.series
		periods = processedData.periods
	} else {
		// Validate pre-processed data has required properties
		if (!data.dates || !data.series || !data.periods) {
			throw new Error('Pre-processed data missing required properties')
		}
		dates = data.dates
		series = data.series
		periods = data.periods
	}

	// Scales
	const xDomain = d3.extent(dates)
	const xScale = d3.scaleUtc().domain(xDomain)

	const minValue = d3.min(series, d => d3.min(d.values))
	const maxValue = d3.max(series, d => d3.max(d.values))
	const yDomain = [
		Math.floor(minValue),
		Math.ceil(maxValue),
	]
	const yScale = d3
		.scaleLinear()
		.domain(yDomain)
		.range([height - marginBottom, marginTop])
		.nice()

	const figure = d3
		.select(el)
		.classed('v recession-indicator-chart', true)
		.append('figure')
		.attr('class', 'figure')

	const styles = getComputedStyle(figure.node())

	const colors = d3.quantize(
		d3.interpolateHcl(
			styles.getPropertyValue(startColor),
			styles.getPropertyValue(endColor)
		),
		series.length > 1 ? series.length : 2
	)

	const colorScale = d3
		.scaleOrdinal()
		.domain(series.map(d => d.key))
		.range(colors)

	// Utilities
	const line = d3
		.line()
		.x((d, i) => xScale(dates[i]))
		.y(d => yScale(d))
		.defined(d => defined(d))
		.curve(d3.curveMonotoneX)

	/**
	 * Render
	 */
	// Scaffold
	const header = figure.append('div').attr('class', 'header')
	const legend = figure.append('div').attr('class', 'legend')
	const body = figure.append('div').attr('class', 'body')

	const svg = body
		.append('svg')
		.attr('class', 'svg')
		.on('pointerenter', entered)
		.on('pointermove', moved)
		.on('pointerleave', left)
	// .on('touchstart', event => event.preventDefault())

	const clipId = 'series-clip-rect'

	const defsRect = svg
		.append('defs')
		.append('clipPath')
		.attr('id', clipId)
		.append('rect')
		.attr('x', marginLeft)
		.attr('y', marginTop)

	const periodsG = svg.append('g').attr('class', 'periods-g')
	const xAxisG = svg.append('g').attr('class', 'axis-g')
	const yAxisG = svg.append('g').attr('class', 'axis-g')
	const seriesG = svg.append('g').attr('class', 'series-g')

	const focusG = svg
		.append('g')
		.attr('class', 'focus-g')
		.attr('display', 'none')

	const brushG = svg.append('g').attr('class', 'brush-g')
	const thresholdG = svg.append('g').attr('class', 'threshold-g')
	const footer = figure.append('div').attr('class', 'footer')

	const tooltip = vTooltip({ container: body })

	if (!hideHeader) {
		renderHeader()
	}
	if (!hideLegend) {
		renderLegend()
	}
	if (!hideFooter) {
		renderFooter()
	}

	new ResizeObserver(resize).observe(body.node())

	function renderHeader() {
		header.html(/*html*/ `
      <h3 class="title">${chartTitle}</h3>
      <div class="subtitle">The Sahm Recession Indicator — Shown with Reference Lines and Recessions.</div>
      <div class="subtitle">Data from ${dates[0].getUTCFullYear()} to Present.</div>
    `)
	}

	function renderLegend() {
		vSwatches({
			container: legend,
			scale: colorScale,
			active: d => series.find(s => s.key === d).active,
			label: d => {
				const obj = series.find(s => s.key === d)
				return obj?.label || obj?.key
			},
			onClick: (e, d) => {
				if (!onLegendClick) return
				series = series.map(s => ({ ...s, active: s.key === d }))
				renderLegend()
				onLegendClick(d)
			}
		})
	}

	function resize() {
		const newWidth = body.node().clientWidth
		if (!newWidth || width === newWidth) return
		width = newWidth

		xScale.range([marginLeft, width - marginRight])

		svg.attr('width', width).attr('viewBox', [0, 0, width, height])

		defsRect
			.attr('width', width - marginLeft - marginRight)
			.attr('height', height - marginTop - marginBottom)

		renderChart()
	}

	function renderChart() {
		renderPeriods()
		rendXAxis()
		renderYAxis()
		renderSeries()
		renderThreshold()
		renderBrush()
	}

	function renderBrush() {
		const brushResetButton = body
			.append('button')
			.attr('class', 'btn btn-sm btn-default brush-reset-button')
			.html('<i class="fa fa-rotate-left"></i>')
			.attr('title', 'Reset zoom')
			.style('position', 'absolute')
			.style('top', '0')
			.style('right', '0')
			.style('z-index', '1000')
			.style('display', 'none')
			.on('click', () => {
				brushG.call(brush.clear)
				brushResetButton.style('display', 'none')
				xScale.domain(xDomain)
				yScale.domain(yDomain)
				dateRange = null
				renderPeriods()
				rendXAxis()
				renderYAxis()
				renderThreshold()
				renderSeries()
			})

		const interval = d3.timeMonth

		const brush = d3
			.brushX()
			.extent([
				[marginLeft, marginTop],
				[width - marginRight, height - marginBottom]
			])
			.on('start', brushstart)
			.on('end', brushended)

		function brushended(event) {
			const selection = event.selection

			if (!event.sourceEvent || !selection) return
			const [x0, x1] = selection.map(d => interval.round(xScale.invert(d)))

			// Binary search for start and end indices
			const [ind1, ind2] = findDateRangeIndices(dates, x0, x1)

			// Find minimum y value
			const y0 = d3.min(
				series, d => d3.min(d.values.slice(ind1, ind2 + 1))
			)

			// Find maximum y value
			const y1 = d3.max(
				series, d => d3.max(d.values.slice(ind1, ind2 + 1))
			)

			// Update y Scale domain
			yScale.domain([
				Math.floor(y0),
				Math.ceil(y1),
			])
			
			dateRange = null
			xScale.domain([x0, x1])

			renderPeriods()
			rendXAxis()
			renderYAxis()
			renderSeries()
			renderThreshold()

			brushG.call(brush.clear)
			brushResetButton.style('display', null)
		}

		function brushstart(event) {
			const selection = event.selection
			if (!event.sourceEvent || !selection) return
			const [x0, x1] = event.selection.map(d =>
				interval.round(xScale.invert(d))
			)
			dateRange = [x0, x1]
		}

		brushG.call(brush).call(brush.move, [dates[0], dates[dates.length - 1]])
	}

	function renderPeriods() {
		periodsG
			.attr('clip-path', `url(#${clipId})`)
			.selectChildren('.period-rect')
			.data(periods, d => d.join('|'))
			.join(enter =>
				enter
					.append('rect')
					.attr('class', 'period-rect')
					.attr('y', marginTop)
					.attr('height', height - marginTop - marginBottom)
			)
			.attr('x', d => xScale(d[0]))
			.attr('width', d => xScale(d[1]) - xScale(d[0]))
	}

	function rendXAxis() {
		xAxisG
			.attr('transform', `translate(0,${height - marginBottom})`)
			.call(
				d3
					.axisBottom(xScale)
					.ticks((width - marginLeft - marginRight) / 100)
					.tickSize(0)
					.tickPadding(8)
			)
			.attr('font-size', null)
			.attr('font-family', null)
			.call(g => g.select('.domain').remove())
			.call(g =>
				g
					.selectAll('.tick text')
					.attr('display', d =>
						xScale(d) < 16 || xScale(d) > width - 16 ? 'none' : null
					)
			)
	}

	function renderYAxis() {
		const yTitle = 'Recession Indicator'
		yAxisG
			.call(
				d3
					.axisRight(yScale)
					.ticks((height - marginTop - marginBottom) / 50)
					.tickSize(width - marginRight)
					.tickPadding(0)
			)
			.attr('font-size', null)
			.attr('font-family', null)
			.call(g => g.select('.domain').remove())
			.call(g => g.selectAll('.tick text').attr('x', 0).attr('dy', -4))

		yAxisG
			.selectChildren('.title-text')
			.data([yTitle])
			.join(enter =>
				enter
					.append('text')
					.attr('class', 'title-text')
					.attr('y', 2)
					.attr('dy', '0.71em')
					.text(d => d)
			)
	}

	function renderSeries() {
		seriesG
			.attr('clip-path', `url(#${clipId})`)
			.attr('fill', 'none')
			.selectChildren('.series-path')
			.classed('active', d => d.active)
			.data(series, d => d.key)
			.join(enter =>
				enter
					.append('path')
					.attr('class', 'series-path')
					.attr('stroke', d => colorScale(d.key))
			)
			.attr('d', d => line(d.values))
	}

	function renderThreshold() {
		const thresholdValue = threshold

		thresholdG.attr('transform', `translate(0,${yScale(thresholdValue)})`)

		thresholdG
			.selectChildren('.threshold-line')
			.data([null])
			.join(enter =>
				enter
					.append('line')
					.attr('class', 'threshold-line')
					.attr('x1', marginLeft)
			)
			.attr('x2', width - marginRight)

		thresholdG
			.selectChildren('.threshold-text')
			.data(['↑ Recession', '↓ Non-Recession'])
			.join(enter =>
				enter
					.append('text')
					.attr('class', 'threshold-text')
					.attr('x', marginLeft)
					.attr('dy', (d, i) => (i ? '0.71em' : null))
					.attr('y', (d, i) => (i ? 4 : -4))
					.text(d => d)
			)
	}

	function renderFocus() {
		focusG.attr('transform', `translate(${xScale(dates[iFocus])},0)`)

		focusG
			.selectChildren('.focus-line')
			.data([null])
			.join(enter =>
				enter
					.append('line')
					.attr('class', 'focus-line')
					.attr('y1', marginTop)
					.attr('y2', height - marginBottom)
			)

		focusG
			.selectChildren('.focus-circle')
			.data(series, d => d.key)
			.join(enter =>
				enter
					.append('circle')
					.attr('class', 'focus-circle')
					.attr('r', focusCircleRadius)
					.attr('fill', d => colorScale(d.key))
			)
			.style('display', d => (defined(d.values[iFocus]) ? null : 'none'))
			.attr('cy', d =>
				defined(d.values[iFocus]) ? yScale(d.values[iFocus]) : height
			)
	}

	function entered(event) {
		focusG.attr('display', null)
		moved(event)
	}

	function moved(event) {
		const [mx, my] = d3.pointer(event)
		const date = xScale.copy().clamp(true).invert(mx)
		const i = d3.bisectCenter(dates, date)
		if (iFocus !== i) {
			iFocus = i
			renderFocus()
			tooltip.show(tooltipContent())
		}
		tooltip.move(xScale(dates[i]), my)
	}

	function left() {
		iFocus = null
		focusG.attr('display', 'none')
		tooltip.hide()
	}

	function renderFooter() {
		footer.html(getFooterHtml(data.lastUpdated));
	}

	function processData(data, factor) {
		const keysByFactor = {
			Race: ['white', 'asian', 'hispanic', 'black'],
			'U-Measures': ['U1', 'U2', 'U3', 'U4', 'U5', 'U6'],
			Education: [
				'No Highschool',
				'Some College',
				'Bachelors',
				'Masters',
				'Advanced Degree'
			],
			'Modified Sahm Rule': ['Modified Sahm Rule']
		}

		const filtered = data
			.filter(d => !isNaN(+d.value))
			.sort((a, b) => d3.ascending(a.date, b.date))

		const dateStrings = [...new Set(filtered.map(d => d.date))]
		const dates = dateStrings.map(dateString => new Date(dateString))

		const valueMap = d3.rollup(
			filtered,
			g => +g[0].value,
			d => d.date,
			d => d.category
		)

		const series = keysByFactor[factor].map((key, i) => ({
			index: i,
			key,
			values: dateStrings.map(
				dateString => valueMap.get(dateString)?.get(key) ?? null
			)
		}))

		let periods = []
		let currentPeriod = []
		d3.rollups(
			filtered,
			g => +g[0].recession === 1,
			d => d.date
		).forEach(([dateString, flag]) => {
			if (flag) {
				currentPeriod.push(new Date(dateString))
			} else if (currentPeriod.length > 0) {
				periods.push(currentPeriod)
				currentPeriod = []
			}
		})
		periods = periods.map(period => [period[0], period[period.length - 1]])

		return { dates, series, periods }
	}

	// utcFormat converts date to UTC for
	function tooltipContent() {
		const format = d3.utcFormat('%b %-d, %Y')

		let dateRangeText = format(dates[iFocus])

		if (dateRange) {
			if (dates[iFocus] > dateRange[0]) {
				dateRangeText = format(dateRange[0]) + ' - ' + format(dates[iFocus])
			} else {
				dateRangeText = format(dates[iFocus]) + ' - ' + format(dateRange[1])
			}
		}

		return /*html*/ `
    <div>
      <div class="tip__title">
				${dateRangeText}
			</div>
      <table class="tip__body">
        <tbody>
          ${series
						.filter(d => d.values[iFocus] !== null)
						.sort(
							(a, b) =>
								d3.descending(a.values[iFocus], b.values[iFocus]) ||
								d3.ascending(a.index, b.index)
						)
						.map(
							d => /*html*/ `
            <tr>
              <td>
                <div class="swatch">
                  <div class="swatch__swatch" style="background-color: ${colorScale(
										d.key
									)}"></div>
                  <div class="swatch__label">${d.label || d.key}</div>
                </div>
              </td>
              <td>
                ${d3.format('.2f')(d.values[iFocus])}
              </td>
            </tr>
            <tr>
              <td>
                Risk: <strong>${
									d.values[iFocus] > threshold ? 'High' : 'Low'
								}</strong>
              </td>
              <td>
                
              </td>
            </tr>
          `
						)
						.join('')}
        </tbody>
      </table>
    </div>
    `
	}

	return {
		updateThreshold: newThreshold => {
			threshold = newThreshold
			renderThreshold()
		},
		getData: () => {
			return {
				dates,
				series,
				periods
			}
		}
	}
}

export function getFooterHtml(lastUpdated) {
  return `
    <footer class="footer-container text-muted">
      <div class="footer-text">
        <div class="footer-item footer-source">
          <strong>Source:</strong> Claudia Sahm, Bureau of Labor Statistics (BLS).
        </div>
        <div class="footer-item footer-note">
          <strong>Note:</strong> Indicator based on real-time unemployment rate data, adjusted annually for seasonal factors.
        </div>
				<br />
        <div class="footer-item footer-description">
          The Sahm Recession Indicator signals a recession when the unemployment rate's three-month moving average rises by 0.50 percentage points or more relative to the previous 12 months' minimum average.
        </div>
        <br />
        <div class="footer-item footer-author">
          <strong>Author:</strong> Mark G. Sheppard
        </div>
        <div class="footer-item footer-visualizer">
          <strong>Visualized by:</strong> <a href="https://ghviniashvili.com/" target="_blank" class="footer-link">Giorgi Gviniashvili</a> and Mark G. Sheppard.
        </div>
        ${lastUpdated ? `<div class="footer-item footer-updated"><strong>Last updated:</strong> ${dateFormat(lastUpdated)}</div>` : ''}
      </div>
    </footer>
  `;
}
