
export default function renderScrubber({
  el,
  values,
  format = (value) => value,
  initial = 0,
  onChange = () => {}
}) {
  let frame, timer, interval;

  const form = d3
    .select(el)
    .append("form")
    .attr("class", "scrubber")
    .on("submit", (event) => {
      event.preventDefault();
      if (running()) return stop();
      start();
    });

  const thumbSize = parseFloat(
    getComputedStyle(form.node()).getPropertyValue("--slider-thumb-size")
  );

  const slider = form.append("div").attr("class", "scrubber__slider");

  // slider
  //   .append("span")
  //   .attr("class", "scrubber__slider__label")
  //   .text(format(values[0]));

  const container = slider
    .append("div")
    .attr("class", "scrubber__slider__container");

  const input = container
    .append("input")
    .attr("class", "scrubber__slider__input")
    .attr("type", "range")
    .attr("min", 0)
    .attr("max", values.length - 1)
    .attr("value", initial)
    .on("input", (event) => {
      if (event && event.isTrusted && running()) stop();
      const index = input.node().valueAsNumber;
      updateOutput(index);
      onChange(index);
    });

  const output = container
    .append("output")
    .attr("class", "scrubber__slider__output");
  updateOutput(initial);

  // slider
  //   .append("span")
  //   .attr("class", "scrubber__slider__label")
  //   .text(format(values[values.length - 1]));

  function running() {
    return frame !== null || timer !== null || interval !== null;
  }


  function updateOutput() {
    const percentage = input.node().valueAsNumber / (values.length - 1);
    const adjustment = (0.5 - percentage) * thumbSize;
    output.html(format(values[input.node().valueAsNumber]));
    output.style("left", `calc(${percentage * 100}% + ${adjustment}px)`);
  }
}
