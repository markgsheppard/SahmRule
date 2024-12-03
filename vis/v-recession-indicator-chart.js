import vSwatches from "./v-swatches.js";
import vTooltip from "./v-tooltip.js";

export default function vRecessionIndicatorChart({ el, data, factor }) {
  /**
   * Constants
   */
  const startColor = "--color-primary-300";
  const endColor = "--color-primary-900";

  const focusCircleRadius = 4;
  const marginTop = 36;
  const marginRight = focusCircleRadius;
  const marginBottom = 20;
  const marginLeft = 24;
  const height = 400;

  /**
   * Setup
   */
  // Globals
  let width, iFocus, animated;

  // Data
  const { dates, series, periods } = processData(data, factor);

  // Scales
  const xScale = d3.scaleUtc().domain(d3.extent(dates));

  const minValue = d3.min(series, (d) => d3.min(d.values));
  const maxValue = d3.max(series, (d) => d3.max(d.values));
  const yScale = d3
    .scaleLinear()
    .domain([
      minValue - (maxValue - minValue) * 0.05,
      maxValue + (maxValue - minValue) * 0.05,
    ])
    .range([height - marginBottom, marginTop])
    .nice();

  const figure = d3
    .select(el)
    .classed("v recession-indicator-chart", true)
    .append("figure")
    .attr("class", "figure");
  const styles = getComputedStyle(figure.node());
  const colors = d3.quantize(
    d3.interpolateHcl(
      styles.getPropertyValue(startColor),
      styles.getPropertyValue(endColor)
    ),
    series.length
  );
  const colorScale = d3
    .scaleOrdinal()
    .domain(series.map((d) => d.key))
    .range(colors);

  // Utilities
  const line = d3
    .line()
    .x((d, i) => xScale(dates[i]))
    .y((d) => yScale(d))
    .defined((d) => d !== null)
    .curve(d3.curveMonotoneX);

  /**
   * Render
   */
  // Scaffold
  const header = figure.append("div").attr("class", "header");
  const legend = figure.append("div").attr("class", "legend");
  const body = figure.append("div").attr("class", "body");
  const svg = body
    .append("svg")
    .attr("class", "svg")
    .on("pointerenter", entered)
    .on("pointermove", moved)
    .on("pointerleave", left)
    .on("touchstart", (event) => event.preventDefault());
  const periodsG = svg.append("g").attr("class", "periods-g");
  const xAxisG = svg.append("g").attr("class", "axis-g");
  const yAxisG = svg.append("g").attr("class", "axis-g");
  const seriesG = svg.append("g").attr("class", "series-g");
  const focusG = svg
    .append("g")
    .attr("class", "focus-g")
    .attr("display", "none");
  const thresholdG = svg.append("g").attr("class", "threshold-g");
  const footer = figure.append("div").attr("class", "footer");

  const tooltip = vTooltip({ container: body });

  renderHeader();
  renderLegend();
  renderFooter();

  new ResizeObserver(resize).observe(body.node());
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animate();
          observer.disconnect();
        }
      });
    },
    {
      threshold: 0.5,
    }
  );
  observer.observe(svg.node());

  function renderHeader() {
    const titleByFactor = {
      Race: "Racial Recessions",
      "U-Measures": "The Sahm Rule by U-Measures",
      Education: "The Sahm Rule by Education",
    };
    header.html(/*html*/ `
      <div class="title">${titleByFactor[factor]}</div>
      <div class="subtitle">The Sahm Recession Indicator, Disaggregated by ${factor}</div>
      <div class="subtitle">Shown with Reference Lines and Recessions</div>
      <div class="subtitle">Data from ${dates[0].getUTCFullYear()} to Present.</div>
    `);
  }

  function renderLegend() {
    const legendLabels = {
      no_HS: "No High School",
      high_school: "High School",
      some_college: "Some College",
      bachelor: "Bachelor's Degree",
      adv_degree: "Advanced Degree",
    };

    vSwatches({
      container: legend,
      scale: colorScale,
      format: (key) => legendLabels[key] || key,
    });
  }

  function resize() {
    const newWidth = body.node().clientWidth;
    if (!newWidth || width === newWidth) return;
    width = newWidth;

    xScale.range([marginLeft, width - marginRight]);

    svg.attr("width", width).attr("viewBox", [0, 0, width, height]);

    renderChart();
  }

  function renderChart() {
    renderPeriods();
    rendXAxis();
    renderYAxis();
    renderSeries();
    renderThreshold();
    if (!animated) beforeAnimate();
  }

  function renderPeriods() {
    periodsG
      .selectChildren(".period-rect")
      .data(periods, (d) => d.join("|"))
      .join((enter) =>
        enter
          .append("rect")
          .attr("class", "period-rect")
          .attr("y", marginTop)
          .attr("height", height - marginTop - marginBottom)
      )
      .attr("x", (d) => xScale(d[0]))
      .attr("width", (d) => xScale(d[1]) - xScale(d[0]));
  }

  function rendXAxis() {
    xAxisG
      .attr("transform", `translate(0,${height - marginBottom})`)
      .call(
        d3
          .axisBottom(xScale)
          .ticks((width - marginLeft - marginRight) / 100)
          .tickSize(0)
          .tickPadding(8)
      )
      .attr("font-size", null)
      .attr("font-family", null)
      .call((g) => g.select(".domain").remove())
      .call((g) =>
        g
          .selectAll(".tick text")
          .attr("display", (d) =>
            xScale(d) < 16 || xScale(d) > width - 16 ? "none" : null
          )
      );
  }

  function renderYAxis() {
    const yTitle = "Recession Indicator";
    yAxisG
      .call(
        d3
          .axisRight(yScale)
          .ticks((height - marginTop - marginBottom) / 50)
          .tickSize(width - marginRight)
          .tickPadding(0)
      )
      .attr("font-size", null)
      .attr("font-family", null)
      .call((g) => g.select(".domain").remove())
      .call((g) => g.selectAll(".tick text").attr("x", 0).attr("dy", -4));

    yAxisG
      .selectChildren(".title-text")
      .data([yTitle])
      .join((enter) =>
        enter
          .append("text")
          .attr("class", "title-text")
          .attr("y", 2)
          .attr("dy", "0.71em")
          .text((d) => d)
      );
  }

  function renderSeries() {
    seriesG
      .attr("fill", "none")
      .selectChildren(".series-path")
      .data(series, (d) => d.key)
      .join((enter) =>
        enter
          .append("path")
          .attr("class", "series-path")
          .attr("stroke", (d) => colorScale(d.key))
      )
      .attr("d", (d) => line(d.values));
  }

  function processData(data, factor) {
    const keysByFactor = {
      Race: ["white", "asian", "hispanic", "black"],
      "U-Measures": ["U1", "U2", "U3", "U4", "U5", "U6"],
      Education: ["no_HS", "high_school", "some_college", "bachelor", "adv_degree"],
    };

    const filtered = data
      .filter((d) => !isNaN(+d.value))
      .sort((a, b) => d3.ascending(a.date, b.date));

    const dateStrings = [...new Set(filtered.map((d) => d.date))];
    const dates = dateStrings.map((dateString) => new Date(dateString));

    const valueMap = d3.rollup(
      filtered,
      (g) => +g[0].value,
      (d) => d.date,
      (d) => d.category
    );

    const series = keysByFactor[factor].map((key, i) => ({
      index: i,
      key,
      values: dateStrings.map(
        (dateString) => valueMap.get(dateString)?.get(key) ?? null
      ),
    }));

    let periods = [];
    let currentPeriod = [];
    d3.rollups(
      filtered,
      (g) => +g[0].recession === 1,
      (d) => d.date
    ).forEach(([dateString, flag]) => {
      if (flag) {
        currentPeriod.push(new Date(dateString));
      } else if (currentPeriod.length > 0) {
        periods.push(currentPeriod);
        currentPeriod = [];
      }
    });
    periods = periods.map((period) => [period[0], period[period.length - 1]]);

    return { dates, series, periods };
  }
}
