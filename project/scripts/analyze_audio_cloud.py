"""
Bird audio classifier — DTW + MFCC fingerprinting (Cloud Run Version).
"""

import os
import sys
import re
import json
import time
import pickle
import warnings
import hashlib
import tempfile

import numpy as np
import pandas as pd
import librosa
from scipy.spatial.distance import cdist
from scipy.signal import butter, filtfilt
from google.cloud import storage

warnings.filterwarnings("ignore")

# ── Cloud Storage Config ──────────────────────────────────────────────────────
BUCKET_NAME = "my-mp3-comparison-bucket" # <--- UPDATE THIS
storage_client = storage.Client()
bucket = storage_client.bucket(BUCKET_NAME)

CSV_PATH    = f"gs://{BUCKET_NAME}/AllBirdsv4.csv" # pandas + gcsfs can read this directly
OUTPUT_BLOB = "output/comparisons.json"
CACHE_BLOB  = "output/.feature_cache.pkl"

# ── Config ────────────────────────────────────────────────────────────────────
SR          = 22050
HOP         = 2048   
N_MFCC      = 20     
BAND_LO     = 1000   
BAND_HI     = 8000   
DTW_RADIUS  = 1      
TEMPERATURE = 1.5    
FEATURE_VERSION = "v5-hop2048-cdist-cloud"

# ── Feature extraction ────────────────────────────────────────────────────────

def _bandpass(y: np.ndarray, sr: int) -> np.ndarray:
    nyq = sr / 2.0
    b, a = butter(4, [BAND_LO / nyq, BAND_HI / nyq], btype="band")
    return filtfilt(b, a, y)

def extract_features(blob_name: str) -> "np.ndarray | None":
    """Downloads blob temporarily, extracts features, cleans up."""
    blob = bucket.blob(blob_name)
    
    # Download to a temporary file so librosa can safely read it
    with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp:
        blob.download_to_filename(tmp.name)
        tmp_path = tmp.name

    try:
        y, sr = librosa.load(tmp_path, sr=SR)
        y, _  = librosa.effects.trim(y, top_db=20)
        if len(y) < HOP * 2:
            return None

        rms = float(np.sqrt(np.mean(y ** 2)))
        if rms > 1e-6:
            y = y / rms

        y = _bandpass(y, sr)
        mfcc  = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=N_MFCC + 1, hop_length=HOP)[1:]
        delta = librosa.feature.delta(mfcc)
        feat  = np.vstack([mfcc, delta]).astype(np.float32)

        mu    = feat.mean(axis=1, keepdims=True)
        sigma = feat.std(axis=1, keepdims=True) + 1e-8
        feat  = (feat - mu) / sigma

        return feat.T
    except Exception as e:
        print(f"Error processing {blob_name}: {e}")
        return None
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

# ── DTW & Confidence ──────────────────────────────────────────────────────────
# (These remain completely unchanged from your script)

def dtw_dist(a: np.ndarray, b: np.ndarray, radius: int = DTW_RADIUS) -> float:
    n, m = len(a), len(b)
    D = cdist(a, b, metric="euclidean")
    band = max(abs(n - m), radius)
    dp = np.full((n, m), np.inf, dtype=np.float64)
    dp[0, 0] = D[0, 0]

    for j in range(1, min(m, band + 1)):
        dp[0, j] = D[0, j] + dp[0, j - 1]
    for i in range(1, min(n, band + 1)):
        dp[i, 0] = D[i, 0] + dp[i - 1, 0]

    for i in range(1, n):
        j_lo = max(1, i - band)
        j_hi = min(m - 1, i + band)
        for j in range(j_lo, j_hi + 1):
            dp[i, j] = D[i, j] + min(dp[i - 1, j], dp[i, j - 1], dp[i - 1, j - 1])

    return float(dp[n - 1, m - 1]) / ((n + m) / 2.0)

def softmin_confidence(distances: "list[float]") -> np.ndarray:
    d = np.array(distances, dtype=np.float64)
    z = (d - d.mean()) / (d.std() + 1e-8)
    w = np.exp(-TEMPERATURE * z)
    return (w / w.sum()) * 100.0

# ── Feature cache (Cloud Version) ─────────────────────────────────────────────

def _cache_key(df: pd.DataFrame) -> str:
    csv_hash = hashlib.md5(df.to_csv(index=False).encode()).hexdigest()[:8]
    return f"{FEATURE_VERSION}|{csv_hash}"

def load_or_build_cache(df: pd.DataFrame, id_to_blob: dict, rebuild: bool) -> "list[dict]":
    key = _cache_key(df)
    cache_blob_obj = bucket.blob(CACHE_BLOB)

    if not rebuild and cache_blob_obj.exists():
        try:
            cache_bytes = cache_blob_obj.download_as_bytes()
            cached = pickle.loads(cache_bytes)
            if cached.get("key") == key:
                print(f"Cloud cache hit — {len(cached['data'])} entries.")
                return cached["data"]
            print("Feature cache version mismatch — rebuilding.")
        except Exception:
            print("Cache load failed — rebuilding.")

    print(f"Extracting features for {len(id_to_blob)} recordings…")
    data, n = [], 0
    for _, row in df.iterrows():
        fid = str(row["File ID"])
        if fid not in id_to_blob:
            continue
        feat = extract_features(id_to_blob[fid])
        if feat is not None:
            data.append({
                "fid":      fid,
                "species":  row["English_name"],
                "type":     str(row.get("Type", "")).lower().strip(),
                "features": feat,
            })
        n += 1
        if n % 50 == 0:
            print(f"  {n}/{len(id_to_blob)} processed…")

    print(f"Cache built: {len(data)} valid fingerprints.")
    try:
        pickled_data = pickle.dumps({"key": key, "data": data})
        cache_blob_obj.upload_from_string(pickled_data)
        print(f"Cache saved to gs://{BUCKET_NAME}/{CACHE_BLOB}")
    except Exception as e:
        print(f"Warning: could not save cache to GCS ({e})")

    return data

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    radius = DTW_RADIUS
    rebuild_cache = "--rebuild-cache" in sys.argv

    t_start = time.time()
    print(f"Loading CSV from gs://{BUCKET_NAME}…")
    df = pd.read_csv(CSV_PATH)

    # Find all base bird files in GCS
    print("Scanning storage bucket for ALL BIRDS…")
    all_blobs = storage_client.list_blobs(BUCKET_NAME, prefix="ALL BIRDS/")
    id_to_blob = {}
    for b in all_blobs:
        if b.name.endswith(".mp3"):
            parts = os.path.basename(b.name).replace(".mp3", "").split("-")
            if parts:
                id_to_blob[parts[-1]] = b.name

    cache = load_or_build_cache(df, id_to_blob, rebuild_cache)
    fid_type = {e["fid"]: e["type"] for e in cache}

    # Find all Kasios files in GCS
    print("Scanning storage bucket for Kasios files…")
    kasios_blobs = storage_client.list_blobs(BUCKET_NAME, prefix="Test Birds from Kasios/")
    kasios_files = [b.name for b in kasios_blobs if b.name.endswith(".mp3")]
    
    # Sort them by number for neatness
    kasios_files.sort(key=lambda x: int(re.search(r"(\d+)", os.path.basename(x)).group(1)) if re.search(r"(\d+)", os.path.basename(x)) else 0)

    results: dict = {}
    out_blob_obj = bucket.blob(OUTPUT_BLOB)
    if out_blob_obj.exists():
        try:
            results = json.loads(out_blob_obj.download_as_string())
        except Exception:
            pass

    for i, k_blob_name in enumerate(kasios_files):
        t1    = time.time()
        fname = os.path.basename(k_blob_name)
        print(f"\n[{i+1}/{len(kasios_files)}] {fname}  (radius={radius}, hop={HOP})")

        k_feat = extract_features(k_blob_name)
        if k_feat is None:
            print("  Feature extraction failed — skipping.")
            continue

        species_hits: "dict[str, list[tuple[float, str]]]" = {}
        n_total = len(cache)

        for j, entry in enumerate(cache):
            d  = dtw_dist(k_feat, entry["features"], radius=radius)
            sp = entry["species"]
            if sp not in species_hits:
                species_hits[sp] = []
            species_hits[sp].append((d, entry["fid"]))

        species_scores = []
        for sp, hits in species_hits.items():
            hits.sort(key=lambda x: x[0])
            top3     = hits[:3]
            agg_dist = float(np.median([h[0] for h in top3]))
            best_fid = hits[0][1]
            species_scores.append({
                "species":  sp,
                "distance": agg_dist,
                "fid":      best_fid,
                "type":     fid_type.get(best_fid, "unknown"),
            })

        confs = softmin_confidence([s["distance"] for s in species_scores])
        for s, c in zip(species_scores, confs):
            s["confidence"] = float(round(c, 3))

        species_scores.sort(key=lambda x: x["confidence"], reverse=True)
        pipit = next((s for s in species_scores if s["species"] == "Rose-crested Blue Pipit"), None)

        results[fname] = {
            "predictions":        species_scores[:5],
            "bestPipitMatch":     pipit["fid"]      if pipit else None,
            "bestPipitScore":     pipit["distance"] if pipit else None,
            "overallBestMatch":   species_scores[0]["fid"],
            "overallBestSpecies": species_scores[0]["species"],
        }

        top = species_scores[0]
        print(f"  → {top['species']}  {top['confidence']:.1f}%  (DTW {top['distance']:.4f}) Time: {time.time() - t1:.1f}s")

    print(f"\nSaving results to gs://{BUCKET_NAME}/{OUTPUT_BLOB}…")
    out_blob_obj.upload_from_string(json.dumps(results, indent=2), content_type="application/json")
    print(f"Done in {(time.time() - t_start) / 60:.1f} min")

if __name__ == "__main__":
    main()