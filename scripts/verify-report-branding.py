import pathlib, re, subprocess, sys, zipfile, xml.etree.ElementTree as ET, struct
root = pathlib.Path(sys.argv[1])
pdf = root / "ars-report-test.pdf"
info = subprocess.check_output(["pdfinfo", str(pdf)], text=True)
pages = int(re.search(r"^Pages:\s+(\d+)", info, re.M).group(1))
assert pages > 1, "Expected a multipage report"
images = subprocess.check_output(["pdfimages", "-list", str(pdf)], text=True)
actual = {int(m.group(1)) for m in re.finditer(r"^\s*(\d+)\s+\d+\s+image\s+350\s+72\s+", images, re.M)}
assert actual == set(range(1, pages + 1)), f"Missing RS Nextward logo on report pages: {actual}"
with zipfile.ZipFile(root / "ars-report-test.xlsx") as book:
    assert book.testzip() is None
    png = book.read("xl/media/rs-nextward.png")
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    assert struct.unpack(">II", png[16:24]) == (350, 72)
    ns = {"r": "http://schemas.openxmlformats.org/package/2006/relationships", "x": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing", "a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
    for i in (1, 2):
        rels = ET.fromstring(book.read(f"xl/drawings/_rels/drawing{i}.xml.rels"))
        ids = {r.attrib["Id"] for r in rels if r.attrib.get("Target") == "../media/rs-nextward.png"}
        drawing = ET.fromstring(book.read(f"xl/drawings/drawing{i}.xml"))
        assert any(b.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed") in ids for b in drawing.findall(".//a:blip", ns)), f"Missing parent artwork on drawing {i}"
        sheetrels = ET.fromstring(book.read(f"xl/worksheets/_rels/sheet{i}.xml.rels"))
        assert any(r.attrib.get("Target") == f"../drawings/drawing{i}.xml" for r in sheetrels)
print(f"Verified RS Nextward image on {pages} report pages and both workbook drawings")
