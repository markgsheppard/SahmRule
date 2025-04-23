import { accuracy_time_range, committee_time_range, committee_starts } from './constants.js'

// Base_data and relative_data should match each other by index
export function compute_sahm_rule(
	base_data,
	relative_data,
	k = 3,
	m = 3,
	time_period = 13,
	seasonal = false,
	natural_rate = 0,
	preceding = false,
) {
	const n = base_data.length
	const base = new Float64Array(n).fill(0)
	const relative = new Float64Array(n).fill(0)
	const field = seasonal ? 'deseasonalized_value' : 'value'
	const suppress_natural_rate = natural_rate > 0

	for (let i = 0; i < n; i++) {
		base[i] = suppress_natural_rate ? Math.max(natural_rate, +base_data[i][field]) : +base_data[i][field]
		relative[i] = suppress_natural_rate ? Math.max(natural_rate, +relative_data[i][field]) : +relative_data[i][field]
	}

	const base_k_mo_avg = movingAverage(base, k)
	const relative_m_mo_avg = movingAverage(relative, m)
	
	// Apply lag if preceding is true
	const data_for_min = preceding ? lag(relative_m_mo_avg) : relative_m_mo_avg
	
	const relative_m_mo_min_time_period = rollingMin(
		data_for_min,
		time_period
	)

	const computed_data = []
	for (let i = 0; i < n; i++) {
		const sahm = base_k_mo_avg[i] - relative_m_mo_min_time_period[i]
		computed_data.push({
			date: base_data[i].date,
			value: sahm
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

export function getSahmStarts(data, alpha_threshold = 0.5) {
	const resp = []
	let lastStart = null
	for (let i = 0; i < data.length; i++) {
		const datum = data[i]
		const sahm_binary = datum.value >= alpha_threshold ? 1 : 0
		if (lastStart && sahm_binary === 0) {
			lastStart = null
		} else if (!lastStart && sahm_binary === 1) {
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

// Function to lag a series by one period (similar to R's lag function)
function lag(values) {
	const lagged = new Float64Array(values.length).fill(NaN)
	for (let i = 1; i < values.length; i++) {
		lagged[i] = values[i - 1]
	}
	return lagged
}

export function computeStats(computed_data, recession_data, alpha_threshold = 0.5) {
	const sahm_starts = getSahmStarts(computed_data, alpha_threshold)

	const threeMonths = new Date(sahm_starts[0])
	threeMonths.setMonth(threeMonths.getMonth() - 3)

	const rec_data = []

	for (const [date, value] of recession_data.entries()) {
		if (date >= threeMonths) {
			rec_data.push({
				date,
				value
			})
		}
	}

	const recession_starts = getRecessionPeriods(rec_data).map(d => d.start)

	const accuracy = Math.round(
		calculateAccuracyPercent(
			sahm_starts,
			recession_starts,
			accuracy_time_range
		)
	)

	const recession_lead_time = Math.round(
		calculateDaysToNearestDateWithSummary(
			sahm_starts,
			recession_starts,
			accuracy_time_range
		).overall_average_days
	)

	const committee_lead_time = Math.round(
		calculateDaysToNearestDateWithSummary(
			sahm_starts,
			committee_starts,
			committee_time_range
		).average_days_leading
	)

	return {
		accuracy,
		recession_lead_time,
		committee_lead_time
	}
}