from pathlib import Path
path = Path('/home/ubuntu/zeeor-fashion-store/src/main.jsx')
text = path.read_text()
text = text.replace("{ name: '', category: '', price: '', salePrice: '', inventory: '{\"Black-S\":5,\"Black-M\":5,\"Black-L\":5,\"Black-XL\":5}' }", "{ name: '', category: '', price: '', salePrice: '', description: '', shortDescription: '', inventory: '{\"Black-S\":5,\"Black-M\":5,\"Black-L\":5,\"Black-XL\":5}' }")
text = text.replace("description: 'A considered ZEEOR piece, made for movement.', shortDescription: 'Designed without limits.'", "description: form.description, shortDescription: form.shortDescription || form.description")
text = text.replace("setForm({ name: '', category: categories[0] || '', price: '', salePrice: '', inventory:", "setForm({ name: '', category: categories[0] || '', price: '', salePrice: '', description: '', shortDescription: '', inventory:")
needle = '<Input label="Product name" name="name" value={form.name} update={(e) => setForm({ ...form, name: e.target.value })} required />'
replacement = needle + '<label className="field"><span>Short description</span><input value={form.shortDescription} onChange={(e) => setForm({ ...form, shortDescription: e.target.value })} placeholder="One clear line customers see on cards" required /></label><label className="field"><span>Product description</span><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows="4" placeholder="Fabric, fit, styling, and care details" required /></label>'
if needle not in text:
    raise SystemExit('product form target not found')
text = text.replace(needle, replacement, 1)
path.write_text(text)
