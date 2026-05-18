"""
Generates icon-180.png and icon-512.png for the Hardin Trips PWA.

Globe uses an orthographic projection (Atlantic-centered) so both
the Americas and Europe/Africa are visible, drawn with Natural Earth
110m land polygon data fetched from GitHub.
"""

import json
import math
import urllib.request
from PIL import Image, ImageDraw, ImageChops

TERRACOTTA  = (192, 106,  61)   # #c06a3d
CREAM       = (250, 248, 244)   # #faf8f4
LAND_FILL   = (222, 185, 160)   # warm sand — continent fill
LAND_OUTLINE= (155,  80,  38)   # darker terracotta — continent border
GLOBE_EDGE  = (155,  80,  38)   # pin-head circle border

# Orthographic projection centre
CENTER_LAT_DEG =  15.0
CENTER_LON_DEG = -30.0   # Atlantic view: Americas + Europe/Africa both visible


def fetch_land_geojson():
    url = (
        "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
        "master/geojson/ne_110m_land.geojson"
    )
    with urllib.request.urlopen(url, timeout=15) as r:
        return json.loads(r.read().decode())


def orthographic_project(lon_deg, lat_deg, clat, clon):
    """Returns (x, y) in [-1, 1] or None if on the far side of the globe."""
    lat  = math.radians(lat_deg)
    lon  = math.radians(lon_deg)
    cos_c = (math.sin(clat) * math.sin(lat) +
             math.cos(clat) * math.cos(lat) * math.cos(lon - clon))
    if cos_c < 0:
        return None
    x =  math.cos(lat) * math.sin(lon - clon)
    y =  math.sin(lat) * math.cos(clat) - math.cos(lat) * math.sin(clat) * math.cos(lon - clon)
    return (x, -y)   # flip y so north is up


def project_ring(ring, clat, clon, cx, cy, r):
    """Convert a GeoJSON coordinate ring to pixel coords, splitting on horizon crossings."""
    segments = []
    current  = []
    for lon_deg, lat_deg in ring:
        pt = orthographic_project(lon_deg, lat_deg, clat, clon)
        if pt is None:
            if current:
                segments.append(current)
                current = []
        else:
            px = cx + pt[0] * r
            py = cy + pt[1] * r
            current.append((px, py))
    if current:
        segments.append(current)
    return segments


def draw_land(draw, features, clat, clon, cx, cy, r, line_w):
    for feat in features:
        geom = feat["geometry"]
        if geom is None:
            continue
        gtype = geom["type"]
        polys = (geom["coordinates"] if gtype == "MultiPolygon"
                 else [geom["coordinates"]])
        for poly in polys:
            for ring in poly:
                coords = ring if gtype == "MultiPolygon" else ring
                segs = project_ring(coords, clat, clon, cx, cy, r)
                for seg in segs:
                    if len(seg) >= 3:
                        draw.polygon(seg, fill=LAND_FILL, outline=None)
    # second pass for outlines so they sit on top of fills
    for feat in features:
        geom = feat["geometry"]
        if geom is None:
            continue
        gtype = geom["type"]
        polys = (geom["coordinates"] if gtype == "MultiPolygon"
                 else [geom["coordinates"]])
        for poly in polys:
            for ring in poly:
                segs = project_ring(ring if gtype == "MultiPolygon" else ring,
                                    clat, clon, cx, cy, r)
                for seg in segs:
                    if len(seg) >= 2:
                        draw.line(seg, fill=LAND_OUTLINE, width=line_w)


def draw_icon(size, features):
    img  = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded background
    draw.rounded_rectangle([0, 0, size - 1, size - 1],
                           radius=size // 5, fill=TERRACOTTA)

    # Pin geometry
    cx          = size / 2
    pin_r       = size * 0.28       # pin-head radius
    pin_cy      = size * 0.385      # pin-head centre y
    pin_tip_y   = size * 0.775      # tip of pin

    # Pin body
    body_hw = pin_r * 0.72
    draw.polygon(
        [(cx - body_hw, pin_cy + pin_r * 0.55),
         (cx + body_hw, pin_cy + pin_r * 0.55),
         (cx, pin_tip_y)],
        fill=CREAM,
    )

    # Pin head background (cream circle)
    draw.ellipse([cx - pin_r, pin_cy - pin_r, cx + pin_r, pin_cy + pin_r],
                 fill=CREAM)

    # --- Globe inside the pin head ---
    globe_r  = pin_r - max(2, int(size * 0.012))   # slight inset
    line_w   = max(1, int(size * 0.016))

    # Mask: circle inside the pin head
    globe_mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(globe_mask).ellipse(
        [cx - globe_r, pin_cy - globe_r, cx + globe_r, pin_cy + globe_r],
        fill=255,
    )

    # Ocean fill layer (terracotta-tinted cream so it reads as water)
    ocean_col = (210, 165, 130)
    globe_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(globe_layer).ellipse(
        [cx - globe_r, pin_cy - globe_r, cx + globe_r, pin_cy + globe_r],
        fill=ocean_col,
    )
    img.alpha_composite(globe_layer)

    # Land layer
    clat = math.radians(CENTER_LAT_DEG)
    clon = math.radians(CENTER_LON_DEG)

    land_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_land(ImageDraw.Draw(land_layer), features, clat, clon,
              cx, pin_cy, globe_r, line_w)

    # Clip land to globe circle
    land_alpha = land_layer.split()[3]
    land_layer.putalpha(ImageChops.multiply(land_alpha, globe_mask))
    img.alpha_composite(land_layer)

    # Globe circle border
    border_w = max(1, int(size * 0.018))
    ImageDraw.Draw(img).ellipse(
        [cx - globe_r, pin_cy - globe_r, cx + globe_r, pin_cy + globe_r],
        outline=GLOBE_EDGE, width=border_w,
    )

    return img


if __name__ == "__main__":
    print("Fetching Natural Earth 110m land data…")
    geo = fetch_land_geojson()
    features = geo["features"]
    print(f"  {len(features)} land features loaded")

    for size, name in [(180, "icon-180.png"), (512, "icon-512.png")]:
        icon = draw_icon(size, features)
        icon.save(f"/home/user/Trips/{name}", "PNG")
        print(f"Saved {name} ({size}×{size})")
