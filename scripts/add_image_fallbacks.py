from pathlib import Path
path = Path('/home/ubuntu/zeeor-fashion-store/src/main.jsx')
s = path.read_text()
repls = {
    '<img src={product.images?.[0] || imgFallback} alt={product.name} />': '<img src={product.images?.[0] || imgFallback} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = imgFallback; }} alt={product.name} />',
    '<img src={src} alt={`${product.name} view ${i + 1}`} />': '<img src={src} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = imgFallback; }} alt={`${product.name} view ${i + 1}`} />',
    '<img src={src} alt="" />': '<img src={src} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = imgFallback; }} alt="" />',
    '<img src={item.image || imgFallback} alt={item.name} />': '<img src={item.image || imgFallback} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = imgFallback; }} alt={item.name} />',
}
for old, new in repls.items():
    s = s.replace(old, new)
path.write_text(s)
