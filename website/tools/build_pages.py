#!/usr/bin/env python3
"""Stamps the shared header/footer into every page of site/ (between marker comments).
Run after editing tools/partials/*.html:  python3 tools/build_pages.py
The output is plain static HTML — nothing needs to run on the host."""
import pathlib, re
ROOT = pathlib.Path(__file__).resolve().parent
SITE = ROOT.parent / 'public'
header = (ROOT / 'partials/header.html').read_text(encoding='utf-8')
footer = (ROOT / 'partials/footer.html').read_text(encoding='utf-8')
import json, html as H
FAQ = json.loads((ROOT / 'faq.json').read_text(encoding='utf-8'))
CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'

def faq_html(items):
    out = []
    for i, f in enumerate(items, 1):
        out.append(f'<div class="faq-item"><h3><button type="button" aria-expanded="false" aria-controls="faq-a{i}" id="faq-q{i}">{H.escape(f["q"])}{CHEV}</button></h3>'
                   f'<div class="ans" id="faq-a{i}" role="region" aria-labelledby="faq-q{i}" hidden><p>{H.escape(f["a"])}</p></div></div>')
    ld = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": f["q"], "acceptedAnswer": {"@type": "Answer", "text": f["a"]}} for f in items]}
    return '\n'.join(out) + '\n<script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False) + '</script>\n'

for page in SITE.rglob('*.html'):
    html = page.read_text(encoding='utf-8')
    rel = '/' + page.relative_to(SITE).as_posix().replace('index.html', '')
    h = header
    for href in re.findall(r'href="(/[^"#]*)"', header):
        if href == rel and href != '/':
            h = h.replace(f'href="{href}"', f'href="{href}" aria-current="page"')
    html = re.sub(r'<!--HEADER-->.*?<!--/HEADER-->', '<!--HEADER-->\n' + h + '<!--/HEADER-->', html, flags=re.S)
    html = re.sub(r'<!--FOOTER-->.*?<!--/FOOTER-->', '<!--FOOTER-->\n' + footer + '<!--/FOOTER-->', html, flags=re.S)
    html = re.sub(r'<!--FAQ:home-->.*?<!--/FAQ-->', lambda m: '<!--FAQ:home-->\n' + faq_html([f for f in FAQ if f['home']]) + '<!--/FAQ-->', html, flags=re.S)
    html = re.sub(r'<!--FAQ:all-->.*?<!--/FAQ-->', lambda m: '<!--FAQ:all-->\n' + faq_html(FAQ) + '<!--/FAQ-->', html, flags=re.S)
    page.write_text(html, encoding='utf-8')
    print('stamped', page.relative_to(SITE))
