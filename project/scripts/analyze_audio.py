import os
import pandas as pd
import librosa
from fastdtw import fastdtw
from scipy.spatial.distance import euclidean
import json
import glob
import warnings
import numpy as np
import time
import sys
import re

# Suppress librosa warnings
warnings.filterwarnings('ignore')

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
CSV_PATH = os.path.join(DATA_DIR, 'AllBirdsv4.csv')
ALL_BIRDS_DIR = os.path.join(DATA_DIR, 'ALL BIRDS')
KASIOS_DIR = os.path.join(DATA_DIR, 'Test Birds from Kasios')
OUTPUT_PATH = os.path.join(BASE_DIR, 'public', 'comparisons.json')

def get_enhanced_features(file_path):
    try:
        # Load audio (resampled for detail)
        y, sr = librosa.load(file_path, sr=22050) 
        
        # 1. Trim silence - focus on the bird, not the air
        y_trimmed, _ = librosa.effects.trim(y, top_db=20)
        if len(y_trimmed) < 1024: # Too short
            y_trimmed = y
            
        # 2. Extract 20 MFCCs
        mfcc = librosa.feature.mfcc(y=y_trimmed, sr=sr, n_mfcc=20)
        
        # 3. Add Delta (Velocity) features
        mfcc_delta = librosa.feature.delta(mfcc)
        
        # Combine into a 40-dimensional feature vector sequence
        features = np.vstack([mfcc, mfcc_delta])
        
        return features.T
    except Exception:
        return None

def main():
    # Handle CLI arguments like --3
    target_index = None
    for arg in sys.argv:
        match = re.match(r'--(\d+)', arg)
        if match:
            target_index = int(match.group(1))
            break

    start_total = time.time()
    print("--- EXHAUSTIVE AUDIO ANALYSIS (FULL BRAIN POWER) ---")
    
    print("Loading CSV metadata...")
    df = pd.read_csv(CSV_PATH)
    
    print("Mapping filenames to IDs...")
    all_bird_files = glob.glob(os.path.join(ALL_BIRDS_DIR, '**', '*.mp3'), recursive=True)
    id_to_path = {}
    for path in all_bird_files:
        filename = os.path.basename(path)
        # ID is always the last part before .mp3
        parts = filename.replace('.mp3', '').split('-')
        if parts:
            file_id = parts[-1]
            id_to_path[file_id] = path

    # Phase 1: Pre-calculate features for ALL 2000+ files
    print(f"Building Global Fingerprint Cache for {len(id_to_path)} verified files...")
    global_cache = [] 
    
    # Check if we should use all or if we have a subset (not for accuracy, but to ensure we find files)
    # The user wants ALL, so we use the entire dataframe
    
    processed_count = 0
    for idx, row in df.iterrows():
        fid = str(row['File ID'])
        if fid in id_to_path:
            feat = get_enhanced_features(id_to_path[fid])
            if feat is not None:
                global_cache.append({
                    "fid": fid,
                    "species": row['English_name'],
                    "features": feat
                })
            processed_count += 1
            if processed_count % 200 == 0:
                print(f"  Cached {processed_count} verified recordings...")

    print(f"Cache complete. {len(global_cache)} valid fingerprints stored.")

    # Phase 2: Identify Kasios files
    kasios_files = glob.glob(os.path.join(KASIOS_DIR, '**', '*.mp3'), recursive=True)
    # Sort naturally (1, 2, ... 10, 11)
    kasios_files.sort(key=lambda x: int(re.search(r'(\d+)', os.path.basename(x)).group(1)))
    
    # Filter if target_index is set
    files_to_process = []
    if target_index is not None:
        for k_path in kasios_files:
            fname = os.path.basename(k_path)
            num_match = re.search(r'(\d+)', fname)
            if num_match and int(num_match.group(1)) == target_index:
                files_to_process.append(k_path)
        if not files_to_process:
            print(f"Error: Could not find Kasios file with index {target_index}")
            return
    else:
        files_to_process = kasios_files

    # Load existing results if they exist
    results = {}
    if os.path.exists(OUTPUT_PATH):
        try:
            with open(OUTPUT_PATH, 'r') as f:
                results = json.load(f)
        except:
            results = {}

    # Phase 3: Exhaustive Comparison
    for i, kasios_path in enumerate(files_to_process):
        k_start = time.time()
        kasios_filename = os.path.basename(kasios_path)
        print(f"\nAnalyzing {kasios_filename} ({i+1}/{len(files_to_process)})...")
        
        kasios_feat = get_enhanced_features(kasios_path)
        if kasios_feat is None:
            continue
            
        # Global search: Find best distance for EVERY species across ALL their files
        species_best = {s: {"dist": float('inf'), "fid": None} for s in df['English_name'].unique()}
        
        for entry in global_cache:
            # Full power DTW (radius=1 for reasonable performance in massive search)
            distance, _ = fastdtw(kasios_feat, entry['features'], radius=1, dist=euclidean)
            
            if distance < species_best[entry['species']]["dist"]:
                species_best[entry['species']]["dist"] = distance
                species_best[entry['species']]["fid"] = entry['fid']

        # Confidence Scoring
        species_scores = []
        for s_name, best in species_best.items():
            if best['fid'] is not None:
                species_scores.append({
                    "species": s_name,
                    "distance": best['dist'],
                    "fid": best['fid']
                })

        dists = np.array([s['distance'] for s in species_scores])
        max_d = np.max(dists)
        normalized_d = dists / max_d
        exp_d = np.exp(-12 * normalized_d) # Very high temperature for definitive matching
        confidences = (exp_d / exp_d.sum()) * 100
        
        for idx, res in enumerate(species_scores):
            res['confidence'] = confidences[idx]

        species_results = sorted(species_scores, key=lambda x: x['confidence'], reverse=True)
        pipit_match = next((s for s in species_results if s['species'] == 'Rose-crested Blue Pipit'), None)
        
        # Update results dictionary
        results[kasios_filename] = {
            "predictions": species_results[:5],
            "bestPipitMatch": pipit_match['fid'] if pipit_match else None,
            "bestPipitScore": pipit_match['distance'] if pipit_match else None,
            "overallBestMatch": species_results[0]['fid'],
            "overallBestSpecies": species_results[0]['species']
        }
        
        print(f"  Verdict: {species_results[0]['species']} ({species_results[0]['confidence']:.1f}% confidence)")
        print(f"  Step Time: {time.time() - k_start:.1f}s")
        
    print(f"\nUpdating results at {OUTPUT_PATH}...")
    with open(OUTPUT_PATH, 'w') as f:
        json.dump(results, f, indent=4)
        
    print(f"--- FINISHED --- Total Time: {(time.time() - start_total)/60:.1f} minutes")

if __name__ == "__main__":
    main()
