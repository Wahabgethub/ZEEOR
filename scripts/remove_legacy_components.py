from pathlib import Path
import re
path = Path('/home/ubuntu/zeeor-fashion-store/src/main.jsx')
text = path.read_text()
patterns = [
    r'function ProductsManager\([^\n]*\n',
    r'function CmsManager\([^\n]*\n',
    r'function ResellerStudio\([^\n]*\n',
]
for pattern in patterns:
    text = re.sub(pattern, '', text)
path.write_text(text)
