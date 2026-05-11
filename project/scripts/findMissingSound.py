import os
import csv

folder_path = r'C:\Programmering\TNM098\project\data\ALL BIRDS'
csv_path = r'C:\Programmering\TNM098\project\data\AllBirdsv4.csv'

# Extract IDs from the MP3 files in the folder
existing_ids = set()
if os.path.exists(folder_path):
    for filename in os.listdir(folder_path):
        if filename.endswith('.mp3'):
            # Split by '-' and take the last part to get the ID, then remove '.mp3'
            # E.g., "Rose-crested Blue Pipit-402254.mp3" -> "402254"
            file_id = filename.split('-')[-1].replace('.mp3', '').strip()
            existing_ids.add(file_id)
else:
    print(f"Directory not found: {folder_path}")

# Extract IDs from the CSV
csv_ids = set()
if os.path.exists(csv_path):
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            csv_ids.add(row['File ID'].strip())
else:
    print(f"CSV file not found: {csv_path}")

# Find missing IDs
missing_ids = csv_ids - existing_ids

print(f"Total IDs in CSV: {len(csv_ids)}")
print(f"Total existing MP3 IDs: {len(existing_ids)}")
print(f"Number of missing MP3 files: {len(missing_ids)}")
print("-" * 30)

if missing_ids:
    print("Files IDs from CSV that do NOT exist in the ALL BIRDS folder as MP3s:")
    # Sort them numerically if possible
    sorted_missing = sorted(list(missing_ids), key=lambda x: int(x) if x.isdigit() else x)
    for missing_id in sorted_missing:
        print(missing_id)
else:
    print("All file IDs in the CSV have a corresponding MP3 file in the folder!")
