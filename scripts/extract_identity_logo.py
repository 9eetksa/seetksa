"""Extract original PDF curves and gradient artwork, without tracing or redrawing."""
from pathlib import Path
import base64
import copy
import json
import xml.etree.ElementTree as ET
import pymupdf
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'Pro Vision Idenitiy_Folder'
OUT = ROOT / 'brand-identity'
PUBLIC = ROOT / 'public/brand'
NS = 'http://www.w3.org/2000/svg'
XLINK = 'http://www.w3.org/1999/xlink'
ET.register_namespace('', NS)
ET.register_namespace('xlink', XLINK)
document = pymupdf.open(SOURCE / 'Pro Vision Idenitiy.pdf')
page = document[5]
drawings = page.get_drawings()
clips = [p for p in page.get_drawings(extended=True) if p['type'] == 'clip'
         and 1050 < p['scissor'].x0 < 1310 and 400 < p['scissor'].y0 < 650]

def segments(path):
    contours, current, previous = [], [], None
    for item in path['items']:
        kind, *points = item
        assert kind in ('l', 'c'), f'Unexpected PDF primitive: {kind}'
        points = [list(point) for point in points]
        if previous is not None and sum(abs(a-b) for a,b in zip(points[0], previous)) > .01:
            contours.append(current)
            current = []
        current.append({'kind': kind, 'points': points})
        previous = points[-1]
    if current:
        contours.append(current)
    return contours

def svg_path(contours):
    result = []
    for contour in contours:
        result.append('M ' + ' '.join(map(str, contour[0]['points'][0])))
        for segment in contour:
            result.append(segment['kind'].upper() + ' ' + ' '.join(str(v) for p in segment['points'][1:] for v in p))
        result.append('Z')
    return ' '.join(result)

shapes = [{'name': f'Lettering_{i+1:02}' if i < 9 else 'Emblem_outline',
           'contours': segments(path), 'fill': path['fill']} for i, path in enumerate(drawings)]
shapes += [{'name': f'Emblem_ribbon_{i+1}', 'contours': segments(path)} for i, path in enumerate(clips)]
assert len(shapes) == 13
(OUT / 'logo-curves.json').write_text(json.dumps({'source_page': 6, 'bounds': [610.050903, 427.174927, 1310.990723, 652.824951], 'shapes': shapes}, indent=2))

# PDF gradient fills are raster shadings clipped by original vector ribbon paths.
# Preserve those exact fills, including in the SVG; no substitute gradients.
svg = ET.fromstring(page.get_svg_image())
images = [copy.deepcopy(n) for n in svg.iter(f'{{{NS}}}image') if n.get('x')]
assert len(images) == 3
for i, node in enumerate(images):
    data = base64.b64decode(node.get(f'{{{XLINK}}}href').split(',', 1)[1])
    (OUT / f'ribbon-{i+1}.png').write_bytes(data)
    shapes[10+i]['texture'] = {'file': f'ribbon-{i+1}.png', 'x': float(node.get('x')), 'y': float(node.get('y')),
                              'width': float(node.get('width')), 'height': float(node.get('height'))}
(OUT / 'logo-curves.json').write_text(json.dumps({'source_page': 6, 'bounds': [610.050903, 427.174927, 1310.990723, 652.824951], 'shapes': shapes}, indent=2))

for variant, color in [('original', '#004139'), ('light', '#ffffff')]:
    root = ET.Element(f'{{{NS}}}svg', {'viewBox': '600 417 722 246', 'width': '1444', 'height': '492'})
    defs = ET.SubElement(root, f'{{{NS}}}defs')
    for shape in shapes[:10]:
        ET.SubElement(root, f'{{{NS}}}path', {'d': svg_path(shape['contours']), 'fill': color, 'fill-rule': 'nonzero'})
    for i, (shape, img) in enumerate(zip(shapes[10:], images)):
        clip = ET.SubElement(defs, f'{{{NS}}}clipPath', {'id': f'ribbon-{i}'})
        ET.SubElement(clip, f'{{{NS}}}path', {'d': svg_path(shape['contours'])})
        group = ET.SubElement(root, f'{{{NS}}}g', {'clip-path': f'url(#ribbon-{i})'})
        group.append(copy.deepcopy(img))
    data = ET.tostring(root, encoding='utf-8', xml_declaration=True)
    (OUT / f'provision-logo-{variant}.svg').write_bytes(data)
    (PUBLIC / f'provision-logo-{variant}.svg').write_bytes(data)
    if variant == 'original':
        page.get_pixmap(clip=pymupdf.Rect(600, 417, 1322, 663), matrix=pymupdf.Matrix(2, 2), alpha=True).save(OUT / 'provision-logo-original.png')

fonts = ROOT / 'public/fonts'
fonts.mkdir(exist_ok=True)
for path in (SOURCE / 'Fonts').glob('IBMPlex*'):
    font = TTFont(path)
    font.flavor = 'woff2'
    font.save(fonts / (path.stem + '.woff2'))
    font.close()
print('Extracted 13 original shapes, 3 original gradient textures, 2 logo variants, 5 IBM font weights.')
