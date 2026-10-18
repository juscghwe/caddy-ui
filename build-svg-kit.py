#!/usr/bin/env python3
"""Build the requested editable vector studies; requires fontTools."""
from copy import deepcopy
from pathlib import Path
import hashlib
import json
import xml.etree.ElementTree as ET
from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen

ROOT = Path(__file__).resolve().parent
NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NS)
MINT, DARK, MUTED, WHITE = '#00E5A0', '#14161C', '#788397', '#E0E5EE'
FONTS = {weight: TTFont(ROOT / 'fonts' / f'IBMPlexMono-{name}.ttf') for weight, name in [(300, 'Light'), (600, 'SemiBold'), (700, 'Bold')]}

def node(tag, attrs=None, parent=None, text=None):
    el = ET.Element(f'{{{NS}}}{tag}', {str(k): str(v) for k, v in (attrs or {}).items()})
    if text is not None:
        el.text = text
    if parent is not None:
        parent.append(el)
    return el

def bounds_union(bounds):
    return min(b[0] for b in bounds), min(b[1] for b in bounds), max(b[2] for b in bounds), max(b[3] for b in bounds)

def make_run(parts, ident, live=False, color=MINT):
    group = node('g', {'id': ident, 'fill': color})
    node('title', parent=group, text=''.join(text for text, _ in parts))
    cursor = 0
    boxes = []
    sequence = 0
    for text, weight in parts:
        font = FONTS[weight]
        upm = font['head'].unitsPerEm
        glyphs = font.getGlyphSet()
        cmap = font.getBestCmap()
        run_start = cursor
        for char in text:
            name = cmap[ord(char)]
            glyph = glyphs[name]
            pen = BoundsPen(glyphs)
            glyph.draw(pen)
            if pen.bounds:
                x1, y1, x2, y2 = pen.bounds
                boxes.append((cursor+x1/upm, -y2/upm, cursor+x2/upm, -y1/upm))
                if not live:
                    pathpen = SVGPathPen(glyphs)
                    glyph.draw(pathpen)
                    letter = node('g', {'id': f'{ident}-glyph-{sequence}-{char if char.isalpha() else "slash"}', 'transform': f'translate({cursor:.6f} 0) scale({1/upm:.6f} {-1/upm:.6f})'}, group)
                    node('path', {'d': pathpen.getCommands()}, letter)
            cursor += font['hmtx'][name][0]/upm
            sequence += 1
        if live:
            node('text', {'id': f'{ident}-weight-{weight}', 'x': run_start, 'y': 0, 'font-family': 'IBM Plex Mono', 'font-size': 1, 'font-weight': weight, 'font-kerning': 'none', 'style': 'font-variant-ligatures:none'}, group, text)
    return group, bounds_union(boxes), cursor

def fitted(group, bounds, box, ident):
    x1, y1, x2, y2 = bounds
    x, y, w, h = box
    scale = min(w/(x2-x1), h/(y2-y1))
    dx = x+(w-(x2-x1)*scale)/2-x1*scale
    dy = y+(h-(y2-y1)*scale)/2-y1*scale
    outer = node('g', {'id': ident, 'transform': f'translate({dx:.6f} {dy:.6f}) scale({scale:.6f})'})
    outer.append(group)
    return outer

def fit_text(parts, box, ident, live=False, color=MINT):
    group, bounds, _ = make_run(parts, ident+'-letters', live, color)
    return fitted(group, bounds, box, ident)

def document(name, width, height, description, background=False):
    root = node('svg', {'width': width, 'height': height, 'viewBox': f'0 0 {width} {height}', 'role': 'img', 'aria-labelledby': name+'-title '+name+'-desc'})
    node('title', {'id': name+'-title'}, root, name)
    node('desc', {'id': name+'-desc'}, root, description)
    if background:
        node('rect', {'id': name+'-background', 'width': width, 'height': height, 'fill': DARK}, root)
    return root

def rect(parent, ident, x, y, w, h, color=MINT):
    return node('rect', {'id': ident, 'x': x, 'y': y, 'width': w, 'height': h, 'fill': color}, parent)

def write(path, root):
    path.parent.mkdir(parents=True, exist_ok=True)
    ET.indent(root, space='  ')
    ET.ElementTree(root).write(path, encoding='utf-8', xml_declaration=True)

def wordmark02(live=False):
    group, bounds, advance = make_run([('caddy/ui', 300)], 'wordmark02-type', live)
    x = advance+0.11
    rect(group, 'wordmark02-block-cursor', x, -0.72, 0.35, 0.72)
    bounds = bounds_union([bounds, (x, -0.72, x+0.35, 0)])
    root = document('02-cursor-finish', 800, 164, 'Light IBM Plex Mono lettering and separate block cursor. Transparent background. Clean vector reconstruction of the design study.')
    root.append(fitted(group, bounds, (16, 16, 768, 132), 'wordmark02'))
    return root

def wordmark06(live=False):
    root = document('06-weight-shift', 800, 164, 'IBM Plex Mono Light caddy and Bold /ui. Transparent background. Each outlined glyph can be edited independently.')
    root.append(fit_text([('caddy', 300), ('/ui', 700)], (16, 16, 768, 132), 'wordmark06', live))
    return root

GEOMETRIC = {
    'c': 'M12 18H44V26H16L10 32V46L16 52H44V60H12L2 50V28Z',
    'a': 'M10 18H38L48 28V60H10L0 50V39L10 29H40V28L36 26H10Z M13 38L8 43V47L13 52H40V38Z',
    'd': 'M40 0H48V60H12L2 50V28L12 18H40Z M16 26L10 32V46L16 52H40V26Z',
    'y': 'M2 18H10V42L15 47H40V18H48V68L38 78H14V70H34L40 64V55H12L2 45Z',
    '/': 'M0 70L27 -2H37L10 70Z',
    'u': 'M2 18H10V46L16 52H34L40 46V18H48V50L38 60H12L2 50Z',
    'i': 'M20 0H30V10H20Z M12 18H30V52H42V60H8V52H22V26H12Z',
}

def wordmark07():
    root = document('07-bracket-baseline', 800, 164, 'Custom geometric lowercase lettering with separate lower corner marks. All artwork consists of editable paths. This is not a stock font.')
    group = node('g', {'id': 'wordmark07', 'fill': MINT}, root)
    letters = node('g', {'id': 'wordmark07-letters', 'transform': 'translate(58 16) scale(1.55)'}, group)
    cursor = 0
    for i, char in enumerate('caddy/ui'):
        letter = node('g', {'id': f'wordmark07-glyph-{i}-{char if char.isalpha() else "slash"}', 'transform': f'translate({cursor} 0)'}, letters)
        node('path', {'d': GEOMETRIC[char], 'fill-rule': 'evenodd'}, letter)
        cursor += 47 if char=='/' else 55
    frame = node('g', {'id': 'wordmark07-baseline-corners'}, group)
    node('path', {'id': 'wordmark07-left-corner', 'd': 'M20 113H28V139H56V147H20Z'}, frame)
    node('path', {'id': 'wordmark07-right-corner', 'd': 'M736 113H744V147H708V139H736Z'}, frame)
    return root

ICON_NAMES = {
    '2a': 'c-plus-cursor', '2b': 'slash-cursor', '2c': 'ui-plus-cursor', '2d': 'underscore-c',
    '6a': 'light-c-bold-u', '6b': 'bold-slash-ui', '6c': 'stacked-c-slash-ui',
}

def favicon(key, live=False):
    name = key+'-'+ICON_NAMES[key]
    root = document(name, 64, 64, 'Editable favicon study. Background, lettering and cursor are separate objects. 64-unit SVG viewBox; inspect at actual 16 and 32 px before production use.', True)
    art = node('g', {'id': name+'-artwork', 'fill': MINT}, root)
    if key=='2a':
        art.append(fit_text([('c',300)], (8, 17, 27, 31), name+'-type', live))
        rect(art, name+'-cursor', 42, 12, 12, 40)
    elif key=='2b':
        art.append(fit_text([('/',300)], (10, 9, 25, 46), name+'-type', live))
        rect(art, name+'-cursor', 42, 17, 12, 35)
    elif key=='2c':
        art.append(fit_text([('ui',300)], (5, 12, 37, 40), name+'-type', live))
        rect(art, name+'-cursor', 47, 17, 10, 35)
    elif key=='2d':
        art.append(fit_text([('c',300)], (8, 14, 29, 32), name+'-type', live))
        rect(art, name+'-underscore', 39, 45, 17, 6)
    elif key=='6a':
        art.append(fit_text([('c',300),('u',700)], (6, 16, 52, 34), name+'-type', live))
    elif key=='6b':
        art.append(fit_text([('/',700)], (7, 12, 14, 41), name+'-slash', live))
        art.append(fit_text([('ui',700)], (24, 13, 34, 39), name+'-ui', live))
    elif key=='6c':
        art.append(fit_text([('c',300)], (8, 7, 22, 24), name+'-c', live))
        art.append(fit_text([('/',600)], (22, 18, 17, 32), name+'-slash', live))
        art.append(fit_text([('ui',700)], (28, 33, 29, 25), name+'-ui', live))
    return root

def place_svg(parent, asset, x, y, width, height, ident):
    nested = deepcopy(asset)
    for element in nested.iter():
        if 'id' in element.attrib:
            element.attrib['id'] = ident+'-'+element.attrib['id']
        if 'aria-labelledby' in element.attrib:
            element.attrib['aria-labelledby'] = ' '.join(ident+'-'+value for value in element.attrib['aria-labelledby'].split())
    nested.attrib.update({'id': ident, 'x': str(x), 'y': str(y), 'width': str(width), 'height': str(height)})
    parent.append(nested)

def proof_sheet(assets):
    root = document('caddy-ui-vector-studies', 1080, 1210, 'Overview of three wordmarks and seven favicon studies. All artwork and labels are vector outlines.', True)
    def label(text, box, name, color=WHITE, weight=300):
        root.append(fit_text([(text,weight)], box, name, color=color))
    label('caddy/ui - editable vector studies', (32, 24, 1016, 40), 'sheet-title')
    for index, key in enumerate(['02','06','07']):
        y=84+index*172
        label({'02':'02  Cursor finish','06':'06  Weight shift','07':'07  Bracket baseline'}[key], (32,y,380,22), 'sheet-label-'+key, MUTED)
        place_svg(root, assets[key], 32, y+25, 800, 140, 'sheet-wordmark-'+key)
    label('02 favicon studies', (32,610,500,26), 'sheet-family-02')
    for index, key in enumerate(['2a','2b','2c','2d']):
        x=32+index*262
        node('rect', {'x':x,'y':650,'width':230,'height':230,'fill':DARK,'stroke':'#323B49'}, root)
        place_svg(root, assets[key], x+56, 666, 118,118, 'sheet-icon-'+key)
        label(key.upper()+' '+ICON_NAMES[key], (x+8,800,214,20), 'sheet-caption-'+key, MUTED)
        place_svg(root, assets[key], x+142, 850, 16,16, 'sheet-16-'+key)
        place_svg(root, assets[key], x+172, 842, 32,32, 'sheet-32-'+key)
    label('06 favicon studies', (32,915,500,26), 'sheet-family-06')
    for index, key in enumerate(['6a','6b','6c']):
        x=32+index*262
        node('rect', {'x':x,'y':955,'width':230,'height':230,'fill':DARK,'stroke':'#323B49'}, root)
        place_svg(root, assets[key], x+56, 971,118,118,'sheet-icon-'+key)
        label(key.upper()+' '+ICON_NAMES[key], (x+8,1105,214,20), 'sheet-caption-'+key,MUTED)
        place_svg(root, assets[key], x+142,1155,16,16,'sheet-16-'+key)
        place_svg(root, assets[key], x+172,1147,32,32,'sheet-32-'+key)
    return root

def main():
    assets = {'02': wordmark02(), '06': wordmark06(), '07': wordmark07()}
    for key, name in [('02','cursor-finish'),('06','weight-shift'),('07','bracket-baseline')]:
        write(ROOT/'wordmarks'/f'{key}-{name}.svg',assets[key])
    for key in ICON_NAMES:
        assets[key]=favicon(key)
        write(ROOT/'favicons'/f'{key}-{ICON_NAMES[key]}.svg',assets[key])
        write(ROOT/'live-text'/'favicons'/f'{key}-{ICON_NAMES[key]}.svg',favicon(key,True))
    write(ROOT/'live-text'/'wordmarks'/'02-cursor-finish.svg', wordmark02(True))
    write(ROOT/'live-text'/'wordmarks'/'06-weight-shift.svg', wordmark06(True))
    write(ROOT/'preview.svg', proof_sheet(assets))
    hashes = {str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT/'fonts').iterdir()) if p.is_file()}
    (ROOT/'font-sources.json').write_text(json.dumps({'source':'https://github.com/google/fonts/tree/main/ofl/ibmplexmono','font_files_unmodified':True,'sha256':hashes},indent=2)+'\n')
    print('Built 3 outlined wordmarks, 7 outlined favicons, 9 live-text alternatives and vector proof sheet.')

if __name__=='__main__':
    main()
