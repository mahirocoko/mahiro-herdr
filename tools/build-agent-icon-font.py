#!/usr/bin/env python3
"""Extend pinned Radar icons with Letta Code's official static front-frame mark.

Build-only dependency: fonttools==4.59.2 in a repo-owned isolated environment.
No SVG invention: each rectangle is a literal run of F cells from the official
AnimatedLogo.tsx front frame (f898fda60932b34ddbcfd389ea414515b0a5d272).
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'assets/agent-icons/HerdrAgentIconsMax-Regular.ttf'
OUTPUT = ROOT / 'assets/agent-icons/MahiroHerdrAgentIcons-Regular.ttf'
FRONT = ['  FFFFFF  ', 'FF      FF', 'FF  FF  FF', 'FF      FF', '  FFFFFF  ']

font = TTFont(SOURCE, recalcTimestamp=False)
pen = TTGlyphPen(None)
for row_index, row in enumerate(FRONT):
    column = 0
    while column < 10:
        if row[column] != 'F':
            column += 1
            continue
        start = column
        while column < 10 and row[column] == 'F':
            column += 1
        left, right = 20 + start * 56, 20 + column * 56
        bottom, top = 85 + (4 - row_index) * 112, 85 + (5 - row_index) * 112
        pen.moveTo((left, bottom))
        pen.lineTo((left, top))
        pen.lineTo((right, top))
        pen.lineTo((right, bottom))
        pen.closePath()

glyph = 'letta'
font.setGlyphOrder(font.getGlyphOrder() + [glyph])
font['glyf'][glyph] = pen.glyph()
font['hmtx'][glyph] = (600, 20)
for table in font['cmap'].tables:
    if table.isUnicode():
        table.cmap[0xE1BB] = glyph
names = {
    1: 'Mahiro Herdr Agent Icons', 2: 'Regular',
    3: 'MahiroHerdrAgentIcons-1', 4: 'Mahiro Herdr Agent Icons Regular',
    6: 'MahiroHerdrAgentIcons-Regular'
}
for record in font['name'].names:
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
font['head'].created = font['head'].modified = 2082844800
font.save(OUTPUT)
assert TTFont(OUTPUT).getBestCmap()[0xE1BB] == glyph
print(OUTPUT)
