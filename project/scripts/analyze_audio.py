"""
Bird audio classifier — DTW + MFCC fingerprinting.

Speed: replaced fastdtw (Python-per-step euclidean calls) with cdist-based DTW.
  - scipy.cdist computes the full pairwise distance matrix in one C call
  - hop_length=2048 reduces frame count ~4× vs default 512
  - Combined: ~50-100× faster than the fastdtw approach
  - 25 min → ~30-60 s per Kasios file (single-threaded, no GPU needed)

Accuracy improvements over v1:
  - RMS normalize + bandpass 1-8 kHz — removes volume/noise differences
  - Drop MFCC C0 (energy) — noisy after RMS normalization
  - Z-score normalize each feature dimension — all 40 dims contribute equally
  - Path-length-normalized DTW — short and long recordings comparable
  - Median of top-3 per species — reduces bias from species with many recordings
  - Z-score softmin confidence — meaningful percentages regardless of scale
  - Feature cache — rebuild only when algorithm changes
"""

import os
import sys
import re
import json
import glob
import time
import pickle
import warnings
import hashlib

import numpy as np
import pandas as pd
import librosa
from scipy.spatial.distance import cdist
from scipy.signal import butter, filtfilt

warnings.filterwarnings("ignore")

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR    = os.path.join(BASE_DIR, "data")
CSV_PATH    = os.path.join(DATA_DIR, "AllBirdsv4.csv")
BIRDS_DIR   = os.path.join(DATA_DIR, "ALL BIRDS")
KASIOS_DIR  = os.path.join(DATA_DIR, "Test Birds from Kasios")
OUTPUT_PATH = os.path.join(BASE_DIR, "public", "comparisons.json")
CACHE_PATH  = os.path.join(BASE_DIR, "scripts", ".feature_cache.pkl")

# ── Config ────────────────────────────────────────────────────────────────────
SR          = 22050
HOP         = 2048   # Larger hop → fewer frames → much faster DTW. Default was 512.
N_MFCC      = 20     # Coefficients 1-20 (C0 dropped) + 20 deltas = 40 total dims.
BAND_LO     = 1000   # Hz
BAND_HI     = 8000   # Hz
DTW_RADIUS  = 1      # Sakoe-Chiba band. Use --radius N to increase (slower, more flexible).
TEMPERATURE = 1.5    # Softmin sharpness.

# Bump whenever feature extraction changes — auto-invalidates cache.
FEATURE_VERSION = "v5-hop2048-cdist"


# ── Feature extraction ────────────────────────────────────────────────────────

def _bandpass(y: np.ndarray, sr: int) -> np.ndarray:
    nyq = sr / 2.0
    b, a = butter(4, [BAND_LO / nyq, BAND_HI / nyq], btype="band")
    return filtfilt(b, a, y)


def extract_features(path: str) -> "np.ndarray | None":
    """Returns (T, 40) float32: Z-scored [20 MFCCs (C1-C20) + 20 deltas]."""
    try:
        y, sr = librosa.load(path, sr=SR)
        y, _  = librosa.effects.trim(y, top_db=20)
        if len(y) < HOP * 2:
            return None

        # Remove loudness differences
        rms = float(np.sqrt(np.mean(y ** 2)))
        if rms > 1e-6:
            y = y / rms

        # Focus on bird-call frequencies
        y = _bandpass(y, sr)

        # Extract features at coarser time resolution (HOP=2048 → ~10 frames/s)
        mfcc  = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=N_MFCC + 1, hop_length=HOP)[1:]
        delta = librosa.feature.delta(mfcc)
        feat  = np.vstack([mfcc, delta]).astype(np.float32)  # (40, T)

        # Z-score each dimension — critical: without this, low-order MFCCs
        # have 10-100× larger range and dominate the DTW distance.
        mu    = feat.mean(axis=1, keepdims=True)
        sigma = feat.std(axis=1, keepdims=True) + 1e-8
        feat  = (feat - mu) / sigma

        return feat.T  # (T, 40)
    except Exception:
        return None


# ── DTW ───────────────────────────────────────────────────────────────────────

def dtw_dist(a: np.ndarray, b: np.ndarray, radius: int = DTW_RADIUS) -> float:
    """
    Sakoe-Chiba DTW using a precomputed cdist matrix.

    cdist computes all n×m pairwise distances in one vectorised C call —
    no Python-per-step overhead. The DP then runs on the resulting numpy array.
    Distance is normalised by path length so recordings of different durations
    produce comparable scores.
    """
    n, m = len(a), len(b)

    # All pairwise Euclidean distances in one shot (C-level, fast)
    D = cdist(a, b, metric="euclidean")  # (n, m)

    band = max(abs(n - m), radius)

    # DP table
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

    # Normalise by approximate diagonal path length
    return float(dp[n - 1, m - 1]) / ((n + m) / 2.0)


# ── Confidence scoring ────────────────────────────────────────────────────────

def softmin_confidence(distances: "list[float]") -> np.ndarray:
    d = np.array(distances, dtype=np.float64)
    z = (d - d.mean()) / (d.std() + 1e-8)
    w = np.exp(-TEMPERATURE * z)
    return (w / w.sum()) * 100.0


# ── Feature cache ─────────────────────────────────────────────────────────────

def _cache_key(df: pd.DataFrame) -> str:
    csv_hash = hashlib.md5(df.to_csv(index=False).encode()).hexdigest()[:8]
    return f"{FEATURE_VERSION}|{csv_hash}"


def load_or_build_cache(df: pd.DataFrame, id_to_path: dict) -> "list[dict]":
    key = _cache_key(df)

    if os.path.exists(CACHE_PATH):
        try:
            with open(CACHE_PATH, "rb") as f:
                cached = pickle.load(f)
            if cached.get("key") == key:
                print(f"Feature cache hit — {len(cached['data'])} entries.")
                return cached["data"]
            print("Feature cache version mismatch — rebuilding.")
        except Exception:
            print("Cache load failed — rebuilding.")

    print(f"Extracting features for {len(id_to_path)} recordings…")
    data, n = [], 0
    for _, row in df.iterrows():
        fid = str(row["File ID"])
        if fid not in id_to_path:
            continue
        feat = extract_features(id_to_path[fid])
        if feat is not None:
            data.append({
                "fid":      fid,
                "species":  row["English_name"],
                "type":     str(row.get("Type", "")).lower().strip(),
                "features": feat,
            })
        n += 1
        if n % 200 == 0:
            print(f"  {n}/{len(id_to_path)} processed…")

    print(f"Cache built: {len(data)} valid fingerprints.")
    try:
        with open(CACHE_PATH, "wb") as f:
            pickle.dump({"key": key, "data": data}, f)
        print(f"Cache saved → {CACHE_PATH}")
    except Exception as e:
        print(f"Warning: could not save cache ({e})")

    return data


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    # CLI: --<N> runs only file N; --radius N sets DTW band; --rebuild-cache forces rebuild
    target_index  = None
    radius        = DTW_RADIUS
    rebuild_cache = "--rebuild-cache" in sys.argv

    for arg in sys.argv[1:]:
        if m := re.match(r"--(\d+)$", arg):
            target_index = int(m.group(1))
        if m := re.match(r"--radius=?(\d+)$", arg):
            radius = int(m.group(1))

    t_start = time.time()

    print("Loading CSV…")
    df = pd.read_csv(CSV_PATH)

    all_files  = glob.glob(os.path.join(BIRDS_DIR, "**", "*.mp3"), recursive=True)
    id_to_path = {}
    for p in all_files:
        parts = os.path.basename(p).replace(".mp3", "").split("-")
        if parts:
            id_to_path[parts[-1]] = p

    if rebuild_cache and os.path.exists(CACHE_PATH):
        os.remove(CACHE_PATH)
        print("Cache deleted — forcing rebuild.")

    cache    = load_or_build_cache(df, id_to_path)
    fid_type = {e["fid"]: e["type"] for e in cache}

    kasios_files = sorted(
        glob.glob(os.path.join(KASIOS_DIR, "**", "*.mp3"), recursive=True),
        key=lambda x: int(re.search(r"(\d+)", os.path.basename(x)).group(1)),
    )
    if target_index is not None:
        kasios_files = [
            p for p in kasios_files
            if int(re.search(r"(\d+)", os.path.basename(p)).group(1)) == target_index
        ]
        if not kasios_files:
            print(f"No Kasios file found for index {target_index}")
            return

    results: dict = {}
    if os.path.exists(OUTPUT_PATH):
        try:
            with open(OUTPUT_PATH, "r") as f:
                results = json.load(f)
        except Exception:
            pass

    for i, k_path in enumerate(kasios_files):
        t1    = time.time()
        fname = os.path.basename(k_path)
        print(f"\n[{i+1}/{len(kasios_files)}] {fname}  (radius={radius}, hop={HOP})")

        k_feat = extract_features(k_path)
        if k_feat is None:
            print("  Feature extraction failed — skipping.")
            continue

        print(f"  Kasios features: {k_feat.shape}  ({k_feat.shape[0]} frames × {k_feat.shape[1]} dims)")

        species_hits: "dict[str, list[tuple[float, str]]]" = {}
        n_total = len(cache)
        t_dtw   = time.time()

        for j, entry in enumerate(cache):
            d  = dtw_dist(k_feat, entry["features"], radius=radius)
            sp = entry["species"]
            if sp not in species_hits:
                species_hits[sp] = []
            species_hits[sp].append((d, entry["fid"]))

            if (j + 1) % 200 == 0 or (j + 1) == n_total:
                elapsed = time.time() - t_dtw
                eta     = elapsed / (j + 1) * (n_total - j - 1)
                print(
                    f"  {j+1}/{n_total}  ({(j+1)/n_total*100:.0f}%)  ETA {eta:.0f}s      ",
                    end="\r", flush=True,
                )
        print()

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
        print(f"  → {top['species']}  {top['confidence']:.1f}%  (DTW {top['distance']:.4f})")
        if pipit:
            print(f"     Pipit {pipit['distance']:.4f}  ratio ×{pipit['distance']/top['distance']:.2f}")
        print(f"  Time: {time.time() - t1:.1f}s")

    print(f"\nSaving → {OUTPUT_PATH}…")
    with open(OUTPUT_PATH, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Done in {(time.time() - t_start) / 60:.1f} min")


if __name__ == "__main__":
    main()
