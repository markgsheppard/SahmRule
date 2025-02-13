# Load necessary libraries
library(fredr)

working_dir <- "~/Documents/sahm_rule"
setwd(working_dir)

# Set your FRED API key
fredr_set_key("6352ad3b393d3ab83709630e61d2b14e")

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

