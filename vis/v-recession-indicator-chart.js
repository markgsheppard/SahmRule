import vSwatches from './v-swatches.js'
import vTooltip from './v-tooltip.js'

export default function vRecessionIndicatorChart({
	el,
	data,
	factor,
	threshold = 0.5,
	hideHeader,
	hideFooter,
	hideLegend,
	onLegendClick,
}) {
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
	let width, iFocus, animated, dates, series, periods

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
		const processedData = processData(data, factor);
		dates = processedData.dates;
		series = processedData.series;
		periods = processedData.periods;
	} else {
		// Validate pre-processed data has required properties
		if (!data.dates || !data.series || !data.periods) {
			throw new Error('Pre-processed data missing required properties');
		}
		dates = data.dates;
		series = data.series;
		periods = data.periods;
	}

	// Scales
	const xScale = d3.scaleUtc().domain(d3.extent(dates))

	const minValue = d3.min(series, d => d3.min(d.values))
	const maxValue = d3.max(series, d => d3.max(d.values))
	const yScale = d3
		.scaleLinear()
		.domain([
			minValue - (maxValue - minValue) * 0.05,
			maxValue + (maxValue - minValue) * 0.05
		])
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
		.defined(d => d !== null)
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
		.on('touchstart', event => event.preventDefault())

	const periodsG = svg.append('g').attr('class', 'periods-g')
	const xAxisG = svg.append('g').attr('class', 'axis-g')
	const yAxisG = svg.append('g').attr('class', 'axis-g')
	const seriesG = svg.append('g').attr('class', 'series-g')
	const focusG = svg
		.append('g')
		.attr('class', 'focus-g')
		.attr('display', 'none')

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
	// const observer = new IntersectionObserver(
	//   (entries) => {
	//     entries.forEach((entry) => {
	//       if (entry.isIntersecting) {
	//         animate();
	//         observer.disconnect();
	//       }
	//     });
	//   },
	//   {
	//     threshold: 0.5,
	//   }
	// );
	// observer.observe(svg.node());

	function renderHeader() {
		const titleByFactor = {
			Race: 'Racial Recessions',
			'U-Measures': 'The Sahm Rule by U-Measures',
			Education: 'The Sahm Rule by Education'
		}
		header.html(/*html*/ `
      <div class="title">${titleByFactor[factor]}</div>
      <div class="subtitle">The Sahm Recession Indicator, Disaggregated by ${factor}</div>
      <div class="subtitle">Shown with Reference Lines and Recessions</div>
      <div class="subtitle">Data from ${dates[0].getUTCFullYear()} to Present.</div>
    `)
	}

	function renderLegend() {
		vSwatches({
			container: legend,
			scale: colorScale,
			active: d => series.find(s => s.key === d).active,
			label: d => {
        const obj = series.find(s => s.key === d);
        return obj?.label || obj?.key;
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

		renderChart()
	}

	function renderChart() {
		renderPeriods()
		rendXAxis()
		renderYAxis()
		renderSeries()
		renderThreshold()
		if (animated) beforeAnimate()
	}

	function renderPeriods() {
		periodsG
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
			.attr('display', d => (d.values[iFocus] === null ? 'none' : null))
			.attr('cy', d =>
				d.values[iFocus] === null ? height : yScale(d.values[iFocus])
			)
	}

	function entered(event) {
		focusG.attr('display', null)
		moved(event)
	}

	function moved(event) {
		const [mx, my] = d3.pointer(event)
		const date = xScale.invert(mx)
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

	function beforeAnimate() {
		const clipId = el.id + 'Clip'

		periodsG.attr('clip-path', `url(#${clipId})`)
		seriesG.attr('clip-path', `url(#${clipId})`)
		svg
			.attr('pointer-events', 'none')
			.append('defs')
			.append('clipPath')
			.attr('id', clipId)
			.append('rect')
			.attr('width', 0)
			.attr('height', height)
	}

	function animate() {
		const defs = svg.select('defs')
		defs
			.select('clipPath rect')
			.transition()
			.duration(0)
			.delay(0)
			.ease(d3.easeLinear)
			.attr('width', width)
			.on('end', () => {
				defs.remove()
				periodsG.attr('clip-path', null)
				seriesG.attr('clip-path', null)
				svg.attr('pointer-events', null)
			})
	}

	function renderFooter() {
		footer.html(/*html*/ `
        <div>Source: Claudia Sahm, Bureau of Labor Statistics (BLS)</div>
        <div>Note: Indicator based on real-time unemployment rate data, adjusted annually for seasonal factors.</div>
        <div>The Sahm Recession Indicator signals a recession when the unemployment rate's three-month moving average rises by 0.50 percentage points or more relative to the previous 12 months' minimum average.</div>
        <div>Author: Mark G. Sheppard</div>
      `)
	}

	function processData(data, factor) {
		const keysByFactor = {
			Race: ['white', 'asian', 'hispanic', 'black'],
			'U-Measures': ['U1', 'U2', 'U3', 'U4', 'U5', 'U6'],
			Education: [
				'no_HS',
				'some_college',
				'bachelors',
				'masters',
				'adv_degree'
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
		return /*html*/ `
    <div>
      <div class="tip__title">${d3.utcFormat('%b %-d, %Y')(dates[iFocus])}</div>
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
