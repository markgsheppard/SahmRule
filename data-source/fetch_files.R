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
    file_name <- paste0("./tool-data/", series_id, ".csv")
    
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
  select(date = monthly_date, value, deseasonalized_value) %>%
  mutate(value = as.numeric(value)) %>%
  mutate(deseasonalized_value = as.numeric(deseasonalized_value))

# Save data to CSV
write.csv(fred_data, "./tool-data/JHDUSRGDPBR.csv", row.names = FALSE)

# Fetch USARECDM data from FRED and process in one step
fred_data <- fredr(
  series_id = "USARECDM",
  observation_start = as.Date("1947-01-01"),
  frequency = "m"
) %>%
  mutate(
    time_series = ts(value, frequency = 12),
    deseasonalized_value = as.numeric(time_series - decompose(time_series)$seasonal)
  ) %>%
  select(date, value, deseasonalized_value)

# Save data to CSV
write.csv(fred_data, "./tool-data/USARECDM.csv", row.names = FALSE)

# Fetch, scale, deseasonalize, and save T10Y2Y data
fred_data <- fredr(
  series_id = "T10Y2Y",
  observation_start = as.Date("1976-06-01"),
  frequency = "m",
  aggregation_method = "avg"
) %>%
  select(date, value) %>%
  mutate(
    value = (value - min(value, na.rm = TRUE)) /
      (max(value, na.rm = TRUE) - min(value, na.rm = TRUE)),
    value=value*10,
    time_series = ts(value, frequency = 12),
    deseasonalized_value = as.numeric(time_series - decompose(time_series)$seasonal)) %>%
  select(date, value, deseasonalized_value)

# Save to CSV
write.csv(fred_data, "./tool-data/T10Y2Y.csv", row.names = FALSE)

# Fetch, scale, deseasonalize, divide by 100, and save USEPUINDXD data
fred_data <- fredr(
  series_id = "USEPUINDXD",
  observation_start = as.Date("1985-01-01"),
  frequency = "m",
  aggregation_method = "avg"
) %>%
  select(date, value) %>%
  mutate(
    value = (value - min(value, na.rm = TRUE)) /
      (max(value, na.rm = TRUE) - min(value, na.rm = TRUE)),
    value=value*10,
    time_series = ts(value, frequency = 12),
    deseasonalized_value = as.numeric(time_series - decompose(time_series)$seasonal),
    deseasonalized_value = deseasonalized_value / 100
  ) %>%
  select(date, value, deseasonalized_value)

# Save to CSV
write.csv(fred_data, "./tool-data/USEPUINDXD.csv", row.names = FALSE)

# Fetch, scale, deseasonalize, and save UMCSENT data
fred_data <- fredr(
  series_id = "UMCSENT",
  observation_start = as.Date("1978-01-01"),
  frequency = "m",
  aggregation_method = "avg"
) %>%
  select(date, value) %>%
  mutate(
    value = 1 - (value - min(value, na.rm = TRUE)) /
      (max(value, na.rm = TRUE) - min(value, na.rm = TRUE)),
    value=value*10,
    time_series = ts(value, frequency = 12),
    deseasonalized_value = as.numeric(time_series - decompose(time_series)$seasonal)) %>%
  select(date, value, deseasonalized_value)

# Save to CSV
write.csv(fred_data, "./tool-data/UMCSENT.csv", row.names = FALSE)

# Retrieve data for CLI (USALOLITONOSTSAM)
cli_data <- fredr(series_id = "USALOLITONOSTSAM") %>%
  select(date, value) %>%
  rename(CLI = value)

# Retrieve data for Recession Indicator (USARECDM)
recession_data <- fredr(series_id = "USARECDM") %>%
  select(date, value) %>%
  rename(Recession = value)

# Merge datasets on the date column
merged_data <- inner_join(cli_data, recession_data, by = "date")

# Convert Recession indicator to factor
merged_data$Recession <- as.factor(merged_data$Recession)

# ---- Logistic Regression (Binary) ----
# Logistic regression model: Predict Recession using CLI
logit_model <- glm(Recession ~ CLI, data = merged_data, family = binomial)

# Predict probabilities of recession
merged_data$Recession_Prob <- predict(logit_model, type = "response")

# ---- Extend Projection to Present Day ----
latest_date <- max(merged_data$date)  # Get latest available date
future_dates <- seq(latest_date, Sys.Date(), by = "month")  # Create future dates
future_cli <- tail(merged_data$CLI, length(future_dates))  # Use last known CLI values

# Create future data frame
future_data <- data.frame(date = future_dates, CLI = future_cli)

# Predict future recession probabilities
future_data$Recession_Prob <- predict(logit_model, newdata = future_data, type = "response")

# Set actual vs. projected flag
merged_data$Projected <- "Actual"
future_data$Projected <- "Projected"

# Fill missing recession values with predicted probabilities
merged_data <- merged_data %>%
  mutate(Recession_Filled = ifelse(is.na(Recession), Recession_Prob, as.numeric(as.character(Recession))))

# Extend recession column for projections
future_data$Recession_Filled <- future_data$Recession_Prob

# Combine actual + projected data
full_data <- bind_rows(merged_data, future_data)

# ---- Create New Dataframe with Filled and Deseasonalized Values ----
new_data <- full_data %>%
  select(date, Recession, Recession_Filled) %>%
  mutate(
    value = ifelse(is.na(Recession), ifelse(Recession_Filled >= 0.5, 1, 0), as.numeric(as.character(Recession))),  # Fill NA with binary threshold, keep existing values
    deseasonalized_value = Recession_Filled  # Keep original Recession_Filled values
  ) %>%
  select(date, value, deseasonalized_value)

# ---- Replace Values of Deseasonalized Value with Value ----
new_data$deseasonalized_value <- new_data$value

# Save data to CSV
write.csv(new_data, "./tool-data/USARECDM.csv", row.names = FALSE)


cat("\014"); cat(sprintf("Successfully retrieved data for %s for Modified Sahm Rule", format(Sys.Date(), "%B %Y")))

# Store info.csv
last_updated <- format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3Z")

# Create a data frame with the last_updated column
info_df <- data.frame(last_updated = last_updated)

# Write to CSV
write.csv(info_df, "./tool-data/info.csv", row.names = FALSE)