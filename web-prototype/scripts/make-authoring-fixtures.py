"""Independent struct-only metadata sources for LE/BE authoring qualification."""
import pathlib, struct

out = pathlib.Path(__file__).resolve().parents[2] / '.venv' / 'library-fixtures'
out.mkdir(parents=True, exist_ok=True)
def cn(s):
    b = s.encode('ascii')
    return bytes([len(b)]) + b
for endian, order in [('little','<'), ('big','>')]:
    rows=[]
    def rec(t,s,b): rows.append(struct.pack(order+'HBB',len(b),t,s)+b)
    rec(0,10,bytes([2 if endian=='little' else 1,4]))                         # 1
    rec(1,10,struct.pack(order+'IIBcccHc',1000,1100,1,b'P',b' ',b' ',65535,b' ')+cn('META')) # 2
    rec(1,80,bytes([1,3,2,1,2])+cn('HANDLER'))                               # 3
    rec(2,10,struct.pack(order+'BBI',1,3,1100)+cn('W1'))                     # 4
    rec(5,10,bytes([1,1]))                                                 # 5
    rec(15,10,struct.pack(order+'IBBBBf',10,1,1,0,0,1))                     # 6
    rec(5,10,bytes([1,2]))                                                 # 7
    rec(15,10,struct.pack(order+'IBBBBf',20,1,2,129,0,2))                   # 8
    rec(5,20,struct.pack(order+'BBBHHHhhI',1,1,0,1,1,1,1,1,10)+cn('A'))    # 9
    rec(15,15,struct.pack(order+'IBBBBHHff',30,1,2,64,0,0,2,1,2))          # 10
    rec(15,20,struct.pack(order+'IBBB',40,1,2,0))                           # 11
    rec(5,20,struct.pack(order+'BBBHHHhhI',1,2,8,3,2,2,2,1,10)+cn('B'))     # 12
    rec(2,20,struct.pack(order+'BBIIIIII',1,3,1200,2,0,0,1,2)+cn('W1'))    # 13
    for typ,number,pf in [(50,1,'P'),(50,2,'F'),(40,1,'P'),(40,2,'F')]:
        rec(1,typ,struct.pack(order+'BBHIc',255,255,number,1,pf.encode())+cn('Bin')) # 14–17
    for family,number in [('P',10),('M',30)]:
        rec(10,30,struct.pack(order+'BBcIIII',255,255,family.encode(),number,1,0,0)+cn('Test')+cn('')+cn('')+bytes([0xc8])+struct.pack(order+'fffff',.01,1,2,3,5)) # 18–19
    rec(1,30,struct.pack(order+'BBIIIII',255,255,2,0,0,1,2))               # 20
    rec(1,20,struct.pack(order+'Ic',1300,b' ')+cn('done'))                  # 21
    assert len(rows)==21
    (out/f'metadata-{endian}.stdf').write_bytes(b''.join(rows))
