"""Inventory the supplied identity package and render every PDF page for review."""
from pathlib import Path
import hashlib
import json
import pymupdf
from PIL import Image, ImageDraw
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'Pro Vision Idenitiy_Folder'
OUT = ROOT / 'brand-identity'
OUT.mkdir(exist_ok=True)
(OUT / 'review').mkdir(exist_ok=True)
inventory = []
for path in sorted(SOURCE.rglob('*')):
    if not path.is_file():
        continue
    digest = hashlib.file_digest(path.open('rb'), 'sha256').hexdigest()
    entry = {'path': path.relative_to(ROOT).as_posix(), 'bytes': path.stat().st_size, 'sha256': digest}
    if path.suffix.lower() in ('.ttf', '.otf'):
        font = TTFont(path)
        entry['font_names'] = {str(key): font['name'].getDebugName(key) for key in (1, 2, 6, 13, 14)}
        font.close()
    if path.suffix.lower() == '.jpg':
        with Image.open(path) as picture:
            entry['dimensions'] = picture.size
            picture.thumbnail((640, 420))
            picture.save(OUT / 'review' / (path.stem + '.png'))
    inventory.append(entry)
document = pymupdf.open(SOURCE / 'Pro Vision Idenitiy.pdf')
pages = []
for number, page in enumerate(document, 1):
    pix = page.get_pixmap(matrix=pymupdf.Matrix(.5, .5))
    pix.save(OUT / 'review' / f'page-{number:02}.png')
    pages.append({'page': number, 'size': list(page.rect), 'text': page.get_text(),
                  'vector_paths': len(page.get_drawings()), 'images': len(page.get_images())})
for start in range(0, len(pages), 6):
    sheet = Image.new('RGB', (960, 3 * 295), '#dddddd')
    draw = ImageDraw.Draw(sheet)
    for slot, page in enumerate(pages[start:start + 6]):
        picture = Image.open(OUT / 'review' / f"page-{page['page']:02}.png")
        picture.thumbnail((480, 270))
        x, y = slot % 2 * 480, slot // 2 * 295
        sheet.paste(picture, (x, y + 23))
        draw.text((x + 10, y + 5), f"Page {page['page']}", fill='black')
    sheet.save(OUT / 'review' / f'contact-{start // 6 + 1}.png')
(OUT / 'inventory.json').write_text(json.dumps({'files': inventory, 'pages': pages}, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps([{'page': p['page'], 'paths': p['vector_paths'], 'text': p['text'][:1300]} for p in pages], ensure_ascii=True))
