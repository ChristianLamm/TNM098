"""
Bird audio classifier — Random Forest + Extra Trees ensemble on rich audio features.

Inspired by Bird_Classification.ipynb but uses an ensemble classifier instead of LSTM.
Training takes ~5-10 min once; inference is milliseconds per Kasios file.

Feature vector per recording (173 dims):
  Spectral: mean + std of 20 MFCCs, deltas, delta-deltas  (120)
            mean + std of 12 chroma features               (24)
            mean + std of 7 spectral contrast bands        (14)
            mean + std of centroid, rolloff, bandwidth,
                          zero-crossing rate, RMS energy   (10)
  Temporal: call rate, mean/std chirp duration,
            mean/std inter-call gap                         (5)

The temporal features encode rhythm: "calls once, pauses, calls once" gets
a very different call_rate + gap_mean than "rapid compact calls" — exactly
the distinction DTW could not make.

Usage:
  python scripts/classify_audio.py --train          build features + train + save model
  python scripts/classify_audio.py                  predict all 15 Kasios files
  python scripts/classify_audio.py --3              predict only 3.mp3
  python scripts/classify_audio.py --train --3      train then predict file 3
  python scripts/classify_audio.py --rebuild-cache  force feature cache rebuild
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
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd
import librosa
from scipy.signal import butter, filtfilt
from sklearn.ensemble import (
    VotingClassifier,
    RandomForestClassifier,
    ExtraTreesClassifier,
)
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.model_selection import StratifiedKFold, cross_val_score

warnings.filterwarnings("ignore")

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR    = os.path.join(BASE_DIR, "data")
CSV_PATH    = os.path.join(DATA_DIR, "AllBirdsv4.csv")
BIRDS_DIR   = os.path.join(DATA_DIR, "ALL BIRDS")
KASIOS_DIR  = os.path.join(DATA_DIR, "Test Birds from Kasios")
OUTPUT_PATH = os.path.join(BASE_DIR, "public", "comparisons_ml.json")
CACHE_PATH  = os.path.join(BASE_DIR, "scripts", ".ml_feature_cache.pkl")
MODEL_PATH  = os.path.join(BASE_DIR, "scripts", ".ml_model.pkl")

# ── Config ────────────────────────────────────────────────────────────────────
SR             = 22050
HOP            = 512
N_MFCC         = 20
BAND_LO        = 1000
BAND_HI        = 8000
QUALITY_FILTER = {"A", "B", "C"}
N_TREES        = 500       # per estimator — VotingClassifier uses RF + ExtraTrees
N_WORKERS      = max(1, (os.cpu_count() or 2) - 1)

FEATURE_VERSION = "ml-v2-rich"


# ── Audio helpers ─────────────────────────────────────────────────────────────

def _bandpass(y: np.ndarray, sr: int) -> np.ndarray:
    nyq = sr / 2.0
    b, a = butter(4, [BAND_LO / nyq, BAND_HI / nyq], btype="band")
    return filtfilt(b, a, y)


def extract_ml_features(path: str) -> "np.ndarray | None":
    """
    Returns a (173,) float32 feature vector.

    Spectral features are computed on silence-removed (chirp-only) audio.
    Temporal features capture calling rhythm — the key signal DTW ignores.
    """
    try:
        y, sr = librosa.load(path, sr=SR)
        y, _  = librosa.effects.trim(y, top_db=20)

        total_dur = len(y) / sr

        rms = float(np.sqrt(np.mean(y ** 2)))
        if rms > 1e-6:
            y = y / rms

        y = _bandpass(y, sr)

        # ── Segment non-silent intervals (actual calls) ───────────────────────
        try:
            ivs = librosa.effects.split(y, top_db=20, frame_length=2048, hop_length=512)
        except Exception:
            ivs = np.array([[0, len(y)]])
        if len(ivs) == 0:
            ivs = np.array([[0, len(y)]])

        # ── Temporal features ─────────────────────────────────────────────────
        chirp_durs = np.array(
            [(int(e) - int(s)) / sr for s, e in ivs if (int(e) - int(s)) >= HOP],
            dtype=np.float32,
        )
        gaps = np.array(
            [(int(ivs[i + 1][0]) - int(ivs[i][1])) / sr for i in range(len(ivs) - 1)],
            dtype=np.float32,
        ) if len(ivs) > 1 else np.array([0.0], dtype=np.float32)

        temporal = np.array([
            len(chirp_durs) / max(total_dur, 1e-3),       # call rate (calls/sec)
            chirp_durs.mean() if len(chirp_durs) > 0 else 0.0,
            chirp_durs.std()  if len(chirp_durs) > 1 else 0.0,
            gaps.mean(),
            gaps.std()        if len(gaps) > 1 else 0.0,
        ], dtype=np.float32)

        # ── Chirp-only audio ──────────────────────────────────────────────────
        segs     = [y[int(s):int(e)] for s, e in ivs if (int(e) - int(s)) >= HOP]
        y_chirps = np.concatenate(segs) if segs else y
        if len(y_chirps) < HOP * 2:
            return None

        # ── MFCC + delta + delta-delta ────────────────────────────────────────
        mfcc   = librosa.feature.mfcc(y=y_chirps, sr=sr, n_mfcc=N_MFCC, hop_length=HOP)
        delta  = librosa.feature.delta(mfcc)
        delta2 = librosa.feature.delta(mfcc, order=2)

        # ── Additional spectral features ──────────────────────────────────────
        chroma   = librosa.feature.chroma_stft(y=y_chirps, sr=sr, hop_length=HOP)
        contrast = librosa.feature.spectral_contrast(y=y_chirps, sr=sr, hop_length=HOP)
        centroid = librosa.feature.spectral_centroid(y=y_chirps, sr=sr, hop_length=HOP)
        rolloff  = librosa.feature.spectral_rolloff(y=y_chirps, sr=sr, hop_length=HOP)
        bwidth   = librosa.feature.spectral_bandwidth(y=y_chirps, sr=sr, hop_length=HOP)
        zcr      = librosa.feature.zero_crossing_rate(y_chirps, hop_length=HOP)
        rms_feat = librosa.feature.rms(y=y_chirps, hop_length=HOP)

        spectral: list = []
        # Multi-row features: mean + std per row
        for mat in (mfcc, delta, delta2, chroma, contrast):
            spectral.extend(mat.mean(axis=1).tolist())
            spectral.extend(mat.std(axis=1).tolist())
        # Single-row features: global mean + std
        for mat in (centroid, rolloff, bwidth, zcr, rms_feat):
            spectral.append(float(mat.mean()))
            spectral.append(float(mat.std()))

        return np.concatenate([spectral, temporal]).astype(np.float32)

    except Exception:
        return None


# ── Feature cache ─────────────────────────────────────────────────────────────

def _cache_key(df: pd.DataFrame) -> str:
    h = hashlib.md5(df.to_csv(index=False).encode()).hexdigest()[:8]
    return f"{FEATURE_VERSION}|{h}"


def build_feature_cache(df: pd.DataFrame, id_to_path: dict) -> "list[dict]":
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

    rows = [
        (str(row["File ID"]), row["English_name"], str(row.get("Type", "")))
        for _, row in df.iterrows()
        if str(row["File ID"]) in id_to_path
    ]

    print(f"Extracting features for {len(rows)} recordings  (workers={N_WORKERS})…")
    t0   = time.time()
    data = []
    done = [0]

    def _process(item):
        fid, species, rec_type = item
        feat = extract_ml_features(id_to_path[fid])
        done[0] += 1
        if done[0] % 100 == 0 or done[0] == len(rows):
            elapsed = time.time() - t0
            eta     = elapsed / done[0] * (len(rows) - done[0])
            print(f"  {done[0]}/{len(rows)}  ETA {eta:.0f}s      ", end="\r", flush=True)
        if feat is not None:
            return {"fid": fid, "species": species, "type": rec_type.lower().strip(), "features": feat}
        return None

    with ThreadPoolExecutor(max_workers=N_WORKERS) as pool:
        for result in pool.map(_process, rows):
            if result is not None:
                data.append(result)
    print()

    print(f"Cache built: {len(data)} valid entries  ({time.time() - t0:.1f}s)")
    try:
        with open(CACHE_PATH, "wb") as f:
            pickle.dump({"key": key, "data": data}, f)
        print(f"Cache saved → {CACHE_PATH}")
    except Exception as e:
        print(f"Warning: could not save cache ({e})")

    return data


# ── Model training ────────────────────────────────────────────────────────────

def train_and_save(cache: "list[dict]") -> dict:
    """
    Train a VotingClassifier (Random Forest + Extra Trees, soft voting).
    Both estimators use all CPU cores. 5-fold CV accuracy is reported.
    The training set (scaled features + labels + FIDs) is saved alongside the
    model for nearest-reference lookup at inference time.
    """
    X      = np.array([e["features"] for e in cache], dtype=np.float32)
    labels = np.array([e["species"]  for e in cache])
    fids   = np.array([e["fid"]      for e in cache])
    types  = np.array([e["type"]     for e in cache])

    le = LabelEncoder()
    y  = le.fit_transform(labels)

    scaler   = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    n_species = len(le.classes_)
    print(f"\nTraining ensemble  (RF×{N_TREES} + ET×{N_TREES}, {len(X)} samples, "
          f"{X.shape[1]} features, {n_species} species)…")

    clf = VotingClassifier(
        estimators=[
            ("rf", RandomForestClassifier(
                n_estimators=N_TREES,
                max_features="sqrt",
                min_samples_leaf=1,
                class_weight="balanced",
                n_jobs=-1,
                random_state=42,
            )),
            ("et", ExtraTreesClassifier(
                n_estimators=N_TREES,
                max_features="sqrt",
                min_samples_leaf=1,
                class_weight="balanced",
                n_jobs=-1,
                random_state=0,
            )),
        ],
        voting="soft",
    )

    print("Running 5-fold cross-validation…", flush=True)
    cv     = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    scores = cross_val_score(clf, X_scaled, y, cv=cv, scoring="accuracy", n_jobs=1)
    print(f"CV accuracy: {scores.mean():.1%} ± {scores.std():.1%}  "
          f"(per fold: {', '.join(f'{s:.0%}' for s in scores)})")

    t0 = time.time()
    clf.fit(X_scaled, y)
    print(f"Final model trained in {time.time() - t0:.1f}s")

    model = {
        "clf":      clf,
        "le":       le,
        "scaler":   scaler,
        "X_scaled": X_scaled,
        "labels":   labels,
        "fids":     fids,
        "types":    types,
    }
    with open(MODEL_PATH, "wb") as f:
        pickle.dump(model, f)
    print(f"Model saved → {MODEL_PATH}")
    return model


def load_model() -> "dict | None":
    if not os.path.exists(MODEL_PATH):
        return None
    try:
        with open(MODEL_PATH, "rb") as f:
            return pickle.load(f)
    except Exception:
        return None


# ── Prediction ────────────────────────────────────────────────────────────────

def predict_file(path: str, model: dict) -> "list[dict] | None":
    """
    Predict species probabilities and find the nearest reference recording
    (in scaled feature space) for each species — used for audio playback in the UI.
    """
    feat = extract_ml_features(path)
    if feat is None:
        return None

    clf      = model["clf"]
    le       = model["le"]
    scaler   = model["scaler"]
    X_scaled = model["X_scaled"]
    labels   = model["labels"]
    fids     = model["fids"]
    types    = model["types"]

    feat_scaled = scaler.transform(feat.reshape(1, -1))[0]
    proba       = clf.predict_proba(feat_scaled.reshape(1, -1))[0]

    predictions = []
    for idx, prob in enumerate(proba):
        sp       = le.classes_[idx]
        sp_mask  = labels == sp
        sp_X     = X_scaled[sp_mask]
        sp_fids  = fids[sp_mask]
        sp_types = types[sp_mask]

        dists = np.linalg.norm(sp_X - feat_scaled, axis=1)
        best  = int(dists.argmin())

        predictions.append({
            "species":    sp,
            "confidence": float(round(prob * 100, 3)),
            "fid":        str(sp_fids[best]),
            "distance":   float(round(float(dists[best]), 4)),
            "type":       str(sp_types[best]),
        })

    predictions.sort(key=lambda x: x["confidence"], reverse=True)
    return predictions


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    do_train      = "--train" in sys.argv
    rebuild_cache = "--rebuild-cache" in sys.argv
    target_index  = None

    for arg in sys.argv[1:]:
        if m := re.match(r"--(\d+)$", arg):
            target_index = int(m.group(1))

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
        print("Feature cache deleted — forcing rebuild.")

    cache = build_feature_cache(df, id_to_path)

    model = None
    if do_train:
        model = train_and_save(cache)
    else:
        model = load_model()
        if model is None:
            print("\nNo trained model found — training now.")
            model = train_and_save(cache)
        else:
            print(f"Model loaded  ({len(model['le'].classes_)} species, "
                  f"{len(model['fids'])} reference recordings)")

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
        print(f"\n[{i+1}/{len(kasios_files)}] {fname}")

        predictions = predict_file(k_path, model)
        if predictions is None:
            print("  Feature extraction failed — skipping.")
            continue

        top   = predictions[0]
        pipit = next((p for p in predictions if p["species"] == "Rose-crested Blue Pipit"), None)

        results[fname] = {
            "predictions":        predictions[:5],
            "bestPipitMatch":     pipit["fid"]      if pipit else None,
            "bestPipitScore":     pipit["distance"] if pipit else None,
            "overallBestMatch":   top["fid"],
            "overallBestSpecies": top["species"],
        }

        print(f"  → {top['species']}  {top['confidence']:.1f}%")
        if pipit:
            print(f"     Pipit  {pipit['confidence']:.1f}%  (dist {pipit['distance']:.3f})")
        print(f"  Time: {time.time() - t1:.2f}s")

    print(f"\nSaving → {OUTPUT_PATH}…")
    with open(OUTPUT_PATH, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Done in {(time.time() - t_start) / 60:.1f} min")


if __name__ == "__main__":
    main()
