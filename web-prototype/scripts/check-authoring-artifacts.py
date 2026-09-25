"""Independent struct/CSV/ZIP oracle for browser-generated authoring outputs."""
import csv, hashlib, io, json, pathlib, struct, sys, zipfile
p, originals = map(pathlib.Path, sys.argv[1:])
checks = 0
def records(data, order):
    pos, out = 0, []
    while pos < len(data):
        size, typ, sub = struct.unpack_from(order+'HBB', data, pos)
        raw = data[pos:pos+size+4]
        assert len(raw) == size+4
        out.append((typ, sub, raw[4:], raw))
        pos += size+4
    assert pos == len(data)
    return out
for endian, order in [('little','<'),('big','>')]:
    original = (originals/f'golden-{endian}.stdf').read_bytes()
    assert original == (p/f'original-{endian}.stdf').read_bytes()
    output = (p/f'derived-{endian}.stdf').read_bytes()
    rs = records(output,order)
    assert rs[0][:2] == (0,10) and rs[1][:2] == (0,20) and rs[-1][:2] == (1,20)
    unknown = next(r for r in records(original,order) if r[:2] == (180,99))
    assert next(r for r in rs if r[:2] == (180,99))[3] == unknown[3]
    mir = next(r[2] for r in rs if r[:2] == (1,10))
    assert mir[16:27] == b'DERIVED-LOT'
    mpr = next(r[2] for r in rs if r[:2] == (15,15))
    assert struct.unpack_from(order+'ff',mpr,13) == (.25,1.25)
    pcr = next(r[2] for r in rs if r[:2] == (1,30))
    assert struct.unpack(order+'BBIIIII',pcr) == (255,255,3,4294967295,0,1,4294967295)
    parts = [r[2] for r in rs if r[:2] == (5,20)]
    assert [struct.unpack_from(order+'H',b,7)[0] for b in parts] == [9,5,9]
    assert [b[2]&24 for b in parts] == [8,0,8]
    with zipfile.ZipFile(p/f'batch-{endian}.zip') as z:
        assert z.testzip() is None
        receipt = json.loads(z.read('receipt.json'))
        assert len(receipt['files']) == 4
        for item in receipt['files']:
            assert item['status']=='complete'
            if item['format']=='stdf': assert z.read(item['name']) == output
            if item['format']=='original': assert z.read(item['name']) == original and not item['derived']
            if item['format']=='csv':
                rows = list(csv.DictReader(io.StringIO(z.read(item['name']).decode('utf-8-sig'))))
                assert len(rows)==9
                assert [r['value'] for r in rows if r['record']=='9'] == ['0.25','1.25']
                assert all(r['softBin']=='9' for r in rows if r['device']=='13')
            if item['format']=='json':
                recs=json.loads(z.read(item['name']))['records']
                assert b''.join(bytes.fromhex(r['rawHex']) for r in recs) == output
    removed_bytes = (p/f'removed-{endian}.stdf').read_bytes()
    removed = records(removed_bytes,order)
    original_records = records(original,order)
    # Attempt 6 occupies records 6,7,9,11 amid interleaved records for attempt 3.
    expected = [r[3] for i,r in enumerate(original_records,1) if i not in (6,7,9,11,16)]
    actual = [r[3] for r in removed if r[:2] not in ((0,20),(1,30))]
    # Compare every untouched survivor byte-for-byte, except edited PRR 16.
    assert actual[-3][2:4] == bytes([5,20])
    assert actual[:-3] + actual[-2:] == expected
    remaining_parts = [r[2] for r in removed if r[:2] == (5,20)]
    assert len(remaining_parts) == 2
    assert struct.unpack_from(order+'hh',remaining_parts[-1],9) == (300,-99)
    pcr = next(r[2] for r in removed if r[:2] == (1,30))
    assert struct.unpack(order+'BBIIIII',pcr) == (255,255,2,4294967295,0,1,4294967295)
    assert not any(r[:2] == (15,15) for r in removed)
    with zipfile.ZipFile(p/f'removed-{endian}.zip') as z:
        receipt=json.loads(z.read('receipt.json'))
        for item in receipt['files']:
            if item['format']=='csv':
                rows=list(csv.DictReader(io.StringIO(z.read(item['name']).decode('utf-8-sig'))))
                assert len(rows)==6 and {r['device'] for r in rows} == {'3','13'}
            if item['format']=='json':
                recs=json.loads(z.read(item['name']))['records']
                assert b''.join(bytes.fromhex(r['rawHex']) for r in recs) == removed_bytes
    checks += 21
    meta=records((p/f'metadata-derived-{endian}.stdf').read_bytes(),order)
    original_meta=records((originals/f'metadata-{endian}.stdf').read_bytes(),order)
    mir=next(r[2] for r in meta if r[:2]==(1,10))
    assert struct.unpack_from(order+'IIB',mir)==(990,1090,7)
    assert struct.unpack_from(order+'H',mir,12)[0]==45
    assert next(r[2] for r in meta if r[:2]==(1,80))[1]==4
    assert all(r[2][1]==4 for r in meta if r[:2] in [(2,10),(2,20)])
    bins=[r for r in meta if r[:2] in [(1,40),(1,50)]]
    assert [(r[1],*struct.unpack_from(order+'BBHI',r[2])) for r in bins]==[(50,255,255,7,0),(50,255,255,2,1),(40,255,255,1,1),(40,1,2,2,1)]
    tsr=[r[2] for r in meta if r[:2]==(10,30)]
    assert struct.unpack_from(order+'BBcIIII',tsr[0])==(255,255,b'P',20,1,1,1)
    assert struct.unpack_from(order+'BBcIIII',tsr[1])==(1,255,b'M',30,1,4294967295,0)
    for t in tsr:
        pos=19
        for _ in range(3): pos+=1+t[pos]
        assert t[pos]==255 and struct.unpack_from(order+'fffff',t,pos+1)==(0,0,0,0,0)
    assert struct.unpack_from(order+'I',next(r[2] for r in meta if r[:2]==(1,20)))[0]==1310
    assert [r[3] for r in meta if r[0] in [5,15]]==[r[3] for r in original_meta if r[0] in [5,15]]
    checks+=10
rs=records((p/'canonical-atdf.stdf').read_bytes(),'<')
assert len(rs)==26
ptr=[r[2] for r in rs if r[:2]==(15,10)]
assert struct.unpack_from('<f',ptr[0],8)[0] == 1
assert struct.unpack_from('<f',ptr[1],8)[0] == struct.unpack('<f',struct.pack('<f',1.01))[0]
assert ptr[1][6:8] == bytes([128,16])
mpr=next(r[2] for r in rs if r[:2]==(15,15))
assert struct.unpack_from('<ff',mpr,13) == tuple(struct.unpack('<f',struct.pack('<f',v))[0] for v in [.001,.002])
gdr=next(r[2] for r in rs if r[:2]==(50,10))
assert struct.unpack_from('<H',gdr)[0] == 9  # seven values plus two alignment pad fields
assert b'note' in gdr and bytes.fromhex('ffe0014c') in gdr
tsr=next(r[2] for r in rs if r[:2]==(10,30));pos=19
for _ in range(3): pos+=1+tsr[pos]
assert tsr[pos]==0xc8
checks += 7
print(json.dumps({'checks':checks,'passed':True}))
