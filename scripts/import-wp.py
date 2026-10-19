"""One-off import of the live WordPress pages we keep, into src/content/pages/*.md.

Reads data/redirect-map.csv, fetches every row whose action is keep/keep-noindex,
and writes its title, meta description, H1 and body text (headings, paragraphs,
list items) as Markdown. Output is a starting point to rewrite, marked imported: true.

Usage: python3 -I scripts/import-wp.py [--force]
"""
import csv, html, json, os, re, sys, time, urllib.request
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGIN = 'https://thebestscreenprinting.com'
OUT = os.path.join(ROOT, 'src', 'content', 'pages')
SKIP_TAGS = {'script', 'style', 'noscript', 'svg', 'form', 'nav', 'header', 'footer', 'iframe', 'select', 'button'}
SKIP_ELEMENTOR = {'header', 'footer', 'popup'}
BLOCK = {'h2': '## ', 'h3': '### ', 'h4': '#### ', 'h5': '#### ', 'h6': '#### ', 'p': '', 'li': '- '}
VOID = {'br', 'img', 'hr', 'input', 'meta', 'link', 'source', 'wbr', 'area', 'base', 'col', 'embed', 'param', 'track'}


class Extract(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []          # (tag, skipping)
        self.title = ''
        self.desc = ''
        self.h1 = ''
        self.in_title = False
        self.cur = None          # (prefix, [text])
        self.cur_tag = None
        self.h1_buf = None
        self.blocks = []

    @property
    def skipping(self):
        return any(s for _, s in self.stack)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'meta' and a.get('name') == 'description':
            self.desc = a.get('content', '')
        if tag in VOID:
            if tag == 'br' and self.cur:
                self.cur[1].append(' ')
            return
        skip = tag in SKIP_TAGS or a.get('data-elementor-type') in SKIP_ELEMENTOR
        self.stack.append((tag, skip))
        if tag == 'title':
            self.in_title = True
        if self.skipping:
            return
        if tag == 'h1' and not self.h1:
            self.h1_buf = []
        elif tag in BLOCK and self.cur is None:
            self.cur = (BLOCK[tag], [])
            self.cur_tag = tag

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        # Pop to the matching tag (HTML in the wild is not always balanced).
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break
        if tag == 'title':
            self.in_title = False
        if tag == 'h1' and self.h1_buf is not None:
            self.h1 = norm(''.join(self.h1_buf))
            self.h1_buf = None
        if self.cur is not None and tag == self.cur_tag:
            text = norm(''.join(self.cur[1]))
            if text:
                self.blocks.append(self.cur[0] + text)
            self.cur = None
            self.cur_tag = None

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        if self.skipping:
            return
        if self.h1_buf is not None:
            self.h1_buf.append(data)
        elif self.cur is not None:
            self.cur[1].append(data)


def norm(s):
    return re.sub(r'\s+', ' ', html.unescape(s)).strip()


def kind_for(path):
    if path.startswith('/services/') or path == '/screen-printing/':
        return 'service'
    if path.startswith('/products/'):
        return 'product'
    if re.search(r'-ca/$', path):
        return 'location'
    if path.startswith('/what-') or path.startswith('/how-') or path in ('/blog/', '/helpful-design-tips/', '/the-screen-printing-on-the-hoodies/'):
        return 'blog'
    if path in ('/privacy-policy/', '/terms-conditions/'):
        return 'legal'
    if path in ('/thank-you/', '/quick-quote/'):
        return 'utility'
    if path in ('/event-apparel/', '/small-business/', '/clubs-groups/', '/influencers/', '/celebrities/', '/event-apparel/trade-show-swag-anaheim/', '/custom-coachella-merch/'):
        return 'audience'
    return 'core'


def slug_for(path):
    return 'home' if path == '/' else path.strip('/').replace('/', '__')


def yaml_str(s):
    return json.dumps(s, ensure_ascii=False)


def main():
    force = '--force' in sys.argv
    os.makedirs(OUT, exist_ok=True)
    rows = list(csv.DictReader(open(os.path.join(ROOT, 'data', 'redirect-map.csv'))))
    keep = [r for r in rows if r['action'] in ('keep', 'keep-noindex') and r['old_url'].startswith(ORIGIN)]
    print(f'{len(keep)} pages to import')
    for r in keep:
        path = r['old_url'][len(ORIGIN):]
        dest = os.path.join(OUT, slug_for(path) + '.md')
        if os.path.exists(dest) and not force:
            continue
        req = urllib.request.Request(ORIGIN + path, headers={'User-Agent': 'TBSP-site-import/1.0'})
        try:
            body = urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'replace')
        except Exception as e:
            print(f'  FAIL {path}: {e}')
            continue
        p = Extract()
        p.feed(body)
        seen, lines = set(), []
        for b in p.blocks:
            if b in seen:
                continue
            seen.add(b)
            lines.append(b)
        title = norm(p.title) or p.h1
        h1 = p.h1 or title
        fm = [
            '---',
            f'path: {yaml_str(path)}',
            f'title: {yaml_str(title)}',
            f'description: {yaml_str(norm(p.desc))}',
            f'h1: {yaml_str(h1)}',
            f'kind: {kind_for(path)}',
            'imported: true',
        ]
        if r['action'] == 'keep-noindex':
            fm.append('noindex: true')
        fm += [f'sourceUrl: {yaml_str(ORIGIN + path)}', '---', '']
        # Join list items tightly, everything else with blank lines.
        md, prev_li = [], False
        for line in lines:
            li = line.startswith('- ')
            md.append(('\n' if li and prev_li else '\n\n') + line)
            prev_li = li
        with open(dest, 'w') as f:
            f.write('\n'.join(fm) + ''.join(md).lstrip() + '\n')
        print(f'  ok {path} ({len(lines)} blocks)')
        time.sleep(0.5)


if __name__ == '__main__':
    main()
