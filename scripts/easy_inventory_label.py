from pathlib import Path
path = Path('/home/ubuntu/zeeor-fashion-store/src/main.jsx')
s = path.read_text()
s = s.replace('<span>Inventory JSON</span><textarea value={form.inventory}', '<span>Stock by colour and size</span><textarea aria-label="Inventory JSON" value={form.inventory}')
s = s.replace('rows="2" required /></label><label className="field"><span>Grouped product images', 'rows="2" required /><small className="muted">Use colour-size keys, for example Black-S: 5 means 5 black small items. Separate entries with commas.</small></label><label className="field"><span>Grouped product images')
s = s.replace("const inventoryText = window.prompt('Inventory JSON:', JSON.stringify(product.inventory || {}));", "const inventoryText = window.prompt('Stock by colour and size. Example: {\\\"Black-S\\\":5,\\\"Black-M\\\":3}', JSON.stringify(product.inventory || {}));")
path.write_text(s)
