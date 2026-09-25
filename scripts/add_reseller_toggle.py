from pathlib import Path
path = Path('/home/ubuntu/zeeor-fashion-store/src/main.jsx')
text = path.read_text()
old = '<span className="status delivered">Active</span></div>)}</div>}{tab === \'categories\''
new = '<span className={`status ${r.active === false ? \'cancelled\' : \'delivered\'}`}>{r.active === false ? \'Inactive\' : \'Active\'}</span><button className="table-action" onClick={async () => { const active = r.active === false; await request(`/api/admin/resellers/${r.id}`, { method: \'PATCH\', body: JSON.stringify({ active }) }); setResellers(resellers.map((item) => item.id === r.id ? { ...item, active } : item)); setToast(active ? \'Reseller activated\' : \'Reseller deactivated; customer listings hidden\'); }}>{r.active === false ? \'Activate\' : \'Deactivate\'}</button></div>)}</div>}{tab === \'categories\''
if old not in text:
    raise SystemExit('target reseller row not found')
path.write_text(text.replace(old, new, 1))
