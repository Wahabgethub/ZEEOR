import json
from pathlib import Path
path = Path('/home/ubuntu/zeeor-fashion-store/data/store.json')
data = json.loads(path.read_text())
if not any(p.get('id') == 'p1' for p in data['products']):
    data['products'].insert(0, {
        'id': 'p1', 'name': 'Midnight Form Hoodie', 'slug': 'midnight-form-hoodie', 'sku': 'ZEE-H01',
        'category': 'Hoodies', 'collection': 'After Dark', 'gender': 'Unisex',
        'description': 'A soft heavyweight hoodie with a relaxed fit, considered seams, and a clean everyday finish.',
        'shortDescription': 'A quiet layer for late nights.', 'price': 118, 'salePrice': 96, 'discount': 19,
        'sizes': ['S', 'M', 'L', 'XL'], 'colors': ['Obsidian', 'Moss'],
        'inventory': {'Obsidian-S': 4, 'Obsidian-M': 8, 'Obsidian-L': 3, 'Obsidian-XL': 0, 'Moss-S': 5, 'Moss-M': 7, 'Moss-L': 4, 'Moss-XL': 2},
        'images': ['/zeeor-editorial.jpg', '/zeeor-editorial.jpg'], 'tags': ['hoodie', 'layer', 'everyday'],
        'flags': {'featured': True, 'new': True, 'bestseller': True, 'sale': True}, 'published': True
    })
path.write_text(json.dumps(data, indent=2) + '\n')
