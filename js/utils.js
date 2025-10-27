
export const monthFormat = d3.timeFormat("%b %Y")
export const dateFormat = d3.timeFormat("%B %e, %Y")
export const fullTimeFormat = d3.timeFormat("%B %e, %Y %_I:%M %p %Z")


export function findDateRangeIndices(dates, startDate, endDate) {
  // Find the first index >= startDate (lower bound)
  function lowerBound(target) {
    let left = 0;
    let right = dates.length;
    
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (dates[mid] < target) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    return left;
  }
  
  // Find the last index <= endDate (upper bound)
  function upperBound(target) {
    let left = 0;
    let right = dates.length;
    
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (dates[mid] <= target) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    return left - 1;
  }
  
  const startIdx = lowerBound(startDate);
  const endIdx = upperBound(endDate);
  
  // Handle edge cases
  if (startIdx >= dates.length || endIdx < 0 || startIdx > endIdx) {
    return [-1, -1];
  }
  
  return [startIdx, endIdx];
}