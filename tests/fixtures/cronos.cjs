const { deflateRawSync, crc32 } = require('node:zlib');
const DEFAULT = Uint8Array.from(Buffer.from('08638138a36b82a6180dacd5febe15f6a53676e22d41b5124bd83c5634464fa4d0018b600f70573e0667027af88c80e8c3fd0a3aa773b04d99a2f1fb5ac7c2179671ba2aa99af387ea8e099eb947d497e4b3bc58535f2e21d11aee2c6495f2b8c6338d2b1ff725adff7f39a8bf6a9179ed207ba1bb4569cddce731aaf065d7a03293b124d65b9f27428507443fb411685e49291394e61be17dc82ffa781de3de504e89b630480c100543ced3615183da776f929d747c04888655caf4c1620e28b70bc0f5cf35c54c16e098009bd9ae03afecc9db6d3b26753dbdb24a5d6c72407eab5952549cd2e9efdd371e8fcb8a90fc84e5f91419df6e23c466ebcc221c5c', 'hex'));
const key = Uint8Array.from(DEFAULT, b => 255 - b);
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const string = s => { const b = Buffer.from(s, 'ascii'); return Buffer.concat([Buffer.from([b.length]), b]); };
function field(type, name, index) {
  const bytes = Buffer.concat([u16(type), u32(index), string(name), u32(0), Buffer.from([1]), ...(type ? [u32(index), u32(255), u32(0)] : [])]);
  return Buffer.concat([u16(bytes.length), bytes]);
}
const definition = Buffer.concat([u16(0), Buffer.from([1,5,0]), u32(0), u32(1), string('Table'), string('T'), u32(0), u32(4),
  field(0,'ID',0), field(2,'Text',1), field(4,'Date',2), field(5,'Time',3), u32(0), u32(0xffffffff)]);
function file(records, { version, encoding, key, block = 64, extended = -1 }) {
  const wide = ['01.03','01.05','01.11'].includes(version), v4 = version === '01.11', pointer = wide ? 8 : 4;
  const header = Buffer.alloc(256); header.write('CroFile'); header.write(version,10);header.writeUInt16LE(encoding,15);header.writeUInt16LE(block,17);
  const parts = [header], entries = []; let offset = 256;
  const inverse = new Uint8Array(256); key.forEach((value, i) => { inverse[value] = i; });
  records.forEach((data, index) => {
    if (!data) { entries.push({ offset: 0, size: 0xffffffff }); return; }
    if (encoding & 2) { const compressed = deflateRawSync(data); const head = Buffer.alloc(8); head.writeUInt16BE(compressed.length + 6); head.writeUInt16BE(0x800,2); head.writeUInt32LE(crc32(data),4); data = Buffer.concat([head,compressed,Buffer.from([0,0,2])]); }
    if (encoding & 1) data = Buffer.from(data.map((b,i) => inverse[(b+i+index+1)&255]));
    const start = offset;
    if (index === extended && data.length > 8) {
      const inline = Buffer.alloc(pointer+4+8), first = data.subarray(0,8);
      const next = start + inline.length; wide ? inline.writeBigUInt64LE(BigInt(next)) : inline.writeUInt32LE(next);
      inline.writeUInt32LE(data.length,pointer); first.copy(inline,pointer+4);parts.push(inline);offset+=inline.length;
      for(let p=8;p<data.length;p+=block-pointer){ const chunk=Buffer.alloc(block),part=data.subarray(p,p+block-pointer);const next=p+part.length<data.length?offset+block:0;wide?chunk.writeBigUInt64LE(BigInt(next)):chunk.writeUInt32LE(next);part.copy(chunk,pointer);parts.push(chunk);offset+=block; }
      entries.push({offset:start,size:inline.length});
    } else { parts.push(data);offset+=data.length;entries.push({offset:start,size:data.length,inline:true}); }
  });
  const tad=Buffer.alloc((v4?16:8)+entries.length*(wide?16:12));if(v4)tad.writeUInt32LE(0xfffffffe);
  entries.forEach((entry,i)=>{const p=(v4?16:8)+i*(wide?16:12);let off=BigInt(entry.offset);if(v4&&entry.inline)off|=4n<<56n;wide?tad.writeBigUInt64LE(off,p):tad.writeUInt32LE(entry.offset,p);const size=entry.size===0xffffffff?entry.size:entry.size|(!v4&&entry.inline?0x80000000:0);tad.writeUInt32LE(size>>>0,p+pointer);});
  return [Buffer.concat(parts),tad];
}
function fixture({ version = '01.02', protectedKey = false, recovery = false, count = 8, extended = false } = {}) {
  const kod = protectedKey ? key : DEFAULT;
  const metadata = Buffer.concat([Buffer.from([3]),string('Base001'),u32(2)]);
  const stru = [metadata,Buffer.concat([Buffer.from([4]),definition])];
  if(recovery==='structure')stru.push(Buffer.alloc(65536));
  const rows=Array.from({length:count},(_,i)=>Buffer.concat([Buffer.from([1]),Buffer.from('row'+i+'\x1e1060102\x1e0930\x1e','ascii')]));
  rows.splice(2,0,null);
  const files={};
  for(const [name,records,encoding,block] of [['Stru',stru,1,512],['Bank',rows,3,64]]){
    const [dat,tad]=file(records,{version,encoding,key:kod,block,extended:extended?0:-1}); files['Cro'+name+'.dat']=dat;files['Cro'+name+'.tad']=tad;
  }
  return files;
}
module.exports={fixture,key,DEFAULT};
