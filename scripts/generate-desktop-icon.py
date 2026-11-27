"""Render the official SVG with system librsvg via GdkPixbuf; write PNG-backed ICO."""
import struct
import subprocess
import sys
from pathlib import Path
import tempfile

source,target=map(Path,sys.argv[1:])
sizes=(16,24,32,48,64,128,256)
with tempfile.TemporaryDirectory() as directory:
    images=[]
    for size in sizes:
        png=Path(directory)/f"{size}.png"
        subprocess.run(["rsvg-convert","-w",str(size),"-h",str(size),"-o",str(png),str(source)],check=True)
        data=png.read_bytes()
        if not data.startswith(b"\x89PNG\r\n\x1a\n") or struct.unpack(">II",data[16:24])!=(size,size):
            raise RuntimeError("Invalid rendered icon")
        images.append(data)
    offset=6+16*len(sizes)
    entries=[]
    for size,data in zip(sizes,images):
        entries.append(struct.pack("<BBBBHHII",size%256,size%256,0,0,1,32,len(data),offset))
        offset+=len(data)
    target.write_bytes(struct.pack("<HHH",0,1,len(sizes))+b"".join(entries)+b"".join(images))
