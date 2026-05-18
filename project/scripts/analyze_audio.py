"""
Bird audio classifier — DTW + MFCC fingerprinting.

Performance:
  - Numba JIT compiles the DTW DP loop to native machine code (~50-100× faster)
  - nogil=True releases the GIL so ThreadPoolExecutor gets true CPU parallelism
  - ThreadPoolExecutor parallelises comparisons across all CPU cores
  - cdist-based pairwise distance matrix (vectorised C)
  - hop_length=2048 reduces frame count ~4× vs default 512

Accuracy:
  - Quality filter: only A/B/C rated reference recordings
  - Chirp segmentation: Kasios file split into non-silent segments;
    each chirp matched independently; minimum DTW per reference
  - RMS normalize + bandpass 1-8 kHz, drop MFCC C0
  - Z-score normalize per feature dimension
  - Path-length-normalized DTW, median top-3 per species
  - Z-score softmin confidence scoring
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
import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd
import librosa
import numba
from scipy.spatial.distance import cdist
from scipy.signal import butter, filtfilt

warnings.filterwarnings("ignore")

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR    = os.path.join(BASE_DIR, "data")
CSV_PATH    = os.path.join(DATA_DIR, "AllBirdsv4.csv")
BIRDS_DIR   = os.path.join(DATA_DIR, "ALL BIRDS")
KASIOS_DIR  = os.path.join(DATA_DIR, "Test Birds from Kasios")
OUTPUT_PATH = os.path.join(BASE_DIR, "public", "comparisons_dtw.json")
CACHE_PATH  = os.path.join(BASE_DIR, "scripts", ".feature_cache.pkl")

# ── Config ────────────────────────────────────────────────────────────────────
SR             = 22050
HOP            = 2048
N_MFCC         = 20
BAND_LO        = 1000
BAND_HI        = 8000
DTW_RADIUS     = 1
TEMPERATURE    = 1.5
QUALITY_FILTER = {"A", "B", "C"}
MAX_CHIRPS     = 6
N_WORKERS      = max(1, (os.cpu_count() or 2) - 1)

# Bump whenever feature extraction or filtering changes — auto-invalidates cache.
FEATURE_VERSION = "v6-chirp-quality"


# ── Feature extraction ────────────────────────────────────────────────────────

def _bandpass(y: np.ndarray, sr: int) -> np.ndarray:
    nyq = sr / 2.0
    b, a = butter(4, [BAND_LO / nyq, BAND_HI / nyq], btype="band")
    return filtfilt(b, a, y)


def _extract_from_y(y: np.ndarray, sr: int) -> "np.ndarray | None":
    """Returns (T, 40) float32 from a pre-loaded audio array."""
    try:
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
        return ((feat - mu) / sigma).T  # (T, 40)
    except Exception:
        return None


def extract_features(path: str) -> "np.ndarray | None":
    """Load file, trim silence, extract features."""
    try:
        y, sr = librosa.load(path, sr=SR)
        y, _  = librosa.effects.trim(y, top_db=20)
        return _extract_from_y(y, sr)
    except Exception:
        return None


def _segment_chirps(y: np.ndarray) -> "list[np.ndarray]":
    """
    Split audio into non-silent segments. Returns the longest MAX_CHIRPS
    segments, falling back to the full signal if none are found.
    """
    try:
        intervals = librosa.effects.split(y, top_db=20, frame_length=2048, hop_length=512)
    except Exception:
        return [y]
    segments = [y[s:e] for s, e in intervals if (e - s) >= HOP * 2]
    if not segments:
        return [y]
    segments.sort(key=len, reverse=True)
    return segments[:MAX_CHIRPS]


# ── DTW ───────────────────────────────────────────────────────────────────────

@numba.jit(nopython=True, nogil=True, cache=True)
def _dtw_dp(D: np.ndarray, band: int) -> float:
    """
    Sakoe-Chiba DP compiled to native machine code.
    nogil=True releases the GIL so multiple threads run this in true parallel.
    """
    n, m = D.shape
    dp = np.full((n, m), np.inf)
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
    return dp[n - 1, m - 1] / ((n + m) / 2.0)


def dtw_dist(a: np.ndarray, b: np.ndarray, radius: int = DTW_RADIUS) -> float:
    n, m = len(a), len(b)
    D    = cdist(a, b, metric="euclidean")
    band = max(abs(n - m), radius)
    return _dtw_dp(D, band)


def _warmup_numba() -> None:
    """Trigger JIT compilation before the main loop so it doesn't stall there."""
    dummy = np.zeros((4, 40), dtype=np.float64)
    D     = cdist(dummy, dummy)
    _dtw_dp(D, 1)


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
    if "Quality" in df.columns:
        before = len(df)
        df = df[df["Quality"].isin(QUALITY_FILTER)]
        print(f"Quality filter (A/B/C): {len(df)}/{before} recordings kept.")

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

    print(f"Extracting features for {len(df)} recordings…")
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
            print(f"  {n}/{len(df)} processed…")

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

    print(f"Compiling Numba JIT (first run only, cached after)…", end=" ", flush=True)
    _warmup_numba()
    print(f"ready.  Workers: {N_WORKERS}")

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
        print(f"\n[{i+1}/{len(kasios_files)}] {fname}  (radius={radius}, hop={HOP}, workers={N_WORKERS})")

        try:
            k_y, _ = librosa.load(k_path, sr=SR)
            k_y, _ = librosa.effects.trim(k_y, top_db=20)
        except Exception:
            print("  Audio load failed — skipping.")
            continue

        chirp_segments = _segment_chirps(k_y)
        k_feats = [f for seg in chirp_segments if (f := _extract_from_y(seg, SR)) is not None]

        if not k_feats:
            print("  Feature extraction failed — skipping.")
            continue

        print(f"  {len(k_feats)} chirp(s)  [{', '.join(str(f.shape[0]) for f in k_feats)} frames]")
        print(f"  Comparing against {len(cache)} references…", flush=True)

        n_total = len(cache)
        t_dtw   = time.time()
        counter = [0]
        lock    = threading.Lock()

        def _compare(entry, _k=k_feats, _r=radius):
            d = min(dtw_dist(kf, entry["features"], radius=_r) for kf in _k)
            with lock:
                counter[0] += 1
                n = counter[0]
                if n % 200 == 0 or n == n_total:
                    elapsed = time.time() - t_dtw
                    eta     = elapsed / n * (n_total - n)
                    print(f"  {n}/{n_total}  ({n/n_total*100:.0f}%)  ETA {eta:.0f}s      ",
                          end="\r", flush=True)
            return entry["species"], d, entry["fid"]

        with ThreadPoolExecutor(max_workers=N_WORKERS) as pool:
            compare_results = list(pool.map(_compare, cache))
        print()

        species_hits: "dict[str, list[tuple[float, str]]]" = {}
        for sp, d, fid in compare_results:
            if sp not in species_hits:
                species_hits[sp] = []
            species_hits[sp].append((d, fid))

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
