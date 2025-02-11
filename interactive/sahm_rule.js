// Base_data and relative_data should match each other by index
export function compute_sahm_rule(
	base_data,
	relative_data,
	recession_data,
	k = 3,
	m = 3,
	time_period = 13,
	seasonal = false,
	alpha_threshold = 0.5
) {
	const n = base_data.length
	const base = new Float64Array(n).fill(0)
	const relative = new Float64Array(n).fill(0)
	const field = seasonal ? 'deseasonalized_value' : 'value'

	for (let i = 0; i < n; i++) {
		base[i] = base_data[i][field]
		relative[i] = relative_data[i][field]
	}

	const base_k_mo_avg = movingAverage(base, k)
	const relative_m_mo_avg = movingAverage(relative, m)
	const relative_m_mo_min_timePeriod = rollingMin(relative_m_mo_avg, time_period)

	const computed_data = []
	for (let i = 0; i < n; i++) {
		const sahm = base_k_mo_avg[i] - relative_m_mo_min_timePeriod[i]
		computed_data.push({
			date: base_data[i].date,
			recession: recession_data[i]?.value ?? 0,
			// base_k_mo_avg: base_k_mo_avg[i],
			// relative_m_mo_min_12mo: relative_m_mo_min_12mo[i],
			sahm: sahm,
			sahm_binary: sahm >= alpha_threshold ? 1 : 0,
			value: sahm,
			category: 'Modified Sahm Rule'
		})
	}

	return computed_data
}

export function getRecessionPeriods(recession_data) {
	const resp = []
	let lastRecessionStart = null
	for (let i = 0; i < recession_data.length; i++) {
		const datum = recession_data[i]
		if (lastRecessionStart && datum.value === 0) {
			resp.push({
				period: resp.length,
				start: lastRecessionStart,
				end: datum.date
			})
			lastRecessionStart = null
		} else if (!lastRecessionStart && datum.value === 1) {
			lastRecessionStart = datum.date
		}
	}
	return resp
}

export function getSahmStarts(data) {
	const resp = []
	let lastStart = null
	for (let i = 0; i < data.length; i++) {
		const datum = data[i]
		if (lastStart && datum.sahm_binary === 0) {
			lastStart = null
		} else if (!lastStart && datum.sahm_binary === 1) {
			lastStart = datum.date
			resp.push(lastStart)
		}
	}

	return resp
}

// Compare sahm_starts with recession_starts for accuracy
// - `dates` is an array of date strings (equivalent to `date` column)
// - `recessionStarts` is an array of date strings (equivalent to `recession_starts$date`)
// - `accuracyTimeRange` is the number of days for the accuracy range

export function calculateAccuracyPercent(
	sahmStarts,
	recessionStarts,
	accuracyTimeRange
) {
	const accurate = sahmStarts.map(date => {
		return recessionStarts.some(recessionDate => {
			const diffInDays = Math.abs(
				(date - recessionDate) / (1000 * 60 * 60 * 24)
			)
			return diffInDays <= accuracyTimeRange
		})
	})

	const accuracyPercent =
		(accurate.filter(Boolean).length / sahmStarts.length) * 100
	return accuracyPercent
}

export function calculateDaysToNearestDateWithSummary(
	sahmStarts,
	referenceDates,
	accuracyTimeRange
) {
	// Step 1: Calculate days to the nearest date for each sahm date
	const daysToNearest = sahmStarts.map(sahmDate => {
		// Filter reference dates within the accuracy range
		const validReferenceDates = referenceDates.filter(refDate => {
			const diffInDays = Math.abs((sahmDate - refDate) / (1000 * 60 * 60 * 24))
			return diffInDays <= accuracyTimeRange
		})

		if (validReferenceDates.length === 0) {
			// Return 0 if no valid dates exist within the range
			return 0
		}

		// Find the nearest reference date
		const nearestReferenceDate = validReferenceDates.reduce(
			(closest, current) => {
				const closestDiff = Math.abs(sahmDate - closest)
				const currentDiff = Math.abs(sahmDate - current)
				return currentDiff < closestDiff ? current : closest
			},
			validReferenceDates[0]
		)

		// Calculate the difference in days
		return (nearestReferenceDate - sahmDate) / (1000 * 60 * 60 * 24)
	})

	// Step 2: Calculate summary statistics
	const leadTimes = daysToNearest.filter(days => days > 0) // Positive days (leading)
	const lagTimes = daysToNearest.filter(days => days < 0) // Negative days (lagging)

	const summary = {
		average_days_leading:
			leadTimes.length > 0
				? leadTimes.reduce((sum, days) => sum + days, 0) / leadTimes.length
				: null,
		average_days_lagging:
			lagTimes.length > 0
				? lagTimes.reduce((sum, days) => sum + days, 0) / lagTimes.length
				: null,
		overall_average_days:
			daysToNearest.length > 0
				? daysToNearest.reduce((sum, days) => sum + days, 0) /
				  daysToNearest.length
				: null
	}

	return summary
}

// Calculate N size moving averages
function movingAverage(values, N) {
	let i = 0
	let sum = 0
	const means = new Float64Array(values.length).fill(NaN)
	for (let n = Math.min(N - 1, values.length); i < n; ++i) {
		sum += values[i]
	}
	for (let n = values.length; i < n; ++i) {
		sum += values[i]
		means[i] = sum / N
		sum -= values[i - N + 1]
	}
	return means
}

function rollingMin(values, N) {
	const mins = new Float64Array(values.length).fill(NaN)
	const deque = []

	for (let i = 0; i < values.length; i++) {
		// Remove first item if sliding window size is going to be greater than N
		// If i = 3, N = 3 and deque[0] === 0, it will become greater then N
		if (deque.length && deque[0] < i - N + 1) {
			deque.shift()
		}

		// Remove elements from the deque that are larger than the current value
		while (deque.length && values[deque[deque.length - 1]] > values[i]) {
			deque.pop()
		}

		// Push current index.
		// Note: If all the values were greater than values[i], then value[i] will be min. So deque[0] will keep always minimum
		deque.push(i)

		if (i >= N - 1) {
			mins[i] = values[deque[0]]
		}
	}

	return mins
}
