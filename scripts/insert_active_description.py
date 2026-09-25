from pathlib import Path
path = Path('/home/ubuntu/zeeor-fashion-store/src/main.jsx')
text = path.read_text()
needle = '<Input label="Product name" name="name" value={form.name} update={(e) => setForm({ ...form, name: e.target.value })} required /><div className="form-grid two">'
replacement = '<Input label="Product name" name="name" value={form.name} update={(e) => setForm({ ...form, name: e.target.value })} required /><label className="field"><span>Short description</span><input value={form.shortDescription} onChange={(e) => setForm({ ...form, shortDescription: e.target.value })} placeholder="One clear line customers see on cards" required /></label><label className="field"><span>Product description</span><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows="4" placeholder="Fabric, fit, styling, and care details" required /></label><div className="form-grid two">'
if needle not in text:
    raise SystemExit('active product form needle not found')
path.write_text(text.replace(needle, replacement, 1))
