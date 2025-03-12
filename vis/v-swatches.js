export default function vSwatches({
	container,
	scale,
	label,
	onClick,
	active
}) {
	const swatches = container
		.selectAll('div.swatches')
		.data(['swatches'])
		.join('div')
		.attr('class', 'swatches')

	swatches
		.selectAll('div.swatch')
		.data(scale.domain())
		.join('div')
		.attr('class', 'swatch')
		.attr('data-active', d => active(d))
		.on('click', (e, d) => onClick(e, d))
		.call(div =>
			div
				.selectAll('div.swatch__swatch')
				.data(d => [d])
				.join('div')
				.attr('class', 'swatch__swatch')
				.style('background-color', d => scale(d))
		)
		.call(div =>
			div
				.selectAll('div.swatch__label')
				.data(d => [d])
				.join('div')
				.attr('class', 'swatch__label')
				.text(d => label(d))
		)
}
