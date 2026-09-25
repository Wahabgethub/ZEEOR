from pathlib import Path
import re
path = Path('/home/ubuntu/zeeor-fashion-store/src/main.jsx')
s = path.read_text()
s = re.sub(r'function ProductsManager2\([\s\S]*?(?=function ProductsManager3)', '', s, count=1)
path.write_text(s)
