import os
import pandas as pd
import librosa
from fastdtw import fastdtw
from scipy.spatial.distance import euclidean
import json
import glob
import warnings

# Suppress librosa warnings about PySoundFile
warnings.filterwarnings('ignore')

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
CSV_PATH = os.path.join(DATA_DIR, 'AllBirdsv4.csv')
ALL_BIRDS_DIR = os.path.join(DATA_DIR, 'ALL BIRDS')
KASIOS_DIR = os.path.join(DATA_DIR, 'Test Birds from Kasios')
OUTPUT_PATH = os.path.join(BASE_DIR, 'public', 'comparisons.json')

def get_mfcc(file_path):
    try:
        # Load audio, resampling to 11025 Hz to speed up processing significantly
        y, sr = librosa.load(file_path, sr=11025) 
        # Extract 13 MFCCs
        mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
        return mfcc.T
    except Exception as e:
        print(f"Error processing {file_path}: {e}")
        return None

def main():
    print("Loading CSV metadata...")
    df = pd.read_csv(CSV_PATH)
    
    # Filter for Rose-crested Blue Pipit
    pipits = df[df['English_name'] == 'Rose-crested Blue Pipit'].copy()
    
    # Clean Vocalization_type
    pipits['Vocalization_type'] = pipits['Vocalization_type'].astype(str).str.lower()
    
    # Get lists of file IDs for calls and songs
    # This also handles strings like "song & call" seamlessly by checking substring
    call_ids = set(pipits[pipits['Vocalization_type'].str.contains('call')]['File ID'].astype(str))
    song_ids = set(pipits[pipits['Vocalization_type'].str.contains('song')]['File ID'].astype(str))
    
    print(f"Found {len(call_ids)} calls and {len(song_ids)} songs in metadata.")

    # Map IDs to actual file paths in ALL BIRDS
    print("Scanning ALL BIRDS directory...")
    all_bird_files = glob.glob(os.path.join(ALL_BIRDS_DIR, '**', '*.mp3'), recursive=True)
    
    id_to_path = {}
    for path in all_bird_files:
        filename = os.path.basename(path)
        name_part = filename.replace('.mp3', '')
        parts = name_part.split('-')
        if parts:
            file_id = parts[-1]
            id_to_path[file_id] = path

    # Filter paths for valid calls and songs
    call_paths = {fid: id_to_path[fid] for fid in call_ids if fid in id_to_path}
    song_paths = {fid: id_to_path[fid] for fid in song_ids if fid in id_to_path}
    
    print(f"Found {len(call_paths)} call audio files and {len(song_paths)} song audio files locally.")

    print("Extracting MFCCs for baseline verified recordings (this will take a while)...")
    call_features = {}
    for fid, path in call_paths.items():
        feat = get_mfcc(path)
        if feat is not None:
            call_features[fid] = feat
            
    song_features = {}
    for fid, path in song_paths.items():
        feat = get_mfcc(path)
        if feat is not None:
            song_features[fid] = feat
            
    print("Scanning Kasios directory...")
    kasios_files = glob.glob(os.path.join(KASIOS_DIR, '**', '*.mp3'), recursive=True)
    results = {}
    
    for i, kasios_path in enumerate(kasios_files):
        kasios_filename = os.path.basename(kasios_path)
        print(f"Analyzing {kasios_filename} ({i+1}/{len(kasios_files)})...")
        
        kasios_feat = get_mfcc(kasios_path)
        if kasios_feat is None:
            continue
            
        best_call_id, best_call_score = None, float('inf')
        worst_call_id, worst_call_score = None, -1
        
        # Compare against calls using Dynamic Time Warping (DTW)
        for fid, feat in call_features.items():
            distance, _ = fastdtw(kasios_feat, feat, dist=euclidean)
            if distance < best_call_score:
                best_call_score = distance
                best_call_id = fid
            if distance > worst_call_score:
                worst_call_score = distance
                worst_call_id = fid
                
        best_song_id, best_song_score = None, float('inf')
        worst_song_id, worst_song_score = None, -1
        
        # Compare against songs using Dynamic Time Warping (DTW)
        for fid, feat in song_features.items():
            distance, _ = fastdtw(kasios_feat, feat, dist=euclidean)
            if distance < best_song_score:
                best_song_score = distance
                best_song_id = fid
            if distance > worst_song_score:
                worst_song_score = distance
                worst_song_id = fid
                
        results[kasios_filename] = {
            "bestCall": best_call_id,
            "bestCallScore": best_call_score,
            "worstCall": worst_call_id,
            "worstCallScore": worst_call_score,
            "bestSong": best_song_id,
            "bestSongScore": best_song_score,
            "worstSong": worst_song_id,
            "worstSongScore": worst_song_score
        }
        
    print(f"Saving results to {OUTPUT_PATH}...")
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, 'w') as f:
        json.dump(results, f, indent=4)
        
    print("Done! Results saved.")

if __name__ == "__main__":
    main()
