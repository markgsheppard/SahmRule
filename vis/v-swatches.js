export default function vSwatches({ container, scale }) {
  container
    .append("div")
    .attr("class", "swatches")
    .selectChildren()
    .data(scale.domain())
    .join((enter) =>
      enter
        .append("div")
        .attr("class", "swatch")
        .call((div) =>
          div
            .append("div")
            .attr("class", "swatch__swatch")
            .style("background-color", (d) => scale(d))
        )
        .call((div) =>
          div
            .append("div")
            .attr("class", "swatch__label")
            .text((d) => d)
        )
    );
}
