from pathlib import Path
path = Path('/home/ubuntu/zeeor-fashion-store/src/main.jsx')
text = path.read_text()
text = text.replace('<label className="payment-option"><input type="radio" disabled /> Bank transfer <span>Coming soon</span></label>', '')
path.write_text(text)
