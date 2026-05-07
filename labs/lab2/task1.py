from __future__ import annotations

import argparse
import csv
from pathlib import Path
from typing import List, Sequence, Tuple

import matplotlib
import numpy as np
from PIL import Image

matplotlib.use("Agg")
import matplotlib.pyplot as plt


# Task 1 fixed setup (this script targets only the provided 12 JPG images).
IMAGES_DIR = Path("images")
OUTPUT_DIR = Path("task1_outputs")
EXPECTED_IMAGE_COUNT = 12
IMAGE_SIZE = 256
WEIGHTS = np.array([0.4, 0.3, 0.3], dtype=np.float64)  # color, radial, edge


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Task 1 image comparison (minimal version).")
    parser.add_argument("--ref", type=int, default=1, help="Reference image index in sorted order (1..12).")
    parser.add_argument(
        "--save-files",
        action="store_true",
        help="Save matrix CSV, ranking CSV, and heatmap PNG to task1_outputs/.",
    )
    return parser.parse_args()


def load_image_paths() -> List[Path]:
    paths = sorted(IMAGES_DIR.glob("*.jpg"))
    if len(paths) != EXPECTED_IMAGE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_IMAGE_COUNT} JPG images in {IMAGES_DIR}, found {len(paths)}."
        )
    return paths


def load_preprocess(path: Path) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    try:
        resample = Image.Resampling.BILINEAR
    except AttributeError:
        resample = Image.BILINEAR

    with Image.open(path) as img:
        rgb = img.convert("RGB").resize((IMAGE_SIZE, IMAGE_SIZE), resample)

    rgb = np.asarray(rgb, dtype=np.float64) / 255.0
    lum = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]

    max_channel = np.max(rgb, axis=2)
    min_channel = np.min(rgb, axis=2)
    delta = max_channel - min_channel
    sat = np.zeros_like(max_channel)
    valid = max_channel > 1e-12
    sat[valid] = delta[valid] / max_channel[valid]

    return rgb, lum, sat


# Feature that captures the color distribution in the RGB space using a 3D histogram with specified bins per channel, normalized to sum to 1.
def color_feature(rgb: np.ndarray, bins: int = 8) -> np.ndarray:
    hist, _ = np.histogramdd(
        rgb.reshape(-1, 3),
        bins=(bins, bins, bins),
        range=((0, 1), (0, 1), (0, 1)),
    )
    vec = hist.ravel().astype(np.float64)
    total = float(np.sum(vec))
    if total > 0:
        vec /= total
    return vec


# Feature that captures average luminance and saturation in concentric rings around the image center and two off-center anchors.
def radial_feature(lum: np.ndarray, sat: np.ndarray, rings: int = 4) -> np.ndarray:
    h, w = lum.shape
    yy, xx = np.indices((h, w), dtype=np.float64)

    # Random anchors: center and two off-center points at 25% and 75% of the image dimensions.
    anchors = [
        (0.50 * (h - 1), 0.50 * (w - 1)),
        (0.25 * (h - 1), 0.25 * (w - 1)),
        (0.25 * (h - 1), 0.75 * (w - 1)),
    ]
    corners = np.array(
        [[0.0, 0.0], [0.0, w - 1.0], [h - 1.0, 0.0], [h - 1.0, w - 1.0]],
        dtype=np.float64,
    )

    values: List[float] = []
    for ay, ax in anchors:
        dist = np.sqrt((yy - ay) ** 2 + (xx - ax) ** 2)
        max_r = float(np.max(np.sqrt((corners[:, 0] - ay) ** 2 + (corners[:, 1] - ax) ** 2)))
        edges = np.linspace(0.0, max_r, rings + 1)

        for i in range(rings):
            lo = edges[i]
            hi = edges[i + 1]
            if i == rings - 1:
                mask = (dist >= lo) & (dist <= hi)
            else:
                mask = (dist >= lo) & (dist < hi)

            if np.any(mask):
                values.append(float(np.mean(lum[mask])))
                values.append(float(np.mean(sat[mask])))
            else:
                values.extend((0.0, 0.0))

    return np.asarray(values, dtype=np.float64)


# Feature that captures the distribution of edge orientations in the image using a histogram of gradient angles weighted by their magnitudes, normalized to sum to 1.
def edge_feature(lum: np.ndarray, bins: int = 9) -> np.ndarray:
    gy, gx = np.gradient(lum)
    mag = np.sqrt(gx * gx + gy * gy)
    ang = np.arctan2(gy, gx)

    hist, _ = np.histogram(ang, bins=bins, range=(-np.pi, np.pi), weights=mag)
    vec = hist.astype(np.float64)
    total = float(np.sum(vec))
    if total > 0:
        vec /= total
    return vec


def normalize_group(group: np.ndarray) -> np.ndarray:
    mean = np.mean(group, axis=0, keepdims=True)
    std = np.std(group, axis=0, keepdims=True)
    std = np.where(std < 1e-12, 1.0, std)

    z = (group - mean) / std
    norms = np.linalg.norm(z, axis=1, keepdims=True)
    norms = np.where(norms < 1e-12, 1.0, norms)
    return z / norms


def build_vectors(paths: Sequence[Path]) -> Tuple[List[str], np.ndarray, Tuple[int, int, int], np.ndarray]:
    labels: List[str] = []
    color_list: List[np.ndarray] = []
    radial_list: List[np.ndarray] = []
    edge_list: List[np.ndarray] = []

    for path in paths:
        rgb, lum, sat = load_preprocess(path)
        labels.append(path.name)
        color_list.append(color_feature(rgb))
        radial_list.append(radial_feature(lum, sat))
        edge_list.append(edge_feature(lum))

    color_mat = normalize_group(np.vstack(color_list))
    radial_mat = normalize_group(np.vstack(radial_list))
    edge_mat = normalize_group(np.vstack(edge_list))

    weights = WEIGHTS / np.sum(WEIGHTS)
    vectors = np.concatenate(
        [
            color_mat * weights[0],
            radial_mat * weights[1],
            edge_mat * weights[2],
        ],
        axis=1,
    )

    dims = (color_mat.shape[1], radial_mat.shape[1], edge_mat.shape[1])
    return labels, vectors, dims, weights


def cosine_distance_matrix(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms = np.where(norms < 1e-12, 1.0, norms)
    unit = vectors / norms

    similarity = np.clip(unit @ unit.T, -1.0, 1.0)
    dist = 1.0 - similarity
    dist = (dist + dist.T) / 2.0
    np.fill_diagonal(dist, 0.0)
    return dist


def ranking_for_reference(dist: np.ndarray, labels: Sequence[str], ref_idx: int) -> List[Tuple[int, str, float]]:
    idxs = [i for i in range(len(labels)) if i != ref_idx]
    idxs.sort(key=lambda i: float(dist[ref_idx, i]))
    return [(rank + 1, labels[i], float(dist[ref_idx, i])) for rank, i in enumerate(idxs)]


def print_distance_matrix(labels: Sequence[str], dist: np.ndarray) -> None:
    print("\nDistance matrix (cosine, rows/cols follow this order):")
    print(", ".join(labels))
    for i, row in enumerate(dist):
        row_text = " ".join(f"{x:0.4f}" for x in row)
        print(f"{labels[i]}  {row_text}")


def print_ranking(ref_name: str, ranking: Sequence[Tuple[int, str, float]]) -> None:
    print(f"\nReference image: {ref_name}")
    print("Rank  Image        Distance")
    print("----  -----------  --------")
    for rank, name, value in ranking:
        print(f"{rank:>4}  {name:<11}  {value:>8.6f}")


def save_matrix_csv(path: Path, labels: Sequence[str], dist: np.ndarray) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["image", *labels])
        for label, row in zip(labels, dist):
            writer.writerow([label, *[f"{x:.8f}" for x in row]])


def save_ranking_csv(path: Path, ranking: Sequence[Tuple[int, str, float]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["rank", "image", "distance"])
        for rank, name, value in ranking:
            writer.writerow([rank, name, f"{value:.8f}"])


def save_heatmap(path: Path, labels: Sequence[str], dist: np.ndarray) -> None:
    fig, ax = plt.subplots(figsize=(8, 6))
    img = ax.imshow(dist, cmap="viridis", interpolation="nearest")
    ax.set_title("Task 1 Distance Matrix (cosine)")
    ax.set_xticks(np.arange(len(labels)))
    ax.set_yticks(np.arange(len(labels)))
    ax.set_xticklabels(labels, rotation=45, ha="right")
    ax.set_yticklabels(labels)
    ax.set_xlabel("Image")
    ax.set_ylabel("Image")
    fig.colorbar(img, ax=ax, label="Distance")
    fig.tight_layout()
    fig.savefig(path, dpi=220)
    plt.close(fig)


def main() -> int:
    args = parse_args()

    paths = load_image_paths()
    labels, vectors, dims, weights = build_vectors(paths)

    if not (1 <= args.ref <= len(labels)):
        raise ValueError(f"--ref must be in range 1..{len(labels)}")
    ref_idx = args.ref - 1

    dist = cosine_distance_matrix(vectors)
    ranking = ranking_for_reference(dist, labels, ref_idx)

    color_dim, radial_dim, edge_dim = dims
    print("Task 1 done.")
    print(f"Features -> color={color_dim}, radial={radial_dim}, edge={edge_dim}")
    print(
        "Weights -> "
        f"color={weights[0]:.3f}, radial={weights[1]:.3f}, edge={weights[2]:.3f}"
    )

    print_distance_matrix(labels, dist)
    print_ranking(labels[ref_idx], ranking)

    if args.save_files:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        matrix_path = OUTPUT_DIR / "distance_matrix_cosine.csv"
        ranking_path = OUTPUT_DIR / f"ranking_ref_{labels[ref_idx]}.csv"
        heatmap_path = OUTPUT_DIR / "distance_heatmap_cosine.png"

        save_matrix_csv(matrix_path, labels, dist)
        save_ranking_csv(ranking_path, ranking)
        save_heatmap(heatmap_path, labels, dist)

        print("\nSaved files:")
        print(f"- {matrix_path}")
        print(f"- {ranking_path}")
        print(f"- {heatmap_path}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Error: {exc}")
        raise SystemExit(1)
