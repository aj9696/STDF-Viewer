"""Escaped renderer for the project's small Markdown documentation set."""

import html
import re

DOCS = ("engineer-guide", "installation", "methods", "architecture", "api", "runtime-build", "release-verification")


def inline(text):
    text = html.escape(text)

    def link(match):
        label, target = match.groups()
        target = html.unescape(target)
        base = target.removesuffix(".md").removeprefix("docs/")
        if base in DOCS:
            target = "/docs/" + base
        if not (target.startswith("https://") or target.startswith("/docs/")):
            return label + " (" + html.escape(target) + ")"
        return f'<a href="{html.escape(target, quote=True)}">{label}</a>'

    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link, text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    return re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)


def document_page(name, text):
    lines, parts, i = text.splitlines(), [], 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if line.startswith("```"):
            i += 1
            code = []
            while i < len(lines) and not lines[i].startswith("```"):
                code.append(lines[i])
                i += 1
            parts.append("<pre><code>" + html.escape("\n".join(code)) + "</code></pre>")
        elif line.startswith("#"):
            level = min(4, len(line) - len(line.lstrip("#")))
            parts.append(f"<h{level}>{inline(line[level:].strip())}</h{level}>")
        elif line.startswith("|") and i + 1 < len(lines) and re.fullmatch(r"[|\s:\-]+", lines[i + 1]):
            headers = line.strip("|").split("|")
            table = "<div class='table-wrap'><table><thead><tr>" + "".join(f"<th>{inline(c.strip())}</th>" for c in headers) + "</tr></thead><tbody>"
            i += 2
            while i < len(lines) and lines[i].startswith("|"):
                table += "<tr>" + "".join(f"<td>{inline(c.strip())}</td>" for c in lines[i].strip("|").split("|")) + "</tr>"
                i += 1
            parts.append(table + "</tbody></table></div>")
            continue
        elif re.match(r"^(- |\d+\. )", line):
            tag = "ol" if re.match(r"^\d+\. ", line) else "ul"
            items = []
            while i < len(lines) and re.match(r"^(- |\d+\. )", lines[i]):
                item = re.sub(r"^(- |\d+\. )", "", lines[i])
                i += 1
                while i < len(lines) and lines[i].startswith("  "):
                    item += " " + lines[i].strip()
                    i += 1
                items.append("<li>" + inline(item) + "</li>")
            parts.append(f"<{tag}>" + "".join(items) + f"</{tag}>")
            continue
        else:
            paragraph = [line]
            i += 1
            while i < len(lines) and lines[i].strip() and not re.match(r"^(#|```|\||- |\d+\. )", lines[i]):
                paragraph.append(lines[i])
                i += 1
            parts.append("<p>" + inline(" ".join(paragraph)) + "</p>")
            continue
        i += 1
    links = "".join(f'<a href="/docs/{doc}">{doc.replace("-", " ").title()}</a>' for doc in DOCS)
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
            f'<title>SemiData · {html.escape(name)}</title><style>'
            'body{font:16px/1.7 system-ui;color:#233447;background:#f6f8fa;margin:0}'
            'main{max-width:920px;margin:auto;padding:40px}a{color:#087c74}nav{display:flex;'
            'flex-wrap:wrap;gap:8px 20px;margin:24px 0;border-bottom:1px solid #ddd;padding-bottom:16px}'
            'pre{overflow:auto;padding:20px;background:#e9eef2;border-radius:8px}code{font-size:.9em;'
            'background:#e9eef2;padding:2px 4px}h1,h2,h3{line-height:1.25;margin-top:1.8em}'
            'th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd;vertical-align:top}'
            'table{border-collapse:collapse;width:100%;font-size:.9em}.table-wrap{overflow:auto}'
            'li{margin-bottom:8px}</style><main><a href="/">← Back to SemiData</a><nav>' + links + '</nav>'
            + "\n".join(parts) + '</main></html>')
