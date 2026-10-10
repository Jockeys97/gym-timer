"""Genera icone opache con forme, senza font, e margini maskable sicuri."""
from pathlib import Path
from PIL import Image, ImageDraw


def make_icon(size, destination):
    scale = 4
    canvas = size * scale
    image = Image.new("RGB", (canvas, canvas), "#0b0f14")
    draw = ImageDraw.Draw(image)

    def box(coords):
        return tuple(round(value * canvas) for value in coords)

    accent = "#d4ff48"
    # Tutte le forme rientrano nel cerchio sicuro centrale (80% del lato).
    draw.rounded_rectangle(box((.435, .17, .565, .23)), radius=round(canvas * .018), fill=accent)
    draw.rectangle(box((.478, .22, .522, .275)), fill=accent)
    draw.line(box((.692, .31, .737, .265)), fill=accent, width=round(canvas * .042))
    draw.ellipse(box((.235, .265, .765, .795)), outline=accent, width=round(canvas * .05))
    draw.line(box((.5, .53, .5, .36)), fill=accent, width=round(canvas * .032))
    draw.line(box((.5, .53, .61, .59)), fill=accent, width=round(canvas * .032))
    draw.ellipse(box((.47, .50, .53, .56)), fill=accent)
    image.resize((size, size), Image.Resampling.LANCZOS).save(destination)


if __name__ == "__main__":
    icons = Path(__file__).resolve().parent.parent / "icons"
    icons.mkdir(exist_ok=True)
    for size, filename in [(192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png")]:
        make_icon(size, icons / filename)
        print(f"Generata {filename}: {size}×{size}")
