import os
import pandas as pd
import json

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(BASE_DIR, 'data', 'AllBirdsv4.csv')
OUTPUT_PATH = os.path.join(BASE_DIR, 'public', 'map_data.json')

def main():
    print("Loading CSV...")
    df = pd.read_csv(CSV_PATH)
    
    # We are no longer filtering only for the Pipit!
    # Parse Date to extract Year and Month. Coerce errors to NaT for invalid dates like "1996-11-00"
    df['Date_Parsed'] = pd.to_datetime(df['Date'], format='mixed', errors='coerce')
    
    # Drop rows with invalid dates
    df = df.dropna(subset=['Date_Parsed'])
    
    # Create a string formatted as YYYY-MM for easy filtering
    df['YearMonth'] = df['Date_Parsed'].dt.strftime('%Y-%m')
    df['Year'] = df['Date_Parsed'].dt.year
    df['Month'] = df['Date_Parsed'].dt.month
    
    # Clean up Vocalization_type
    df['Vocalization_type'] = df['Vocalization_type'].astype(str).str.lower()
    
    def determine_type(val):
        if 'song' in val and 'call' in val:
            return 'both'
        elif 'song' in val:
            return 'song'
        elif 'call' in val:
            return 'call'
        return 'unknown'

    df['Type'] = df['Vocalization_type'].apply(determine_type)
    
    # Select only the needed columns, now including English_name
    export_df = df[['File ID', 'English_name', 'X', 'Y', 'YearMonth', 'Year', 'Month', 'Type']]
    
    # Sort by date for logical progression
    export_df = export_df.sort_values(by=['Year', 'Month'])
    
    # Convert to a list of dictionaries
    data = export_df.to_dict(orient='records')
    
    print(f"Exporting {len(data)} records to JSON...")
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, 'w') as f:
        json.dump(data, f)
        
    print("Done preprocessing map data!")

if __name__ == "__main__":
    main()
