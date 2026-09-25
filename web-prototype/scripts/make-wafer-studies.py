"""Independent byte-level, little/big-endian STDF fixture for wafer studies."""
import json
import statistics
import struct
import sys
from pathlib import Path


def build(big, head_override=None, die_height=2):
    order = '>' if big else '<'
    data, records, attempts = bytearray(), [], []
    def pack(fmt, *values):
        return struct.pack(order + fmt, *values)
    def cn(text):
        value = text.encode('ascii')
        return bytes([len(value)]) + value
    def record(kind, sub, body):
        if head_override is not None:
            if kind == 5 or kind == 2 and sub in (10, 20):
                body = bytes([head_override]) + body[1:]
            elif kind == 15:
                body = body[:4] + bytes([head_override]) + body[5:]
        records.append(f'{kind}/{sub}')
        data.extend(pack('HBB', len(body), kind, sub) + body)
        return len(records)
    record(0, 10, bytes([1 if big else 2, 4]))
    record(1, 10, pack('IIBcccHc', 100, 100, 1, b'P', b' ', b' ', 65535, b' ') + b''.join(cn(v) for v in ['LOT-A', 'TEST-DEVICE', 'TESTER', 'TYPE', 'PROGRAM']))
    record(2, 30, pack('fffBchhcc', 200, die_height, 1, 3, b'D', 0, 0, b'L', b'D'))
    wafer = record(2, 10, pack('BBI', 1, 1, 100) + cn('GRID'))
    def part(head, site, x, y, values, flags=0, soft=1):
        start = record(5, 10, bytes([head, site]))
        for value, testflag in values:
            body = pack('IBBBBf', 101, head, site, testflag, 0, value) + cn('Voltage') + b'\0'
            body += pack('Bbbbff', 0, 0, 0, 0, 0, 10) + cn('V')
            record(15, 10, body)
        name = f'P{len(attempts)+1}'
        end = record(5, 20, pack('BBBHHHhhI', head, site, flags, len(values), soft, soft, x, y, 100) + cn(name) + b'\0\0')
        attempts.append({'id': start, 'prr': end, 'x': x, 'y': y, 'head': head, 'site': site, 'flags': flags, 'name': name})
    index = 0
    for x in range(-1, 2):
        for y in range(-1, 2):
            failed = x == -1
            values = [(index, 128 if failed else 0)]
            if x == 0 and y == 0:
                values.append((7, 0))
            if x == 1 and y == 1:
                values.append((999, 2))
            part(1, 1 if y <= 0 else 2, x, y, values, 8 if failed else 0, 2 if failed else 1)
            index += 1
    part(1, 1, -32768, -32768, [(4, 0)], 16, 4)
    part(1, 1, 2, 2, [], 0, 1)
    record(2, 20, pack('BBIIIIII', 1, 1, 200, 11, 0, 0, 7, 0) + cn('GRID'))
    second = record(2, 10, pack('BBI', 1, 1, 200) + cn('ISOLATED'))
    part(1, 1, 0, 0, [(50, 0)], 0, 1)
    third = record(2, 10, pack('BBI', 2, 2, 210) + cn('HEAD-2'))
    part(2, 1, 0, 0, [(60, 0)], 0, 1)
    record(1, 30, pack('BBIIIII', 255, 255, 13, 0, 0, 9, 0))
    for kind in [40, 50]:
        for number, count, flag in [(1, 9, b'P'), (2, 3, b'F'), (4, 1, b' ')]:
            record(1, kind, pack('BBHIc', 255, 255, number, count, flag) + cn(f'BIN{number}'))
    record(1, 20, pack('Ic', 250, b' ') + b'\0\0')
    values = [0, 1, 2, 3, 7, 5, 6, 7]
    return bytes(data), {'records': len(records), 'recordCounts': {kind: records.count(kind) for kind in set(records)}, 'attempts': 13,
                        'passed': 9, 'failed': 3, 'unknown': 1, 'wafer': wafer, 'secondWafer': second, 'thirdWafer': third,
                        'map': {'coordinates': 10, 'valid': 8, 'missing': 1, 'invalid': 1, 'mean': statistics.mean(values), 'median': statistics.median(values), 'stdev': statistics.pstdev(values)}}


out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
expected = {}
for big in [False, True]:
    name = 'wafer-big.stdf' if big else 'wafer-little.stdf'
    raw, expected[name] = build(big)
    (out / name).write_bytes(raw)
(out / 'expected.json').write_text(json.dumps(expected, indent=2), encoding='utf8')
# Same independently framed population on a filtered-out head, with distinct WCR.
# It must not block aggregation until its coordinates enter the selected scope.
(out / 'wafer-head3-different-geometry.stdf').write_bytes(build(False, head_override=3, die_height=4)[0])
