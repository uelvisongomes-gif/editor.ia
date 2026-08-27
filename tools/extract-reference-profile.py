#!/usr/bin/env python3
"""Extract a reference profile (JSON) from a professionally edited video.

Usage:
    python tools/extract-reference-profile.py path/to/reference.mp4 output.json

Requires:
    pip install scenedetect opencv-python numpy

The output JSON matches the schema in src/services/referenceProfile.js.
Load it in the editor to calibrate cutDensityGuard, smartZoom, etc.
"""

import argparse
import json
import statistics
import subprocess
import sys
from pathlib import Path


def probe_duration(video_path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(video_path)],
        capture_output=True, text=True,
    )
    return float(result.stdout.strip())


def detect_scenes(video_path: Path):
    """Uses PySceneDetect to find visual cuts."""
    try:
        from scenedetect import open_video, SceneManager
        from scenedetect.detectors import ContentDetector
    except ImportError:
        print("scenedetect not installed — pip install scenedetect opencv-python", file=sys.stderr)
        sys.exit(1)

    video = open_video(str(video_path))
    sm = SceneManager()
    sm.add_detector(ContentDetector(threshold=27.0))
    sm.detect_scenes(video)
    return sm.get_scene_list()


def profile_cuts(scenes, duration_sec):
    if not scenes:
        return {"perMinute": 0, "averageDurationSec": duration_sec, "shortestCutSec": duration_sec,
                "longestCutSec": duration_sec, "distribution": {"microcut": 0, "short": 0, "medium": 0, "long": 100}}
    per_min = len(scenes) / max(0.1, duration_sec / 60)
    durations = [(end.get_seconds() - start.get_seconds()) for start, end in scenes]
    avg = statistics.mean(durations) if durations else 0
    shortest = min(durations) if durations else 0
    longest = max(durations) if durations else 0
    # buckets
    micro = sum(1 for d in durations if d < 0.5)
    short = sum(1 for d in durations if 0.5 <= d < 2)
    medium = sum(1 for d in durations if 2 <= d < 5)
    long_ = sum(1 for d in durations if d >= 5)
    total = max(1, len(durations))
    return {
        "perMinute": round(per_min, 2),
        "averageDurationSec": round(avg, 2),
        "shortestCutSec": round(shortest, 2),
        "longestCutSec": round(longest, 2),
        "distribution": {
            "microcut": round(100 * micro / total),
            "short": round(100 * short / total),
            "medium": round(100 * medium / total),
            "long": round(100 * long_ / total),
        },
    }


def build_reference_profile(video_path: Path):
    duration = probe_duration(video_path)
    scenes = detect_scenes(video_path)
    return {
        "name": video_path.stem,
        "sourceDurationSec": round(duration, 2),
        "cuts": profile_cuts(scenes, duration),
        # zooms/captions/visual/pacing require face-detection + audio analysis
        # that would balloon this tool. Leave placeholders for manual entry
        # or extend later.
        "zooms": {"perMinute": 3, "averageDurationSec": 4, "averageIntensity": 1.25,
                  "distribution": {"light": 40, "medium": 45, "strong": 15}, "easing": "progressive"},
        "captions": {"preferredPosition": "middle-bottom", "averageWordsPerCue": 6,
                     "averageDurationSec": 1.8, "usesHighlight": True, "preferredStyleId": "bold"},
        "visual": {"changesPerMinute": round((len(scenes) / max(0.1, duration / 60)) * 1.5, 1),
                   "averageIntervalSec": 4, "maxDeadIntervalSec": 8},
        "pacing": {"averageWordsPerMinute": 160, "averageSentenceDurationSec": 5, "shape": "balanced"},
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", type=Path, help="Path to reference MP4")
    ap.add_argument("output", type=Path, nargs="?", help="Output JSON path")
    args = ap.parse_args()
    if not args.input.exists():
        print(f"Not found: {args.input}", file=sys.stderr)
        sys.exit(2)
    profile = build_reference_profile(args.input)
    out_path = args.output or args.input.with_suffix(".profile.json")
    out_path.write_text(json.dumps(profile, indent=2, ensure_ascii=False))
    print(f"Wrote {out_path}")
    print(json.dumps(profile, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
