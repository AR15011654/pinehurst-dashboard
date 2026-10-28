"""
Genera js/maquinas.js a partir del inventario de máquinas (Excel).
Toma la pestaña MAQUINAS y filtra TIPO DE MAQUINA = HEAT TRANSFER.

Uso:  python herramientas/generar-maquinas.py "INVENTARIO MAQUINAS.xlsx"
Requiere:  pip install openpyxl
"""
import json, sys, datetime, os
import openpyxl

def texto(v):
    if v is None:
        return ''
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()

def main(ruta):
    wb = openpyxl.load_workbook(ruta, data_only=True, read_only=True)
    ws = wb['MAQUINAS']
    filas = ws.iter_rows(values_only=True)
    cab = [texto(c).upper() for c in next(filas)]
    idx = {n: cab.index(n) for n in ['ASSET ID', 'TIPO DE MAQUINA', 'SERIE', 'FABRICANTE', 'MODEL',
                                     'HOME LOCATION', 'STATION', 'ESTADO', 'QR']}
    maquinas = []
    for f in filas:
        if texto(f[idx['TIPO DE MAQUINA']]).upper() != 'HEAT TRANSFER':
            continue
        serie = texto(f[idx['SERIE']])
        if serie in ('', '0'):
            serie = ''
        maquinas.append({
            'serie': serie,
            'qr': texto(f[idx['QR']]),
            'asset': texto(f[idx['ASSET ID']]),
            'fabricante': texto(f[idx['FABRICANTE']]),
            'modelo': texto(f[idx['MODEL']]),
            'linea': texto(f[idx['HOME LOCATION']]),
            'estacion': texto(f[idx['STATION']]),
            'estado': texto(f[idx['ESTADO']]),
        })
    maquinas.sort(key=lambda m: m['serie'] or 'ZZZ')
    destino = os.path.join(os.path.dirname(__file__), '..', 'js', 'maquinas.js')
    with open(destino, 'w', encoding='utf-8') as fh:
        fh.write('/* Generado por herramientas/generar-maquinas.py el %s desde "%s". No editar a mano. */\n'
                 % (datetime.date.today().isoformat(), os.path.basename(ruta)))
        fh.write('self.MAQUINAS_HT = ')
        json.dump(maquinas, fh, ensure_ascii=False, indent=0)
        fh.write(';\n')
    print('Máquinas Heat Transfer exportadas:', len(maquinas), '->', os.path.normpath(destino))

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'INVENTARIO MAQUINAS.xlsx')
