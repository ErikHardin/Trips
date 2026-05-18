from PIL import Image, ImageDraw
import math

TERRACOTTA = (192, 106, 61)   # #c06a3d
CREAM = (250, 248, 244)        # #faf8f4
GLOBE_LINE = (160, 85, 45)    # slightly darker terracotta for globe lines


def draw_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded square background
    radius = size // 5
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=TERRACOTTA)

    # Pin geometry — center slightly above middle
    cx = size / 2
    pin_head_r = size * 0.28        # radius of the circular pin head
    pin_head_cy = size * 0.38       # center y of pin head
    pin_tip_y = size * 0.76         # y coordinate of pin point

    # Draw pin head (filled circle)
    draw.ellipse(
        [cx - pin_head_r, pin_head_cy - pin_head_r,
         cx + pin_head_r, pin_head_cy + pin_head_r],
        fill=CREAM,
    )

    # Draw pin body as a polygon (trapezoid narrowing to a point)
    body_top_half = pin_head_r * 0.75  # half-width where body meets circle
    body_pts = [
        (cx - body_top_half, pin_head_cy + pin_head_r * 0.5),
        (cx + body_top_half, pin_head_cy + pin_head_r * 0.5),
        (cx, pin_tip_y),
    ]
    draw.polygon(body_pts, fill=CREAM)

    # Globe lines inside the pin head
    line_w = max(1, int(size * 0.018))
    bbox = [
        cx - pin_head_r + line_w,
        pin_head_cy - pin_head_r + line_w,
        cx + pin_head_r - line_w,
        pin_head_cy + pin_head_r - line_w,
    ]

    # Vertical arc (meridian) — full ellipse but clipped to pin head
    inner_mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(inner_mask)
    mask_draw.ellipse(
        [cx - pin_head_r + line_w, pin_head_cy - pin_head_r + line_w,
         cx + pin_head_r - line_w, pin_head_cy + pin_head_r - line_w],
        fill=255,
    )

    globe_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(globe_layer)

    # Horizontal equator line
    gd.line(
        [(cx - pin_head_r + line_w, pin_head_cy),
         (cx + pin_head_r - line_w, pin_head_cy)],
        fill=GLOBE_LINE, width=line_w,
    )

    # Vertical meridian ellipse (narrower than the circle to look 3-D)
    meridian_rx = pin_head_r * 0.45
    gd.ellipse(
        [cx - meridian_rx, pin_head_cy - pin_head_r + line_w,
         cx + meridian_rx, pin_head_cy + pin_head_r - line_w],
        outline=GLOBE_LINE, width=line_w,
    )

    # Composite globe lines only inside the pin head circle
    img.paste(globe_layer, mask=inner_mask)

    return img


for size, name in [(180, "icon-180.png"), (512, "icon-512.png")]:
    icon = draw_icon(size)
    icon.save(f"/home/user/Trips/{name}", "PNG")
    print(f"Saved {name}")
