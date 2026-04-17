#!/usr/bin/env python3
"""
compute-sister-works.py — Wire sister artworks across Attesté certificates.

For each cert JSON in a target directory:
  1. Build a "semantic blob" from title + artist + medium + year + context paragraph
  2. Embed the blob via Ollama nomic-embed-text (defaults to Mini over LAN)
  3. Compute pairwise cosine similarities across all certs
  4. Write the top-N nearest cert hashes back into each JSON as sister_artwork_hashes

Usage:
    python3 scripts/compute-sister-works.py scripts/demo-certs/
    python3 scripts/compute-sister-works.py scripts/demo-certs/ --top 6
    python3 scripts/compute-sister-works.py scripts/demo-certs/ --host localhost:11434

Python 3.8+ stdlib only.
"""

import argparse
import glob
import hashlib
import json
import math
import os
import sys
import urllib.request
from pathlib import Path


def canonical_json(data: dict) -> bytes:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def compute_hash(data: dict) -> str:
    return hashlib.sha256(canonical_json(data)).hexdigest()


def short_hash(full_hash: str) -> str:
    return full_hash[:16]


def semantic_blob(cert: dict) -> str:
    """Build the text that represents this cert for semantic embedding."""
    art = cert.get("artwork", {})
    artist = art.get("artist", {})
    if isinstance(artist, dict):
        artist_name = artist.get("name", "")
    else:
        artist_name = str(artist)

    parts = [
        art.get("title", ""),
        f"by {artist_name}" if artist_name else "",
        f"{art.get('year', '')}" if art.get("year") else "",
        art.get("medium", ""),
        art.get("surface", ""),
        cert.get("context", {}).get("paragraph", ""),
    ]
    # Provenance sources (galleries, estates, auctions) are strong sister signals
    for step in cert.get("provenance", []):
        if step.get("source"):
            parts.append(step["source"])
        if step.get("notes"):
            parts.append(step["notes"])

    return " · ".join(p.strip() for p in parts if p)


def embed(text: str, host: str, model: str = "nomic-embed-text", timeout: int = 120) -> list:
    """Call Ollama /api/embed, return the embedding vector."""
    url = f"http://{host}/api/embed"
    payload = json.dumps({"model": model, "input": text}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read())
    return data["embeddings"][0]


def cosine(a, b) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb + 1e-10)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cert_dir", help="Directory containing cert JSON files")
    ap.add_argument("--top", type=int, default=6, help="Number of sister works per cert")
    ap.add_argument("--host", default=os.environ.get("OLLAMA_HOST", "Charls-Mac-mini.local:11434"),
                    help="Ollama host (default: Mini, fallback: OLLAMA_HOST env)")
    ap.add_argument("--model", default="nomic-embed-text")
    args = ap.parse_args()

    cert_dir = Path(args.cert_dir)
    if not cert_dir.is_dir():
        print(f"ERROR: {cert_dir} is not a directory")
        sys.exit(1)

    json_files = sorted(cert_dir.glob("*.json"))
    if len(json_files) < 2:
        print(f"Need at least 2 certs to compute sister works (found {len(json_files)})")
        sys.exit(1)

    print(f"Loading {len(json_files)} cert files from {cert_dir}")

    # Verify Ollama is reachable before doing any work
    try:
        urllib.request.urlopen(f"http://{args.host}/api/tags", timeout=5)
    except Exception as e:
        print(f"ERROR: Ollama not reachable at {args.host}: {e}")
        print(f"  Fallback: try --host localhost:11434")
        sys.exit(1)

    # Load every cert + compute its hash + embed its semantic blob
    certs = []  # list of (path, cert_dict, hash, embedding)
    for jf in json_files:
        try:
            cert = json.loads(jf.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"  SKIP {jf.name}: failed to parse ({e})")
            continue

        # Compute hash with any existing hash_full zeroed, so the match is deterministic
        cert_for_hash = dict(cert)
        cert_for_hash["hash_full"] = ""
        full_h = compute_hash(cert_for_hash)

        blob = semantic_blob(cert)
        if len(blob) < 20:
            print(f"  SKIP {jf.name}: semantic blob too short")
            continue

        print(f"  embedding {jf.name} ({len(blob)} chars)...")
        try:
            vec = embed(blob, args.host, args.model)
        except Exception as e:
            print(f"  ERROR {jf.name}: embed failed ({e})")
            continue

        certs.append((jf, cert, full_h, vec))

    print(f"Embedded {len(certs)} certs. Computing pairwise similarities...")

    # For each cert, find top-N neighbors (excluding self), write back
    written = 0
    for i, (jf_i, cert_i, hash_i, vec_i) in enumerate(certs):
        scored = []
        for j, (jf_j, cert_j, hash_j, vec_j) in enumerate(certs):
            if i == j:
                continue
            sim = cosine(vec_i, vec_j)
            scored.append((sim, short_hash(hash_j), hash_j, cert_j))

        scored.sort(reverse=True, key=lambda x: x[0])
        top = scored[: args.top]

        sister_hashes = [short_hash_j for (_, short_hash_j, _, _) in top]
        cert_i["sister_artwork_hashes"] = sister_hashes

        # Also write a denormalized summary so the renderer doesn't have to
        # cross-reference JSONs to find title/artist/image for rendering
        cert_i["sister_artworks"] = [
            {
                "hash": short_hash_j,
                "similarity": round(sim, 4),
                "title": full_cert_j.get("artwork", {}).get("title", ""),
                "artist": (full_cert_j.get("artwork", {}).get("artist", {}) or {}).get("name", "")
                          if isinstance(full_cert_j.get("artwork", {}).get("artist"), dict)
                          else str(full_cert_j.get("artwork", {}).get("artist", "")),
                "year": full_cert_j.get("artwork", {}).get("year", ""),
                "medium": full_cert_j.get("artwork", {}).get("medium", ""),
                "image_url": full_cert_j.get("artwork", {}).get("image_url", ""),
                "url": f"/cert/{short_hash_j}.html",
            }
            for (sim, short_hash_j, _full_hash_j, full_cert_j) in top
        ]

        jf_i.write_text(json.dumps(cert_i, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"  wrote {len(sister_hashes)} sister hashes into {jf_i.name}")
        written += 1

    print(f"\nDone. Updated {written} cert JSONs with sister-works data.")
    print(f"Next: rerun the generator on each cert to rebuild HTML pages with sister cards.")


if __name__ == "__main__":
    main()
