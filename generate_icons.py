from PIL import Image, ImageDraw, ImageChops

TERRACOTTA = (192, 106, 61)   # #c06a3d
CREAM = (250, 248, 244)        # #faf8f4
GLOBE_LINE = (155, 80, 38)    # slightly darker terracotta for globe lines


def draw_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded square background
    radius = size // 5
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=TERRACOTTA)

    # Pin geometry — center slightly above middle
    cx = size / 2
    pin_head_r = size * 0.28
    pin_head_cy = size * 0.38
    pin_tip_y = size * 0.76

    # Pin head (filled circle)
    draw.ellipse(
        [cx - pin_head_r, pin_head_cy - pin_head_r,
         cx + pin_head_r, pin_head_cy + pin_head_r],
        fill=CREAM,
    )

    # Pin body (triangle to point)
    body_top_half = pin_head_r * 0.75
    draw.polygon(
        [(cx - body_top_half, pin_head_cy + pin_head_r * 0.5),
         (cx + body_top_half, pin_head_cy + pin_head_r * 0.5),
         (cx, pin_tip_y)],
        fill=CREAM,
    )

    # Globe lines — drawn on a separate layer then clipped to the pin head circle
    line_w = max(1, int(size * 0.020))
    pad = line_w

    inner_mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(inner_mask).ellipse(
        [cx - pin_head_r + pad, pin_head_cy - pin_head_r + pad,
         cx + pin_head_r - pad, pin_head_cy + pin_head_r - pad],
        fill=255,
    )

    globe_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(globe_layer)

    # Equator
    gd.line(
        [(cx - pin_head_r + pad, pin_head_cy),
         (cx + pin_head_r - pad, pin_head_cy)],
        fill=GLOBE_LINE, width=line_w,
    )

    # Meridian ellipse
    meridian_rx = pin_head_r * 0.45
    gd.ellipse(
        [cx - meridian_rx, pin_head_cy - pin_head_r + pad,
         cx + meridian_rx, pin_head_cy + pin_head_r - pad],
        outline=GLOBE_LINE, width=line_w,
    )

    # Clip to pin head circle: multiply globe alpha by inner_mask, then composite
    globe_alpha = globe_layer.split()[3]
    clipped_alpha = ImageChops.multiply(globe_alpha, inner_mask)
    globe_layer.putalpha(clipped_alpha)
    img.alpha_composite(globe_layer)

    return img


for size, name in [(180, "icon-180.png"), (512, "icon-512.png")]:
    draw_icon(size).save(f"/home/user/Trips/{name}", "PNG")
    print(f"Saved {name}")
