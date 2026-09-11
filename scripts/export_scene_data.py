"""
Export cord sheath + placenta surfaces (geometry/*.stl) and UV/UA
centrelines (geometry/*.npy) as base64-encoded arrays for the
self-contained three.js viewer (viewer/index.html).
"""
import struct
import base64
import json
import os
import numpy as np
from ga_growth_model import uv_diameter_mm, ua_diameter_mm

HERE = os.path.dirname(os.path.abspath(__file__))
GEOM = os.path.join(HERE, "..", "geometry")
VIEWER = os.path.join(HERE, "..", "viewer")
TARGET_GA = 34.0


def read_binary_stl_tris(path):
    data = open(path, "rb").read()
    n = struct.unpack_from("<I", data, 80)[0]
    tris = np.empty((n, 3, 3), dtype=np.float32)
    off = 84
    for i in range(n):
        off += 12
        tris[i] = np.array(struct.unpack_from("<9f", data, off)).reshape(3, 3)
        off += 38
    return tris


def stl_to_positions_normals(tris):
    positions = tris.reshape(-1, 3)
    normals = np.empty_like(positions)
    for i in range(len(tris)):
        a, b, c = tris[i]
        nrm = np.cross(b - a, c - a)
        norm = np.linalg.norm(nrm)
        nrm = nrm / norm if norm > 1e-12 else np.array([0, 0, 1], dtype=np.float32)
        normals[i * 3:i * 3 + 3] = nrm
    return positions.astype(np.float32), normals.astype(np.float32)


def b64(arr):
    return base64.b64encode(np.asarray(arr, dtype=np.float32).tobytes()).decode("ascii")


if __name__ == "__main__":
    cord_tris = read_binary_stl_tris(os.path.join(GEOM, "cord_sheath.stl"))
    cord_pos, cord_norm = stl_to_positions_normals(cord_tris)

    placenta_tris = read_binary_stl_tris(os.path.join(GEOM, "placenta.stl"))
    placenta_pos, placenta_norm = stl_to_positions_normals(placenta_tris)

    uv = np.load(os.path.join(GEOM, "uv_centerline.npy")).astype(np.float32)
    ua1 = np.load(os.path.join(GEOM, "ua1_path.npy")).astype(np.float32)
    ua2 = np.load(os.path.join(GEOM, "ua2_path.npy")).astype(np.float32)

    uv_arc = np.linalg.norm(np.diff(uv, axis=0), axis=1).sum()
    ua1_arc = np.linalg.norm(np.diff(ua1, axis=0), axis=1).sum()
    straight = np.linalg.norm(uv[0] - uv[-1])
    print(f"UV arc length: {uv_arc:.1f}mm, UA1 arc length: {ua1_arc:.1f}mm, "
          f"UV straight-line: {straight:.1f}mm")

    data = {
        "cord_pos_b64": b64(cord_pos.ravel()), "cord_norm_b64": b64(cord_norm.ravel()), "cord_n": len(cord_pos),
        "placenta_pos_b64": b64(placenta_pos.ravel()), "placenta_norm_b64": b64(placenta_norm.ravel()), "placenta_n": len(placenta_pos),
        "uv_pos_b64": b64(uv.ravel()), "uv_n": len(uv),
        "ua1_pos_b64": b64(ua1.ravel()), "ua1_n": len(ua1),
        "ua2_pos_b64": b64(ua2.ravel()), "ua2_n": len(ua2),
        "meta": {"uv_arc_mm": float(uv_arc), "ua1_arc_mm": float(ua1_arc), "uv_straight_mm": float(straight),
                 "uv_radius_mm": uv_diameter_mm(TARGET_GA) / 2, "ua_radius_mm": ua_diameter_mm(TARGET_GA) / 2,
                 "target_ga": TARGET_GA},
    }
    out_path = os.path.join(VIEWER, "scene_data.js")
    with open(out_path, "w") as f:
        f.write("window.SCENE_DATA = ")
        json.dump(data, f)
        f.write(";\n")
    print("wrote", out_path, os.path.getsize(out_path), "bytes")
