#!/usr/bin/env python3
"""Сборка каталога и поискового индекса из PDF-конспектов.

Структура:
    content/<предмет>/meta.json   — название предмета, порядок, правки заголовков
    content/<предмет>/NN.pdf      — лекции (номер берётся из имени файла)

Темы внутри лекции берутся из закладок (outline) PDF: каждая закладка верхнего
уровня — отдельная тема, вложенные — подтемы. Если закладок нет, лекция
становится одной темой.

Результат: data/catalog.json (структура) и data/search.json (текст страниц).
Запуск: python3 tools/build.py
"""
import json
import logging
import re
import subprocess
from pathlib import Path

import pypdf

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
DATA = ROOT / "data"

# Закладка с top выше этой доли высоты страницы считается началом страницы:
# тогда предыдущая тема заканчивается на странице раньше.
TOP_OF_PAGE = 0.85

logging.getLogger("pypdf").setLevel(logging.ERROR)


def clean(s):
    return re.sub(r"\s+", " ", s or "").strip()


def page_texts(pdf):
    """Текст каждой страницы через pdftotext (лучше справляется с формулами)."""
    out = subprocess.run(["pdftotext", "-enc", "UTF-8", str(pdf), "-"],
                         capture_output=True, text=True, check=True).stdout
    pages = out.split("\f")
    # колонтитул «Вебинар №N» на каждой странице — шум для поиска
    return [clean(re.sub(r"^\s*Вебинар №\s*\d+", "", p)) for p in pages]


def lecture_title(first_page):
    # На обложке: «... Веб 12 | Производные высших порядков. Формула Тейлора Максим ...»
    m = re.search(r"\|\s*(.+?)\s+Максим", first_page)
    return clean(m.group(1)) if m else None


def read_outline(reader, fixes):
    """Возвращает [(title, page_index, top, [(sub_title, page_index)])]."""
    res = []

    def fix(t):
        t = clean(t)
        return fixes.get(t, t)

    items = reader.outline
    for i, it in enumerate(items):
        if isinstance(it, list):
            continue
        subs = []
        if i + 1 < len(items) and isinstance(items[i + 1], list):
            for s in items[i + 1]:
                if not isinstance(s, list):
                    subs.append((fix(s.title), reader.get_destination_page_number(s)))
        top = it.top if it.typ == "/XYZ" and it.top is not None else None
        res.append((fix(it.title), reader.get_destination_page_number(it), top, subs))
    return res


def build_lecture(pdf, subject_id, meta):
    reader = pypdf.PdfReader(str(pdf))
    n_pages = len(reader.pages)
    height = float(reader.pages[0].mediabox.height)
    texts = page_texts(pdf)[:n_pages]
    lec_id = pdf.stem
    lec_meta = meta.get("lectures", {}).get(lec_id, {})
    fixes = {clean(k): v for k, v in meta.get("title_fixes", {}).items()}
    fixes.update({clean(k): v for k, v in lec_meta.get("title_fixes", {}).items()})

    # Страницы до content_start (обложка, оглавление) в темы не входят.
    content_start = lec_meta.get("content_start", meta.get("content_start", 3)) - 1
    outline = read_outline(reader, fixes)
    if not outline:
        outline = [(lec_meta.get("title") or "Конспект", min(content_start, n_pages - 1), None, [])]
    elif outline[0][1] > content_start:
        # Текст до первой закладки — отдельная тема
        outline.insert(0, ("Введение", content_start, height, []))
    sections = []
    for k, (title, start, top, subs) in enumerate(outline):
        if k + 1 < len(outline):
            nstart, ntop = outline[k + 1][1], outline[k + 1][2]
            starts_at_top = ntop is not None and ntop / height > TOP_OF_PAGE
            end = nstart - 1 if starts_at_top else nstart
        else:
            end = n_pages - 1
        end = max(start, end)
        sections.append({
            "id": f"s{k + 1}",
            "title": title,
            # страницы 1-индексные, как в PDF-просмотрщике
            "pages": [start + 1, end + 1],
            "subsections": [{"title": t, "page": p + 1} for t, p in subs],
        })

    title = lec_meta.get("title") or lecture_title(texts[0]) or f"Лекция {lec_id}"
    lecture = {
        "id": lec_id,
        "number": int(lec_id) if lec_id.isdigit() else None,
        "title": title,
        "file": f"content/{subject_id}/{pdf.name}",
        "pageCount": n_pages,
        "sections": sections,
    }

    search = []
    first_content_page = sections[0]["pages"][0] if sections else 1
    for idx, text in enumerate(texts):
        page = idx + 1
        if page < first_content_page or not text:
            continue  # обложка и оглавление — шум для поиска
        sec = next((s for s in sections if s["pages"][0] <= page <= s["pages"][1]), sections[-1])
        search.append({"s": subject_id, "l": lec_id, "sec": sec["id"], "p": page, "t": text})
    return lecture, search


def main():
    subjects, search = [], []
    for sdir in sorted(p for p in CONTENT.iterdir() if p.is_dir()):
        meta_path = sdir / "meta.json"
        meta = json.loads(meta_path.read_text("utf-8")) if meta_path.exists() else {}
        lectures = []
        for pdf in sorted(sdir.glob("*.pdf")):
            lec, idx = build_lecture(pdf, sdir.name, meta)
            lectures.append(lec)
            search.extend(idx)
            print(f"  {sdir.name}/{pdf.name}: {len(lec['sections'])} тем — {lec['title']}")
        subjects.append({
            "id": sdir.name,
            "title": meta.get("title", sdir.name),
            "short": meta.get("short", meta.get("title", sdir.name)),
            "description": meta.get("description", ""),
            "order": meta.get("order", 100),
            "lectures": lectures,
        })
    subjects.sort(key=lambda s: (s["order"], s["title"]))
    DATA.mkdir(exist_ok=True)
    (DATA / "catalog.json").write_text(
        json.dumps({"subjects": subjects}, ensure_ascii=False, indent=1), "utf-8")
    (DATA / "search.json").write_text(
        json.dumps(search, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print(f"Готово: {len(subjects)} предм., {sum(len(s['lectures']) for s in subjects)} лекций, "
          f"{len(search)} страниц в индексе")


if __name__ == "__main__":
    main()
