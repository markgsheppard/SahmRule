# Load necessary libraries
library(fredr)
library(tidyverse)
library(lubridate)

working_dir <- "./data-source"
setwd(working_dir)

# Set your FRED API key
fredr_set_key(Sys.getenv("FRED_API_KEY"))

# Read the CSV file
data <- read.csv("./datasets.csv")

# Loop through each row to download and save data
for (i in 1:nrow(data)) {
  tryCatch({
    # Extract relevant details
    series_id <- as.character(data$Code[i])  # Ensure it's treated as a character
    start_date <- as.Date(data$Date[i])      # Convert to Date type
    
    # Fetch data from FRED
    fred_data <- fredr(series_id = series_id, observation_start = start_date) %>% 
      mutate(
        time_series = ts(value, frequency = 12),
        deseasonalized_value = as.numeric(time_series - decompose(time_series)$seasonal)
      ) %>%
      select(date, value, deseasonalized_value)
    
    # Generate a descriptive file name
    file_name <- paste0("./data/", series_id, ".csv")
    
    # Save to CSV
    write.csv(fred_data, file_name, row.names = FALSE)
    cat("Successfully processed:", series_id, "\n")
  },
  error = function(e) {
    cat("Error processing series_id:", series_id, "-", e$message, "\n")
  },
  warning = function(w) {
    cat("Warning processing series_id:", series_id, "-", w$message, "\n")
  },
  finally = {
    # Optional cleanup code can go here
    cat("Finished processing:", series_id, "\n")
  })
}


# Fetch JHDUSRGDPBR (Quarterly Data) from FRED and process in one step
fred_data <- fredr(
  series_id = "JHDUSRGDPBR",
  observation_start = as.Date("1967-10-01"),
  frequency = "q"
) %>%
  mutate(
    date = as.Date(date),
    time_series = ts(value, frequency = 4),
    deseasonalized_value = as.numeric(time_series - decompose(time_series)$seasonal)
  ) %>%
  slice(rep(1:n(), each = 3)) %>%  # Repeat each row 3 times for monthly data
  group_by(date) %>%
  mutate(
    month = rep(1:3, times = n() / 3),
    monthly_date = date + months(month - 1),
    value = lag(value, default = first(value)),
    deseasonalized_value = lag(deseasonalized_value, default = first(deseasonalized_value))
  ) %>%
  ungroup() %>%
  bind_rows(
    if (max(.$monthly_date) < floor_date(Sys.Date(), "month")) {
      data.frame(
        monthly_date = seq(max(.$monthly_date) + months(1), floor_date(Sys.Date(), "month"), by = "month"),
        value = tail(.$value, 1),
        deseasonalized_value = tail(.$deseasonalized_value, 1)
      )
    } else {
      NULL
    }
  ) %>%
  select(monthly_date, value, deseasonalized_value)

# Save data to CSV
write.csv(fred_data, "./data/JHDUSRGDPBR.csv", row.names = FALSE)


cat("\014"); cat(sprintf("Successfully retrieved data for %s for Modified Sahm Rule", format(Sys.Date(), "%B %Y")))