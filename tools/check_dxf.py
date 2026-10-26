"""Vérifie des DXF exportés par Limon : erreurs ezdxf, entités par calque, aperçu PNG.

Usage : python tools/check_dxf.py out/marches.dxf out/limons.dxf [--png]
        python tools/check_dxf.py out/escalier.zip
"""
import sys, zipfile, io
from ezdxf import recover

def check(name, doc, auditor, png):
    msp = doc.modelspace()
    counts = {}
    for e in msp:
        k = (e.dxftype(), e.dxf.layer)
        counts[k] = counts.get(k, 0) + 1
    print(name, doc.dxfversion, "erreurs:", len(auditor.errors), "corrections:", len(auditor.fixes), dict(sorted(counts.items())))
    if png:
        from ezdxf.addons.drawing import matplotlib as mpl
        mpl.qsave(msp, f"{name}.png", bg="#FFFFFF", size_inches=(10, 7))
    return len(auditor.errors) == 0

args = [a for a in sys.argv[1:] if not a.startswith("--")]
png = "--png" in sys.argv
ok = True
for path in args:
    if path.endswith(".zip"):
        z = zipfile.ZipFile(path)
        bad = z.testzip()
        print("zip:", "OK" if bad is None else f"fichier corrompu {bad}", [(i.filename, i.file_size) for i in z.infolist()])
        ok &= bad is None
        for i in z.infolist():
            if i.filename.endswith(".dxf"):
                doc, auditor = recover.read(io.BytesIO(z.read(i)))
                ok &= check(f"{path}:{i.filename}", doc, auditor, False)
    else:
        doc, auditor = recover.readfile(path)
        ok &= check(path, doc, auditor, png)
sys.exit(0 if ok else 1)
