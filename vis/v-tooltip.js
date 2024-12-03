export default function vTooltip({ container }) {
  let boundingBox, tipBox;

  const xOffset = 16;

  const tooltip = container.append("div").attr("class", "tip");

  function show(content) {
    tooltip.html(content).classed("is-visible", true);

    boundingBox = container.node().getBoundingClientRect();
    tipBox = tooltip.node().getBoundingClientRect();
  }

  function move(x0, y0) {
    let x = x0 + xOffset;
    if (x + tipBox.width > boundingBox.width) {
      x = x0 - xOffset - tipBox.width;
      if (x < 0) {
        x = 0;
      }
    }

    let y = y0;
    if (y + tipBox.height > boundingBox.height) {
      y = boundingBox.height - tipBox.height;
    }

    tooltip.style("transform", `translate(${x}px,${y}px)`);
  }

  function hide() {
    tooltip.classed("is-visible", false);
  }

  return {
    show,
    move,
    hide,
  };
}
